// 英语词书模块：四本内置词书（四级/六级/高频词/基础英语）+ 全量查词
// 数据经 CDN（lxlrwxs.top/zenew/dict/*.json），词条入本地库走与主题卡完全相同的 FSRS 复习循环。
// 词书 = 一门本地课程（kind='vocab'，名字与词书一致）；25 词一组 = 一个 topic（知识点）。
// 每词一张卡 type='word'：front=单词，back=紧凑 JSON（释义/音标/例句），由 ReviewSession 专属渲染。

export interface VocabEntry {
  w: string
  uk: string
  us: string
  m: { p: string; t: string }[]
  s: { e: string; c: string }[]
  r: number
}

export interface WordBook {
  key: 'cet4' | 'cet6' | 'freq' | 'basic'
  name: string
  desc: string
  file: string
}

export const WORD_BOOKS: WordBook[] = [
  { key: 'cet4', name: '英语四级', desc: 'CET-4 全部核心词', file: 'cet4.json' },
  { key: 'cet6', name: '英语六级', desc: 'CET-6 全部核心词', file: 'cet6.json' },
  { key: 'freq', name: '高频词', desc: '真实语料词频排序', file: 'freq.json' },
  { key: 'basic', name: '基础英语', desc: '初中 + 高中考纲', file: 'basic.json' },
]

import type Database from '@tauri-apps/plugin-sql'

const CDN = 'https://lxlrwxs.top/zenew/dict'

export interface IndexItem {
  w: string
  m: { p: string; t: string }[]
  p: { ph: string; t: string }[]
  src: string[]
}

let indexPromise: Promise<IndexItem[]> | null = null

/** 全量搜索索引（14,625 词：四书 + 考研 + 托福 + SAT，懒加载；失败不缓存，下次自动重试） */
export function loadIndex(): Promise<IndexItem[]> {
  if (!indexPromise) {
    indexPromise = fetch(`${CDN}/index.json`)
      .then((r) => {
        if (!r.ok) throw new Error('词库索引加载失败')
        return r.json() as Promise<IndexItem[]>
      })
      .catch((e) => {
        indexPromise = null // 允许重试
        throw e
      })
  }
  return indexPromise
}

/** 词书详情（懒加载；失败不缓存，下次自动重试） */
const bookCache = new Map<string, Promise<VocabEntry[]>>()
export function loadBook(file: string): Promise<VocabEntry[]> {
  let p = bookCache.get(file)
  if (!p) {
    p = fetch(`${CDN}/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error('词书加载失败')
        return r.json() as Promise<VocabEntry[]>
      })
      .catch((e) => {
        bookCache.delete(file) // 允许重试
        throw e
      })
    bookCache.set(file, p)
  }
  return p
}

// ---------- 本地库同步 ----------

export interface WordCard {
  id: number
  topic_id: number
  front: string
  back: string
  suspended: number
  st: { state: number } | null
}

const BACK_LIMIT = 900

/** back 字段装不下的释义截断（保词性标签结构） */
function squeeze(e: VocabEntry): string {
  let payload = { m: e.m, s: e.s, uk: e.uk, us: e.us }
  let json = JSON.stringify(payload)
  if (json.length <= BACK_LIMIT) return json
  payload = { m: e.m.slice(0, 2), s: e.s.slice(0, 1), uk: e.uk, us: e.us }
  json = JSON.stringify(payload)
  if (json.length <= BACK_LIMIT) return json
  return JSON.stringify({ m: e.m.slice(0, 1).map((x) => ({ p: x.p, t: x.t.slice(0, 60) })), s: [], uk: e.uk, us: e.us })
}

/** 查某词书已导入的词数（按课程名精确匹配） */
export async function vocabCourseStats(bookName: string, dbQuery: (sql: string, args?: unknown[]) => Promise<Record<string, unknown>[]>): Promise<{ courseId: number | null; cards: number; learned: number }> {
  const rows = await dbQuery('SELECT id FROM course WHERE name=? AND kind=?', [bookName, 'vocab'])
  if (!rows.length) return { courseId: null, cards: 0, learned: 0 }
  const courseId = rows[0].id as number
  const c = await dbQuery(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN cs.state IS NOT NULL AND cs.state != 0 THEN 1 ELSE 0 END) AS learned
     FROM card c JOIN topic t ON t.id = c.topic_id
     LEFT JOIN card_state cs ON cs.card_id = c.id
     WHERE t.course_id = ? AND c.suspended = 0`,
    [courseId]
  )
  return { courseId, cards: Number(c[0]?.n ?? 0), learned: Number(c[0]?.learned ?? 0) }
}

const GROUP = 25 // 每组词数 = 一个知识点（复习混排按知识点打散）

/**
 * 向本地库导入词书的一个区段 [from, to)。
 * 幂等：已存在课程只补缺词；每 25 词一组 topic（组名「第 N 组」）。
 * 返回本次新导入词数。
 */
export async function importVocabRange(
  book: WordBook,
  entries: VocabEntry[],
  from: number,
  to: number,
  api: {
    db: Database
    dbQuery: (sql: string, args?: unknown[]) => Promise<Record<string, unknown>[]>
  }
): Promise<number> {
  const { db, dbQuery } = api
  const now = new Date().toISOString()
  let courseId: number
  const crows = await dbQuery('SELECT id FROM course WHERE name=? AND kind=?', [book.name, 'vocab'])
  if (crows.length) {
    courseId = crows[0].id as number
  } else {
    await db.execute('INSERT INTO course(name,kind,created_at) VALUES(?,?,?)', [book.name, 'vocab', now])
    const rows = await dbQuery('SELECT id FROM course WHERE name=? AND kind=?', [book.name, 'vocab'])
    courseId = rows[0].id as number
  }
  const slice = entries.slice(from, to)
  let added = 0
  for (let i = 0; i < slice.length; i += GROUP) {
    const group = slice.slice(i, i + GROUP)
    const groupNo = Math.floor((from + i) / GROUP) + 1
    const title = `第 ${groupNo} 组`
    let topicId: number
    const trows = await dbQuery('SELECT id FROM topic WHERE course_id=? AND title=? AND parent_id IS NULL', [courseId, title])
    if (trows.length) {
      topicId = trows[0].id as number
    } else {
      await db.execute('INSERT INTO topic(course_id,title,sort,status) VALUES(?,?,?,?)', [courseId, title, groupNo, 'active'])
      const rt = await dbQuery('SELECT id FROM topic WHERE course_id=? AND title=? AND parent_id IS NULL', [courseId, title])
      topicId = rt[0].id as number
    }
    for (const e of group) {
      const dup = await dbQuery('SELECT id FROM card WHERE topic_id=? AND front=?', [topicId, e.w])
      if (dup.length) continue
      await db.execute('INSERT INTO card(topic_id,type,front,back,explanation,created_at) VALUES(?,?,?,?,?,?)', [
        topicId,
        'word',
        e.w,
        squeeze(e),
        '',
        now,
      ])
      added++
    }
  }
  return added
}

/** 查词 → 加入生词本（独立课程「生词本」，进同一复习循环） */
export async function addWordToNotebook(
  word: string,
  detail: IndexItem | null,
  api: {
    db: Database
    dbQuery: (sql: string, args?: unknown[]) => Promise<Record<string, unknown>[]>
  }
): Promise<'added' | 'exists'> {
  const { db, dbQuery } = api
  const now = new Date().toISOString()
  const NAME = '生词本'
  let courseId: number
  const crows = await dbQuery('SELECT id FROM course WHERE name=? AND kind=?', [NAME, 'vocab'])
  if (crows.length) {
    courseId = crows[0].id as number
  } else {
    await db.execute('INSERT INTO course(name,kind,created_at) VALUES(?,?,?)', [NAME, 'vocab', now])
    const rows = await dbQuery('SELECT id FROM course WHERE name=? AND kind=?', [NAME, 'vocab'])
    courseId = rows[0].id as number
  }
  let topicId: number
  const trows = await dbQuery('SELECT id FROM topic WHERE course_id=? AND title=? AND parent_id IS NULL', [courseId, '收藏'])
  if (trows.length) {
    topicId = trows[0].id as number
  } else {
    await db.execute('INSERT INTO topic(course_id,title,sort,status) VALUES(?,?,?,?)', [courseId, '收藏', 1, 'active'])
    const rt = await dbQuery('SELECT id FROM topic WHERE course_id=? AND title=? AND parent_id IS NULL', [courseId, '收藏'])
    topicId = rt[0].id as number
  }
  const dup = await dbQuery(
    'SELECT c.id FROM card c JOIN topic t ON t.id=c.topic_id WHERE t.course_id=? AND c.front=?',
    [courseId, word]
  )
  if (dup.length) return 'exists'
  const entry: VocabEntry = {
    w: word,
    uk: '',
    us: '',
    m: detail?.m?.length ? detail.m : [{ p: '', t: '（收藏时未找到释义）' }],
    s: [],
    r: 0,
  }
  await db.execute('INSERT INTO card(topic_id,type,front,back,explanation,created_at) VALUES(?,?,?,?,?,?)', [
    topicId,
    'word',
    word,
    squeeze(entry),
    '',
    now,
  ])
  return 'added'
}
