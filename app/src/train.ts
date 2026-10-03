// 训练模式增强层：五种训练模式的定义、听写设置、发音、拼写判定与「训练专用」数据访问。
// 只依赖 db / fsrs / study 的既有能力；训练页（pages/Train.tsx）从这里取全部逻辑，
// 页面自身只负责渲染与交互。
//
// 为什么队列与 FSRS 提交实现在这里而不是直接复用 ReviewSession：
//   · ReviewSession 只对外暴露默认组件（initialQueue 入参），训练页需要「按模式取不同规模的队列」；
//   · 提交必须与 ReviewSession 完全一致（同一张表、同一字段、同一 schedule 调用），
//     因此这里照抄其 SQL 与 schedule 用法，保证两条路径写出的 card_state 完全等价。
import { getDb, nowIso, type QueueItem, type StateRow } from './db'
import { schedule, R } from './fsrs'
import { editDistance, WORDS_PER_GROUP } from './study'
import * as dbModule from './db'

/* ============================================================
   1. 训练模式
   ============================================================ */
export type TrainMode = 'listen' | 'rush' | 'choice' | 'spell' | 'dictation'

/** 合法模式列表（路由参数校验 / 训练坞渲染共用） */
export const TRAIN_MODES: TrainMode[] = ['listen', 'rush', 'choice', 'spell', 'dictation']

export function isTrainMode(v: string | undefined): v is TrainMode {
  return !!v && (TRAIN_MODES as string[]).includes(v)
}

export const MODE_META: Record<TrainMode, { label: string; desc: string }> = {
  listen: { label: '速听', desc: '像听歌一样过单词，循环听音、看图记词' },
  rush: { label: '速刷', desc: '一眼一个词，认识就下一个，快速铺量' },
  choice: { label: '单词选义', desc: '四选一，看词选释义，即时判对错' },
  spell: { label: '拼写', desc: '看中文释义拼英文，逐字判定对错' },
  dictation: { label: '听写', desc: '听音或看释义写单词，可调播放次数与间隔' },
}

/* ============================================================
   2. 听写设置（localStorage 持久化）
   ============================================================ */
export interface DictationSettings {
  /** audio=听发音·写单词/释义；meaning=听释义·写单词 */
  prompt: 'audio' | 'meaning'
  accent: 'us' | 'uk'
  plays: 1 | 2 | 3
  interval: 2 | 4 | 6 | 8
  autoNext: boolean
}

export const DICTATION_KEY = 'zenew_dictation'

export const DEFAULT_DICTATION: DictationSettings = {
  prompt: 'audio',
  accent: 'us',
  plays: 3,
  interval: 4,
  autoNext: true,
}

/** 读取听写设置：坏数据 / 隐私模式一律回落到默认值 */
export function loadDictation(): DictationSettings {
  try {
    const raw = localStorage.getItem(DICTATION_KEY)
    if (!raw) return { ...DEFAULT_DICTATION }
    const o = JSON.parse(raw) as Partial<DictationSettings>
    return {
      prompt: o.prompt === 'meaning' ? 'meaning' : 'audio',
      accent: o.accent === 'uk' ? 'uk' : 'us',
      plays: o.plays === 1 || o.plays === 2 || o.plays === 3 ? o.plays : DEFAULT_DICTATION.plays,
      interval: o.interval === 2 || o.interval === 4 || o.interval === 6 || o.interval === 8 ? o.interval : DEFAULT_DICTATION.interval,
      autoNext: typeof o.autoNext === 'boolean' ? o.autoNext : DEFAULT_DICTATION.autoNext,
    }
  } catch {
    return { ...DEFAULT_DICTATION }
  }
}

/** 局部更新听写设置，返回合并后的完整设置 */
export function saveDictation(patch: Partial<DictationSettings>): DictationSettings {
  const next = { ...loadDictation(), ...patch }
  try {
    localStorage.setItem(DICTATION_KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式等场景忽略 */
  }
  return next
}

/* ============================================================
   3. 发音（WebView2 内置 speechSynthesis）
   ============================================================ */
/** 当前系统是否有对应语言的语音包（没有时 en-GB 会读出中文腔甚至静音） */
function hasVoice(lang: string): boolean {
  try {
    const list = typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices()
    return list.some((v) => v.lang?.replace('_', '-').toLowerCase().startsWith(lang.toLowerCase()))
  } catch {
    return false
  }
}

/**
 * 朗读单词。accent='uk' 时用英音 en-GB，accent='us' 时用美音 en-US；
 * 系统没装对应语音包时（getVoices 里找不到）才回落到 en-US，避免读出中文腔或静音。
 * 任何异常（无语音引擎 / 未授权）都静默忽略，不影响训练流程。
 */
export function speakWord(text: string, accent: 'us' | 'uk' = 'us', rate = 0): void {
  const t = (text || '').trim()
  if (!t) return
  try {
    if (typeof speechSynthesis === 'undefined') return
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(t)
    // 目标语言：美音 en-US / 英音 en-GB（真实写进 utterance，别只算不用）
    const want: string = accent === 'uk' ? 'en-GB' : 'en-US'
    const pick = want === 'en-GB' && !hasVoice('en-GB') ? 'en-US' : want
    u.lang = pick
    u.rate = rate > 0 ? rate : accent === 'uk' ? 0.9 : 0.92
    u.pitch = 1
    const voice = (() => {
      try {
        return speechSynthesis.getVoices().find((v) => v.lang?.replace('_', '-').toLowerCase().startsWith(pick.toLowerCase()))
      } catch {
        return undefined
      }
    })()
    if (voice) u.voice = voice
    speechSynthesis.speak(u)
  } catch {
    /* 静默失败 */
  }
}

/** 停掉当前朗读（切词 / 退出时调用） */
export function stopSpeaking(): void {
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  } catch {
    /* 忽略 */
  }
}

/* ============================================================
   4. 洗牌
   ============================================================ */
/** Fisher–Yates 洗牌，返回新数组（不修改入参） */
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/* ============================================================
   5. 拼写判定
   ============================================================ */
export interface SpellDiff {
  index: number
  typed: string
  expected: string
}

export interface SpellJudge {
  /** 完全正确（忽略大小写与首尾空格） */
  correct: boolean
  /** 差多少个字符（编辑距离，完全正确为 0） */
  distance: number
  /** 判定文案 */
  message: string
  /** 应高亮的差异位置（简单实现：逐字比对，最多 6 处） */
  diff: SpellDiff[]
}

/**
 * 判定拼写：完全正确 / 拼错（差 n 个字符）。
 * 差异位置用「逐字比对」给出，便于输入框下方渲染逐字符着色提示。
 */
export function judgeSpelling(input: string, answer: string): SpellJudge {
  const typed = (input || '').trim().toLowerCase()
  const expect = (answer || '').trim().toLowerCase()
  if (!expect) return { correct: false, distance: 0, message: '没有可判定的答案', diff: [] }
  if (typed === expect) {
    return { correct: true, distance: 0, message: '完全正确', diff: [] }
  }
  const distance = editDistance(typed, expect)
  const diff: SpellDiff[] = []
  const n = Math.max(typed.length, expect.length)
  for (let i = 0; i < n && diff.length < 6; i++) {
    const a = typed[i] ?? ''
    const b = expect[i] ?? ''
    if (a !== b) diff.push({ index: i, typed: a, expected: b })
  }
  const missing = Math.max(0, expect.length - typed.length)
  const hint = !typed ? '还没输入' : missing > 2 ? `少写了 ${missing} 个字母` : '拼错'
  return { correct: false, distance, message: `${hint}（差 ${distance} 个字符）`, diff }
}

/** 逐字符着色用：返回输入串每个字符是否正确（错的用珊瑚色标出） */
export function spellCharMarks(input: string, answer: string): boolean[] {
  const t = (input || '').trim().toLowerCase()
  const a = (answer || '').trim().toLowerCase()
  return Array.from(t).map((ch, i) => ch === a[i])
}

/** 提示：返回答案的第 i 个字符（越界返回空串） */
export function revealChar(answer: string, i: number): string {
  return (answer || '')[i] ?? ''
}

/* ============================================================
   6. 单词卡数据解析
   ============================================================ */
export interface WordSense {
  p: string
  t: string
}
export interface WordBack {
  m?: WordSense[]
  s?: { e: string; c: string }[]
  uk?: string
  us?: string
}

/** 单词卡 back 是 JSON 词条（vocab.ts 导入格式）；解析失败返回 null */
export function parseWordBack(back: string): WordBack | null {
  try {
    const o = JSON.parse(back) as WordBack
    if (o && (o.m || o.s || o.uk || o.us)) return o
    return null
  } catch {
    return null
  }
}

/** 中文释义（取第一条，带词性前缀） */
export function senseText(back: string): string {
  const s = parseWordBack(back)?.m?.[0]
  if (!s?.t) return ''
  return s.p ? `${s.p}. ${s.t}` : s.t
}

/* ============================================================
   7. 训练队列（本书 / 全量）
   ============================================================ */
export interface TrainQueueOptions {
  /** 由该词书路由 key 映射出的课程名（如「英语四级」） */
  courseName: string
  /** 需要多少词（速刷 / 速听给足一组，其余沿用每日新学上限） */
  limit: number
  /** 打乱顺序（速刷 / 速听 / 听写更合适） */
  shuffled?: boolean
}

/** 本地兜底：db.ts 尚未提供 loadBookWords 时，直接取该书全部单词卡 */
type BookWordsLoader = (courseName: string, limit?: number) => Promise<QueueItem[]>

function rowsToQueue(rows: Record<string, unknown>[], nowIsoStr: string): QueueItem[] {
  return rows.map((r) => ({
    id: r.id as number,
    topic_id: r.topic_id as number,
    type: r.type as string,
    front: r.front as string,
    back: r.back as string,
    explanation: r.explanation as string,
    choices_json: (r.choices_json as string | null) ?? null,
    answer_index: (r.answer_index as number | null) ?? null,
    suspended: (r.suspended as number) || 0,
    topic_title: r.topic_title as string,
    course_name: r.course_name as string,
    st:
      r.state === null || r.state === undefined
        ? null
        : {
            card_id: r.id as number,
            due: (r.due as string) || nowIsoStr,
            stability: (r.stability as number) || 0,
            difficulty: (r.difficulty as number) || 0,
            elapsed_days: (r.elapsed_days as number) || 0,
            scheduled_days: (r.scheduled_days as number) || 0,
            reps: (r.reps as number) || 0,
            lapses: (r.lapses as number) || 0,
            state: r.state as number,
            last_review: (r.last_review as string) || null,
          },
  }))
}

const QUEUE_COLS = `c.id, c.topic_id, c.type, c.front, c.back, c.explanation, c.choices_json, c.answer_index, c.suspended,
        t.title AS topic_title, co.name AS course_name,
        cs.card_id AS st_card_id, cs.due, cs.stability, cs.difficulty, cs.elapsed_days, cs.scheduled_days, cs.reps, cs.lapses, cs.state, cs.last_review`

/** 同组的卡排在一起，避免同一分组连续出现（与 db.ts 的混排规则一致） */
function mixByTopic(items: QueueItem[]): QueueItem[] {
  const pool = [...items]
  const out: QueueItem[] = []
  let lastTopic = -1
  while (pool.length > 0) {
    let pickAt = pool.findIndex((x) => x.topic_id !== lastTopic)
    if (pickAt === -1) pickAt = 0
    const [item] = pool.splice(pickAt, 1)
    out.push(item)
    lastTopic = item.topic_id
  }
  return out
}

/**
 * 兜底取词：本书全部未斩单词卡。
 * 优先用 db.ts 的 loadBookWords（另一个代理在补），没有就本地查一次，
 * 保证训练页在两种情况下都能跑。
 */
async function loadBookWordsFallback(courseName: string, limit: number): Promise<QueueItem[]> {
  const maybe = (dbModule as unknown as Record<string, unknown>).loadBookWords
  if (typeof maybe === 'function') {
    try {
      const rows = await (maybe as BookWordsLoader)(courseName, limit)
      if (Array.isArray(rows) && rows.length) return rows.slice(0, limit)
    } catch {
      /* 兜底查询失败时继续走本地 SQL */
    }
  }
  try {
    const db = await getDb()
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ${QUEUE_COLS}
       FROM card c
       JOIN topic t ON t.id = c.topic_id
       JOIN course co ON co.id = t.course_id
       LEFT JOIN card_state cs ON cs.card_id = c.id
       WHERE co.kind = 'vocab' AND c.type = 'word' AND co.name = ? AND c.suspended = 0
       ORDER BY c.created_at ASC, c.id ASC LIMIT ?`,
      [courseName, limit]
    )
    return mixByTopic(rowsToQueue(rows, nowIso())).slice(0, limit)
  } catch (e) {
    console.error('读取词书单词失败', e)
    return []
  }
}

/**
 * 载入训练队列：
 *   1) 优先 loadQueueByCourse（到期卡 + 新卡，混排规则与学习页一致）；
 *   2) 不足时用全部单词卡兜底（例如该书卡都已排到未来，队列为空）；
 *   3) 只要带释义的卡（选义 / 拼写 / 听写都需要释义）。
 * 上限固定在 want：训练是「一组词」的短会话，不应把整本书塞进队列。
 */
export async function loadTrainQueue(opts: TrainQueueOptions): Promise<QueueItem[]> {
  const { courseName, limit, shuffled = false } = opts
  const want = Math.max(1, limit)
  let items: QueueItem[] = []
  try {
    items = await loadQueueByCourseLocal(courseName, nowIso(), Math.max(want, 30))
  } catch (e) {
    console.error('读取训练队列失败', e)
  }
  const fallbackLimit = items.length >= want ? want * 2 : Math.max(want * 2, 120)
  const all = await loadBookWordsFallback(courseName, fallbackLimit)
  const seen = new Set(items.map((x) => x.id))
  for (const it of all) {
    if (items.length >= want) break
    if (!seen.has(it.id)) {
      seen.add(it.id)
      items.push(it)
    }
  }
  const usable = items.filter((x) => !!senseText(x.back))
  const picked = (usable.length ? usable : items).slice(0, want)
  return shuffled ? shuffle(picked) : picked
}

/** loadQueueByCourse 的本地实现（到期 + 新卡，混排同 db.ts），避免对 db.ts 导出列表的强依赖 */
async function loadQueueByCourseLocal(courseName: string, nowIsoStr: string, newLimit: number): Promise<QueueItem[]> {
  const db = await getDb()
  const due = await db.select<Record<string, unknown>[]>(
    `SELECT ${QUEUE_COLS}
     FROM card c
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     JOIN card_state cs ON cs.card_id = c.id
     WHERE co.kind = 'vocab' AND c.type = 'word' AND co.name = ? AND c.suspended = 0 AND cs.due <= ? AND cs.state != 0
     ORDER BY cs.due ASC LIMIT 60`,
    [courseName, nowIsoStr]
  )
  const fresh = await db.select<Record<string, unknown>[]>(
    `SELECT ${QUEUE_COLS}
     FROM card c
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     LEFT JOIN card_state cs ON cs.card_id = c.id
     WHERE co.kind = 'vocab' AND c.type = 'word' AND co.name = ? AND c.suspended = 0 AND cs.card_id IS NULL
     ORDER BY c.created_at ASC LIMIT ?`,
    [courseName, newLimit]
  )
  return mixByTopic([...rowsToQueue(fresh, nowIsoStr), ...rowsToQueue(due, nowIsoStr)])
}

/* ============================================================
   8. FSRS 提交（与 ReviewSession 完全同一套写库方式）
   ============================================================ */
/** 评分：1=Again 2=Hard 3=Good 4=Easy（ts-fsrs 的 Rating） */
export type TrainGrade = 1 | 2 | 3 | 4

export const GRADE = {
  again: R.Again,
  hard: R.Hard,
  good: R.Good,
  easy: R.Easy,
} as const

/** 训练语义：认识=Good，模糊=Hard，不认识=Again，斩=Easy + suspended */
export const RATING_LABEL: Record<TrainGrade, string> = {
  1: '不认识',
  2: '模糊',
  3: '认识',
  4: '斩',
}

export interface CommitResult {
  ok: boolean
  error: string
}

/**
 * 写 card_state（UPSERT）+ review_log；与 ReviewSession.commit 的 SQL 完全一致。
 * durationMs 传 -1 时按 0 记录（调用方没有展示时长时）。
 */
export async function commitTrainCard(
  cardId: number,
  grade: TrainGrade,
  state: StateRow | null,
  durationMs = 0,
  reviewedAt = nowIso()
): Promise<CommitResult> {
  try {
    const db = await getDb()
    const { next } = schedule(state, grade)
    const row = { ...next, card_id: cardId }
    await db.execute(
      `INSERT INTO card_state(card_id,due,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,state,last_review)
       VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(card_id) DO UPDATE SET due=excluded.due, stability=excluded.stability, difficulty=excluded.difficulty,
         elapsed_days=excluded.elapsed_days, scheduled_days=excluded.scheduled_days, reps=excluded.reps,
         lapses=excluded.lapses, state=excluded.state, last_review=excluded.last_review`,
      [row.card_id, row.due, row.stability, row.difficulty, row.elapsed_days, row.scheduled_days, row.reps, row.lapses, row.state, row.last_review]
    )
    await db
      .execute('INSERT INTO review_log(card_id,rating,reviewed_at,duration_ms) VALUES(?,?,?,?)', [
        cardId,
        grade,
        reviewedAt,
        Math.max(0, Math.round(durationMs)),
      ])
      .catch(() => {})
    return { ok: true, error: '' }
  } catch (e) {
    console.error('训练提交失败', e)
    return { ok: false, error: '保存失败，请重试' }
  }
}

/** 斩：暂停该卡（UPDATE card SET suspended=1）后再按 Easy 记录一次 */
export async function suspendCard(cardId: number): Promise<boolean> {
  try {
    const db = await getDb()
    await db.execute('UPDATE card SET suspended=1 WHERE id=?', [cardId])
    return true
  } catch (e) {
    console.error('斩词失败', e)
    return false
  }
}

/* ============================================================
   9. 训练会话断点（像学习页一样记住队列与位置）
   ============================================================ */
const TRAIN_SESSION_KEY = 'train_session'
const TRAIN_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000

export interface TrainSession {
  card_ids: number[]
  idx: number
  saved_at: string
  mode: TrainMode
}

export async function saveTrainSession(cardIds: number[], idx: number, mode: TrainMode): Promise<void> {
  if (!cardIds.length) return
  try {
    const db = await getDb()
    await db.execute(
      'INSERT INTO _zenew_meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [TRAIN_SESSION_KEY, JSON.stringify({ card_ids: cardIds, idx, saved_at: nowIso(), mode } satisfies TrainSession)]
    )
  } catch {
    /* 断点只影响体验，失败不打断训练 */
  }
}

export async function loadTrainSession(mode: TrainMode): Promise<TrainSession | null> {
  try {
    const db = await getDb()
    const rows = await db.select<{ value: string }[]>('SELECT value FROM _zenew_meta WHERE key=?', [TRAIN_SESSION_KEY])
    if (!rows.length) return null
    const parsed = JSON.parse(rows[0].value) as TrainSession
    if (!parsed.card_ids?.length || parsed.mode !== mode) return null
    if (parsed.saved_at && Date.now() - new Date(parsed.saved_at).getTime() > TRAIN_SESSION_MAX_AGE_MS) {
      await clearTrainSession()
      return null
    }
    if (parsed.idx >= parsed.card_ids.length) return null
    return parsed
  } catch {
    return null
  }
}

export async function clearTrainSession(): Promise<void> {
  try {
    const db = await getDb()
    await db.execute('DELETE FROM _zenew_meta WHERE key=?', [TRAIN_SESSION_KEY])
  } catch {
    /* 忽略 */
  }
}

/* ============================================================
   10. 其它小工具
   ============================================================ */
/** 每日新学上限（沿用学习页的 localStorage 约定） */
export function newLimit(): number {
  const raw = Number(localStorage.getItem('zenew_new_limit'))
  return Number.isFinite(raw) && raw >= 0 ? raw : 10
}

/** 各模式的取词规模：速刷 / 速听给足一组，其余按每日新学上限（最少一组） */
export function trainLimit(mode: TrainMode): number {
  if (mode === 'rush' || mode === 'listen') return WORDS_PER_GROUP
  return Math.max(WORDS_PER_GROUP, newLimit())
}

/** 词书路由 key → 课程名（与 VocabStudy 的 BOOK_NAMES 保持一致） */
export const BOOK_NAMES: Record<string, string> = {
  cet4: '英语四级',
  cet6: '英语六级',
  freq: '高频词',
  basic: '基础英语',
  notebook: '生词本',
}

export function bookNameOf(key: string): string {
  return BOOK_NAMES[key] || ''
}

/* ---- 收藏（⭐，localStorage zenew_starred） ---- */
export const STARRED_KEY = 'zenew_starred'

export function loadStarred(): string[] {
  try {
    const raw = localStorage.getItem(STARRED_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function isStarred(word: string, list?: string[]): boolean {
  const l = list ?? loadStarred()
  return l.includes(word)
}

/** 切换收藏，返回切换后的完整列表 */
export function toggleStarred(word: string): string[] {
  const l = loadStarred()
  const next = l.includes(word) ? l.filter((w) => w !== word) : [word, ...l].slice(0, 2000)
  try {
    localStorage.setItem(STARRED_KEY, JSON.stringify(next))
  } catch {
    /* 忽略 */
  }
  return next
}

/** 按设定的播放次数与间隔，给出每一次播放的延迟（毫秒） */
export function playSchedule(plays: number, intervalSec: number): number[] {
  return Array.from({ length: Math.max(1, plays) }, (_, i) => i * Math.max(1, intervalSec) * 1000)
}
