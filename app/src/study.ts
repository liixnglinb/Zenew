// 学习增强层：本地设置（音效/震动/字号/长辈版）、词根词缀、形近词、四选一干扰项、
// 每日任务与学习积分、词书学习计划。全部离线可用，数据落在 localStorage + 本地 SQLite。
import { getDb, localDayKey } from './db'
import { loadIndex, type IndexItem } from './vocab'

/* ============================================================
   本地设置
   ============================================================ */
export interface LocalSettings {
  sound: boolean
  haptic: boolean
  remind: boolean
  scale: number
  elder: boolean
}

const SET_KEY = 'zenew_settings_v1'
const DEFAULT_SETTINGS: LocalSettings = { sound: true, haptic: true, remind: false, scale: 1, elder: false }

export function getSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(SET_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<LocalSettings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(patch: Partial<LocalSettings>): LocalSettings {
  const next = { ...getSettings(), ...patch }
  try {
    localStorage.setItem(SET_KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式等场景忽略 */
  }
  applySettings(next)
  return next
}

/** 应用显示类设置（字号缩放 + 长辈版排版） */
export function applySettings(s: LocalSettings = getSettings()): void {
  if (typeof document === 'undefined') return
  const scale = s.elder ? Math.max(1.12, s.scale) : s.scale
  document.documentElement.style.setProperty('--scale', String(scale))
  document.body.classList.toggle('elder', s.elder)
}

/* ============================================================
   音效 / 震动
   ============================================================ */
let audioCtx: AudioContext | null = null

/** 极简提示音（无外部资源；答对=上行三音，答错=下行两音） */
export function tone(kind: 'ok' | 'no' | 'tap' | 'cut'): void {
  if (!getSettings().sound) return
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    if (!audioCtx) audioCtx = new Ctor()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const seq = kind === 'ok' ? [660, 880, 1180] : kind === 'no' ? [420, 300] : kind === 'cut' ? [300, 500] : [700]
    seq.forEach((freq, i) => {
      const t0 = ctx.currentTime + i * 0.075
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0)
      osc.stop(t0 + 0.18)
    })
  } catch {
    /* 无音频设备时静默 */
  }
}

export function buzz(ms = 12): void {
  if (!getSettings().haptic) return
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* 桌面端多为 no-op */
  }
}

/* ============================================================
   视觉：由词形决定的确定性配色（无图卡片用）
   ============================================================ */
const PALETTES: [string, string][] = [
  ['#FFE9A8', '#FFD166'],
  ['#CFE5FE', '#93BDFB'],
  ['#D8F3EC', '#8ED9C8'],
  ['#FFD9D4', '#FFA79B'],
  ['#E4DBFF', '#B9A6FF'],
  ['#D6F0FF', '#8FD2F5'],
  ['#FFE3C7', '#FFBE7D'],
  ['#E8EAD9', '#C3C99B'],
]

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export function wordVisual(word: string): { from: string; to: string; glyph: string } {
  const [from, to] = PALETTES[hash(word) % PALETTES.length]
  const glyph = (word.trim()[0] || 'A').toUpperCase()
  return { from, to, glyph }
}

export function avatarVisual(seed: string): { from: string; to: string; initial: string } {
  const pairs: [string, string][] = [
    ['#245EF0', '#5C8CFF'],
    ['#2AA391', '#6BD3C4'],
    ['#FF8A3D', '#FFB020'],
    ['#7A5CFF', '#A88BFF'],
    ['#E4574C', '#FF8F86'],
    ['#1B9AAA', '#4FD1D9'],
  ]
  const [from, to] = pairs[hash(seed) % pairs.length]
  const initial = (seed.trim()[0] || '知').toUpperCase()
  return { from, to, initial }
}

/* ============================================================
   词根词缀（离线词表 → 拆词讲解；无匹配返回 null）
   ============================================================ */
const PREFIXES: Record<string, string> = {
  un: '不、非', in: '不／向内', im: '不／向内', il: '不', ir: '不', dis: '否定、分开', mis: '错误地',
  re: '再、回', pre: '预先', pro: '向前、支持', post: '在后', sub: '在下、次', super: '超过', over: '过度',
  under: '在下、不足', inter: '在…之间', trans: '跨越', ex: '向外、前任', en: '使…', em: '使…',
  con: '共同、加强', com: '共同、加强', col: '共同', cor: '共同', de: '向下、去除', ab: '离开', ad: '朝向',
  anti: '反对', auto: '自己', bi: '二', co: '共同', counter: '反对', extra: '超出', fore: '在前',
  hyper: '过度', hypo: '在下', mono: '单一', multi: '多', non: '非', out: '超出', poly: '多',
  semi: '半', tele: '远', tri: '三', ultra: '极端', uni: '单一', bene: '善', mal: '恶',
}

const ROOTS: Record<string, string> = {
  leg: '法律', neg: '否定、拒绝', dict: '说', spect: '看', port: '携带', tract: '拉、拖', ject: '投掷',
  scrib: '写', script: '写', vid: '看', vis: '看', aud: '听', chron: '时间', graph: '写、图', log: '言、学科',
  loqu: '说话', man: '手', ped: '脚', pod: '脚', path: '感情、疾病', phon: '声音', photo: '光', pos: '放置',
  press: '压', rupt: '破', sect: '切', sent: '感觉', sens: '感觉', sequ: '跟随', sist: '站立', solv: '解开',
  spir: '呼吸', struct: '建造', tact: '接触', tend: '伸展', tens: '伸展', vac: '空', ven: '来', vent: '来',
  vert: '转', vers: '转', voc: '叫、声音', vok: '叫、声音', fer: '带来', duc: '引导', duct: '引导',
  fac: '做', fact: '做', grad: '步、级', gress: '走', mit: '送', miss: '送', mov: '移动', mot: '移动',
  nat: '出生', pel: '推动', puls: '推动', pend: '悬挂', pens: '称量', plic: '折叠', pon: '放置',
  quir: '寻求', quest: '寻求', reg: '统治、规则', sci: '知道', sta: '站立', stat: '站立', string: '拉紧',
  ten: '持', ver: '真实', cur: '跑', fer2: '带来', form: '形状', jur: '法律、宣誓', labor: '劳动',
  liber: '自由', lum: '光', mar: '海', mem: '记忆', ment: '心智', mort: '死', nom: '名字、法则',
  nov: '新', oper: '工作', pac: '和平', par: '准备、显现', part: '部分', pass: '通过', pat: '感受',
  ped2: '儿童', pel2: '驱赶', pet: '追求', plac: '使高兴', ple: '填满', popul: '人民', prim: '第一',
  pur: '纯净', rect: '直、正', rid: '笑', rog: '询问', sacr: '神圣', sal: '盐', sat: '足够', scop: '看',
  sec: '切', serv: '服务、保持', sid: '坐', sign: '记号', simil: '相似', soci: '社会', sol: '太阳、单独',
  spec: '看', sper: '希望', spond: '承诺', sta2: '站', sti: '站立', strain: '拉紧', sum: '拿、消耗',
  tain: '持有', tect: '覆盖', temp: '时间', termin: '界限', terr: '土地', test: '证明', text: '编织',
  tort: '扭曲', tour: '转', trib: '给予', trud: '推', turb: '搅动', umbr: '阴影', und: '波', urb: '城市',
  vad: '走', val: '价值', vap: '蒸汽', vari: '变化', veh: '运送', vel: '速度', vest: '衣服', via: '路',
  vinc: '征服', viv: '生命', volv: '滚动', vor: '吃',
}

const SUFFIXES: Record<string, string> = {
  al: '形容词后缀', tion: '名词后缀', sion: '名词后缀', ation: '名词后缀', ment: '名词后缀', ness: '名词后缀',
  ity: '名词后缀', ty: '名词后缀', ance: '名词后缀', ence: '名词后缀', dom: '名词后缀', hood: '名词后缀',
  ship: '名词后缀', age: '名词后缀', ure: '名词后缀', ing: '动名词后缀', ous: '形容词后缀：多…的',
  ious: '形容词后缀', ive: '形容词后缀', able: '形容词后缀：能…的', ible: '形容词后缀', ful: '形容词后缀：充满…',
  less: '形容词后缀：无…', ly: '副词后缀', er: '名词：人／物', or: '名词：人／物', ist: '名词：…者',
  ize: '动词后缀：使…化', ise: '动词后缀', ify: '动词后缀：使…', en: '动词／形容词后缀', ate: '动词／形容词后缀',
  ent: '形容词／名词后缀', ant: '形容词／名词后缀', ic: '形容词后缀', ical: '形容词后缀', ary: '形容词／名词后缀',
  ory: '形容词／名词后缀', ate2: '动词后缀', ism: '名词后缀：主义', itis: '名词后缀：炎症',
}

export interface MorphPart {
  text: string
  label: string
  kind: 'prefix' | 'root' | 'suffix' | 'stem'
}

/** 拆词：最长前缀 / 最长后缀 / 中间词根；无任何命中返回 null */
export function morphology(word: string): { parts: MorphPart[]; note: string } | null {
  const w = word.trim().toLowerCase().replace(/[^a-z]/g, '')
  if (w.length < 4) return null

  // 1) 最长前缀（2-5 字母，且给词根留出至少 2 个字母）
  let prefix = ''
  for (let len = Math.min(5, w.length - 2); len >= 2; len--) {
    if (PREFIXES[w.slice(0, len)]) {
      prefix = w.slice(0, len)
      break
    }
  }
  // 2) 最长后缀（不与前缀重叠）
  let suffix = ''
  for (let len = Math.min(5, w.length - prefix.length - 2); len >= 2; len--) {
    if (SUFFIXES[w.slice(-len)]) {
      suffix = w.slice(-len)
      break
    }
  }
  // 3) 在剩余中间段里找词根
  const stem = w.slice(prefix.length, w.length - suffix.length)
  let root = ''
  for (let len = Math.min(5, stem.length); len >= 3 && !root; len--) {
    for (let start = 0; start + len <= stem.length; start++) {
      const cand = stem.slice(start, start + len)
      if (ROOTS[cand]) {
        root = cand
        break
      }
    }
  }
  if (!prefix && !suffix && !root) return null

  const parts: MorphPart[] = []
  if (prefix) parts.push({ text: prefix, label: `前缀 · ${PREFIXES[prefix]}`, kind: 'prefix' })
  const rootAt = root ? stem.indexOf(root) : -1
  if (rootAt > 0) parts.push({ text: stem.slice(0, rootAt), label: '连接成分', kind: 'stem' })
  if (root) parts.push({ text: root, label: `词根 · ${ROOTS[root]}`, kind: 'root' })
  const afterRoot = root ? stem.slice(rootAt + root.length) : stem
  if (afterRoot) parts.push({ text: afterRoot, label: '连接成分', kind: 'stem' })
  if (suffix) parts.push({ text: suffix, label: `后缀 · ${SUFFIXES[suffix]}`, kind: 'suffix' })

  const bites = [
    root ? `词根「${root}」表示${ROOTS[root]}` : '',
    prefix ? `前缀「${prefix}」表示${PREFIXES[prefix]}` : '',
    suffix ? `后缀「${suffix}」是${SUFFIXES[suffix]}` : '',
  ].filter(Boolean)
  return { parts, note: `${bites.join('；')}，拆开记比死记省力。` }
}

/* ============================================================
   形近词（编辑距离）——用于「和 xxx 搞混了？帮你辨析」
   ============================================================ */
export function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    const t = prev
    prev = cur
    cur = t
  }
  return prev[n]
}

const indexCache = { list: null as IndexItem[] | null }

/** 从全量索引里找形近词（同首字母、编辑距离 ≤2 优先） */
export async function similarWords(word: string, limit = 6): Promise<{ w: string; t: string }[]> {
  const w = word.trim().toLowerCase()
  if (!/^[a-z]{3,}$/.test(w)) return []
  if (!indexCache.list) {
    try {
      indexCache.list = await loadIndex()
    } catch {
      return []
    }
  }
  const cands: { w: string; s: number }[] = []
  for (const it of indexCache.list) {
    const x = it.w.toLowerCase()
    if (x === w || Math.abs(x.length - w.length) > 2) continue
    if (x[0] !== w[0]) continue
    const d = editDistance(w, x)
    if (d <= 2) cands.push({ w: it.w, s: d })
  }
  cands.sort((a, b) => a.s - b.s || a.w.length - b.w.length)
  const picked = cands.slice(0, limit * 2)
  const out: { w: string; t: string }[] = []
  for (const c of picked) {
    const it = indexCache.list.find((x) => x.w === c.w)
    out.push({ w: c.w, t: it?.m?.[0]?.t?.slice(0, 26) || '' })
    if (out.length >= limit) break
  }
  return out
}

/* ============================================================
   四选一干扰项（从同词书其它词里取释义，保证同词性优先、长度相近）
   ============================================================ */
export interface ChoiceSet {
  choices: string[]
  answerIndex: number
}

/** 为「单词→选释义」生成 2×2 选项；随机种子来自 cardId，同一张卡每次一致 */
export async function buildWordChoices(cardId: number, courseName: string, correct: { p: string; t: string }): Promise<ChoiceSet | null> {
  const right = correct.t.trim()
  if (!right) return null
  try {
    const db = await getDb()
    const rows = await db.select<{ back: string }[]>(
      `SELECT c.back FROM card c JOIN topic t ON t.id=c.topic_id JOIN course co ON co.id=t.course_id
       WHERE co.kind='vocab' AND co.name=? AND c.type='word' ORDER BY (c.id * 7919 + ?) % 100003 LIMIT 24`,
      [courseName, cardId]
    )
    const pool: { p: string; t: string }[] = []
    for (const r of rows) {
      try {
        const o = JSON.parse(r.back) as { m?: { p: string; t: string }[] }
        const m = o.m?.[0]
        if (m?.t && m.t.trim() !== right && !pool.some((x) => x.t === m.t)) pool.push({ p: m.p || '', t: m.t.trim() })
      } catch {
        /* 脏数据跳过 */
      }
    }
    // 同词性优先，其次长度相近
    pool.sort((a, b) => {
      const pa = a.p === correct.p ? 0 : 1
      const pb = b.p === correct.p ? 0 : 1
      if (pa !== pb) return pa - pb
      return Math.abs(a.t.length - right.length) - Math.abs(b.t.length - right.length)
    })
    const distractors = pool.slice(0, 3)
    if (distractors.length < 3) return null
    const items = [correct, ...distractors].map((x) => ({ p: x.p, t: x.t }))
    // 由 cardId 决定的稳定洗牌
    const seed = (cardId % 4 + 4) % 4
    const rotated = [...items.slice(seed), ...items.slice(0, seed)]
    return { choices: rotated.map((x) => (x.p ? `${x.p}. ${x.t}` : x.t)), answerIndex: rotated.findIndex((x) => x.t === right) }
  } catch {
    return null
  }
}

/* ============================================================
   学习积分 / 每日任务
   ============================================================ */
export interface Activity {
  reviews: number
  correct: number
  points: number
}

/** 今日学习活动（来自 review_log，只统计词书单词卡）：每张 +4 分，评分 ≥3 视为答对再 +2 */
export async function todayActivity(): Promise<Activity> {
  try {
    const db = await getDb()
    const rows = await db.select<{ rating: number; reviewed_at: string }[]>(
      `SELECT rl.rating, rl.reviewed_at FROM review_log rl
       JOIN card c ON c.id = rl.card_id
       JOIN topic t ON t.id = c.topic_id
       JOIN course co ON co.id = t.course_id
       WHERE co.kind = 'vocab' AND c.type = 'word' AND rl.reviewed_at >= ?`,
      [new Date(Date.now() - 2 * 86400000).toISOString()]
    )
    const today = localDayKey()
    let reviews = 0
    let correct = 0
    for (const r of rows) {
      if (localDayKey(r.reviewed_at) !== today) continue
      reviews++
      if (r.rating >= 3) correct++
    }
    return { reviews, correct, points: reviews * 4 + correct * 2 }
  } catch {
    return { reviews: 0, correct: 0, points: 0 }
  }
}

export interface Task {
  key: string
  title: string
  sub: string
  target: number
  now: number
  reward: number
  done: boolean
}

export async function dailyTasks(): Promise<{ tasks: Task[]; activity: Activity }> {
  const a = await todayActivity()
  const tasks: Task[] = [
    { key: 'study1', title: '完成 1 组学习', sub: `今日已学 ${a.reviews} / 25 张`, target: 25, now: a.reviews, reward: 10, done: a.reviews >= 25 },
    { key: 'review1', title: '复习 1 组单词', sub: `今日答对 ${a.correct} 张`, target: 10, now: a.correct, reward: 20, done: a.correct >= 10 },
    { key: 'points', title: '获得 100 学习得分', sub: `当前 ${a.points} 分`, target: 100, now: a.points, reward: 30, done: a.points >= 100 },
  ]
  return { tasks, activity: a }
}

/* ---- 星星罐（集满 30 颗开礼包） ---- */
const STAR_KEY = 'zenew_star_bank'
const STAR_LOG = 'zenew_star_log'

interface StarLog {
  day: string
  granted: string[]
}

function readStarLog(): StarLog {
  try {
    const raw = localStorage.getItem(STAR_LOG)
    if (raw) {
      const o = JSON.parse(raw) as StarLog
      if (o.day === localDayKey()) return o
    }
  } catch {
    /* ignore */
  }
  return { day: localDayKey(), granted: [] }
}

export function starBank(): number {
  return Number(localStorage.getItem(STAR_KEY) || 0)
}

/** 结算今日任务星星（幂等：同一任务当天只计一次）；返回本次新增 */
export function grantStars(doneKeys: string[]): number {
  const log = readStarLog()
  let added = 0
  for (const k of doneKeys) {
    if (!log.granted.includes(k)) {
      log.granted.push(k)
      added++
    }
  }
  if (added > 0) {
    try {
      localStorage.setItem(STAR_LOG, JSON.stringify(log))
      localStorage.setItem(STAR_KEY, String(starBank() + added))
    } catch {
      /* ignore */
    }
  }
  return added
}

/** 开礼包：消耗 30 颗星，返回是否成功 */
export function openGift(): boolean {
  const bank = starBank()
  if (bank < 30) return false
  try {
    localStorage.setItem(STAR_KEY, String(bank - 30))
    localStorage.setItem('zenew_gift_count', String(Number(localStorage.getItem('zenew_gift_count') || 0) + 1))
  } catch {
    /* ignore */
  }
  return true
}

export function giftCount(): number {
  return Number(localStorage.getItem('zenew_gift_count') || 0)
}

/* ============================================================
   词书学习计划（每日组数 → 完成天数 / 预计完成时间 / 每日用时）
   ============================================================ */
export interface BookPlan {
  groups: number
}

const PLAN_KEY = 'zenew_plan_v1'

export function getPlan(bookKey: string): BookPlan {
  try {
    const raw = localStorage.getItem(PLAN_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, BookPlan>) : {}
    return all[bookKey] || { groups: 3 }
  } catch {
    return { groups: 3 }
  }
}

export function savePlan(bookKey: string, plan: BookPlan): void {
  try {
    const raw = localStorage.getItem(PLAN_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, BookPlan>) : {}
    all[bookKey] = plan
    localStorage.setItem(PLAN_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

export const WORDS_PER_GROUP = 25
/** 每题约 25 秒 → 每日用时估算（分钟） */
export function estimateMinutes(words: number): number {
  return Math.max(1, Math.round((words * 25) / 60))
}

/* ============================================================
   首页/顶栏共用统计
   ============================================================ */
/** 连续学习天数（今天没学不清零，从昨天起算，避免早上打开看到 0）；只算词书单词卡 */
export async function loadStreak(): Promise<number> {
  try {
    const db = await getDb()
    const days = await db.select<{ d: string }[]>(
      `SELECT DISTINCT substr(rl.reviewed_at,1,10) AS d FROM review_log rl
       JOIN card c ON c.id = rl.card_id
       JOIN topic t ON t.id = c.topic_id
       JOIN course co ON co.id = t.course_id
       WHERE co.kind = 'vocab' AND c.type = 'word'
       ORDER BY d DESC LIMIT 90`
    )
    const daySet = new Set(days.map((r) => localDayKey(r.d + 'T00:00:00Z')))
    const cur = new Date()
    if (!daySet.has(localDayKey(cur))) cur.setDate(cur.getDate() - 1)
    let streak = 0
    for (;;) {
      const key = localDayKey(cur)
      if (daySet.has(key)) {
        streak++
        cur.setDate(cur.getDate() - 1)
      } else break
    }
    return streak
  } catch {
    return 0
  }
}

export interface HomeStats {
  due: number
  fresh: number
  learned: number
  mastered: number
  cut: number
  streak: number
}

/** 首页学习计划所需的聚合数据（口径：词书单词卡 co.kind='vocab' AND c.type='word'） */
export async function loadHomeStats(newLimit: number): Promise<HomeStats> {
  const db = await getDb()
  const now = new Date().toISOString()
  const due = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM card_state cs
     JOIN card c ON c.id = cs.card_id
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     WHERE co.kind = 'vocab' AND c.type = 'word' AND c.suspended = 0 AND cs.due <= ? AND cs.state != 0`,
    [now]
  )
  const fresh = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM card c
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     LEFT JOIN card_state cs ON cs.card_id = c.id
     WHERE co.kind = 'vocab' AND c.type = 'word' AND c.suspended = 0 AND cs.card_id IS NULL`
  )
  const learned = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM card_state cs
     JOIN card c ON c.id = cs.card_id
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     WHERE co.kind = 'vocab' AND c.type = 'word' AND cs.state != 0`
  )
  const mastered = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM card_state cs
     JOIN card c ON c.id = cs.card_id
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     WHERE co.kind = 'vocab' AND c.type = 'word' AND cs.state = 2 AND cs.stability >= 21`
  )
  const cut = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM card c
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     WHERE co.kind = 'vocab' AND c.type = 'word' AND c.suspended = 1`
  )
  return {
    due: Number(due[0]?.n || 0),
    fresh: Math.min(Number(fresh[0]?.n || 0), newLimit),
    learned: Number(learned[0]?.n || 0),
    mastered: Number(mastered[0]?.n || 0),
    cut: Number(cut[0]?.n || 0),
    streak: await loadStreak(),
  }
}

/** 未来 N 天复习预测（按到期日聚合，只算词书单词卡） */
export async function forecastDays(n = 10): Promise<{ label: string; count: number; overdue: boolean }[]> {
  try {
    const db = await getDb()
    const rows = await db.select<{ due: string }[]>(
      `SELECT cs.due FROM card_state cs
       JOIN card c ON c.id = cs.card_id
       JOIN topic t ON t.id = c.topic_id
       JOIN course co ON co.id = t.course_id
       WHERE co.kind = 'vocab' AND c.type = 'word' AND c.suspended = 0 AND cs.state != 0`
    )
    const buckets = new Array(n).fill(0) as number[]
    const overdueIdx = 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (const r of rows) {
      const d = new Date(r.due)
      const dayStart = new Date(d)
      dayStart.setHours(0, 0, 0, 0)
      const diff = Math.round((dayStart.getTime() - today.getTime()) / 86400000)
      if (diff <= 0) buckets[overdueIdx]++
      else if (diff < n) buckets[diff]++
    }
    const labels = ['今天', '明天', '后天']
    return buckets.map((count, i) => ({
      label: i < labels.length ? labels[i] : `${i}天后`,
      count,
      overdue: i === 0,
    }))
  } catch {
    return Array.from({ length: n }, (_, i) => ({ label: i === 0 ? '今天' : `${i}天后`, count: 0, overdue: i === 0 }))
  }
}

/** 最近 N 天累计学习曲线（用于进展面积图）；只算词书单词卡 */
export async function progressSeries(n = 10): Promise<{ label: string; value: number }[]> {
  try {
    const db = await getDb()
    const rows = await db.select<{ reviewed_at: string; card_id: number; rating: number }[]>(
      `SELECT rl.reviewed_at, rl.card_id, rl.rating FROM review_log rl
       JOIN card c ON c.id = rl.card_id
       JOIN topic t ON t.id = c.topic_id
       JOIN course co ON co.id = t.course_id
       WHERE co.kind = 'vocab' AND c.type = 'word'
       ORDER BY rl.reviewed_at ASC`
    )
    const byDay = new Map<string, Set<number>>()
    for (const r of rows) {
      const k = localDayKey(r.reviewed_at)
      if (!byDay.has(k)) byDay.set(k, new Set())
      byDay.get(k)!.add(r.card_id)
    }
    const keys = [...byDay.keys()].sort()
    const out: { label: string; value: number }[] = []
    let cumulative = 0
    const recent = keys.slice(-n)
    for (const k of recent) {
      cumulative += byDay.get(k)!.size
      out.push({ label: k.slice(5), value: cumulative })
    }
    // 补齐到今天
    for (let i = out.length; i < n; i++) {
      const d = new Date(Date.now() - (n - 1 - i) * 86400000)
      out.push({ label: localDayKey(d).slice(5), value: cumulative })
    }
    return out
  } catch {
    return []
  }
}
