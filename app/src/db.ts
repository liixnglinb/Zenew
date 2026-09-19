// 本地 SQLite：通过 tauri-plugin-sql，数据落应用数据目录 zenew.db
import Database from '@tauri-apps/plugin-sql'
import { fetchCourses } from './api'

let dbInstance: Database | null = null

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getDb(): Promise<Database> {
  if (!isTauri()) throw new Error('仅在桌面应用内可用（需通过 tauri dev 启动）')
  if (!dbInstance) dbInstance = await Database.load('sqlite:zenew.db')
  return dbInstance
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS course(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'seed', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS topic(id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, parent_id INTEGER, title TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE IF NOT EXISTS source_doc(id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, filename TEXT NOT NULL, pages INTEGER, parsed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS card(id INTEGER PRIMARY KEY AUTOINCREMENT, topic_id INTEGER NOT NULL, type TEXT NOT NULL, front TEXT NOT NULL, back TEXT NOT NULL, explanation TEXT NOT NULL DEFAULT '', choices_json TEXT, answer_index INTEGER, lint_ok INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, suspended INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS card_state(card_id INTEGER PRIMARY KEY, due TEXT NOT NULL, stability REAL NOT NULL DEFAULT 0, difficulty REAL NOT NULL DEFAULT 0, elapsed_days REAL NOT NULL DEFAULT 0, scheduled_days INTEGER NOT NULL DEFAULT 0, reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0, state INTEGER NOT NULL DEFAULT 0, last_review TEXT);
CREATE TABLE IF NOT EXISTS review_log(id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL, rating INTEGER NOT NULL, reviewed_at TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS exam(id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER NOT NULL, title TEXT NOT NULL, exam_date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS _zenew_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

let schemaInit: Promise<void> | null = null

export async function ensureSchema(): Promise<void> {
  // StrictMode 下 useEffect 双触发，保证只初始化一次
  if (!schemaInit) {
    schemaInit = doEnsureSchema().catch((e) => {
      schemaInit = null
      throw e
    })
  }
  return schemaInit
}

async function doEnsureSchema(): Promise<void> {
  const db = await getDb()
  for (const stmt of SCHEMA_V1.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.execute(stmt)
  }
  const seeded = await db.select<{ value: string }[]>("SELECT value FROM _zenew_meta WHERE key='seed_version'")
  if (seeded.length === 0) {
    await seedCourses(db)
    await db.execute("INSERT INTO _zenew_meta(key, value) VALUES('seed_version','1')")
  }
}

async function seedCourses(db: Database): Promise<void> {
  const { courses } = await fetchCourses()
  for (const c of courses) {
    const r = await db.execute('INSERT INTO course(name, kind, created_at) VALUES(?,?,?)', [c.name, 'seed', nowIso()])
    const courseId = Number(r.lastInsertId)
    await insertOutline(db, courseId, c)
  }
}

// 章节作为父知识点（parent_id NULL），知识点挂在章节下
export async function insertOutline(db: Database, courseId: number, def: { chapters: { title: string; topics: string[] }[] }) {
  let sort = 0
  for (const ch of def.chapters) {
    const r = await db.execute('INSERT INTO topic(course_id, parent_id, title, sort) VALUES(?,NULL,?,?)', [courseId, ch.title, sort++])
    const chId = Number(r.lastInsertId)
    let t = 0
    for (const tp of ch.topics) {
      await db.execute('INSERT INTO topic(course_id, parent_id, title, sort) VALUES(?,?,?,?)', [courseId, chId, tp, t++])
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

// ---- 查询辅助 ----

export interface TopicRow {
  id: number; course_id: number; parent_id: number | null; title: string; sort: number; status: string
}
export interface CardRow {
  id: number; topic_id: number; type: string; front: string; back: string; explanation: string
  choices_json: string | null; answer_index: number | null; suspended: number
}
export interface StateRow {
  card_id: number; due: string; stability: number; difficulty: number; elapsed_days: number
  scheduled_days: number; reps: number; lapses: number; state: number; last_review: string | null
}
export interface CourseRow { id: number; name: string; kind: string }
export interface QueueItem extends CardRow {
  topic_title: string; course_name: string
  st: StateRow | null
}

// 待复习队列：到期卡片 + 从未学过的卡片（state 为空视为新卡）
export async function loadQueue(nowIsoStr: string, newLimit = 10): Promise<QueueItem[]> {
  const db = await getDb()
  const due = await db.select<QueueItem[]>(
    `SELECT c.id, c.topic_id, c.type, c.front, c.back, c.explanation, c.choices_json, c.answer_index,
            t.title AS topic_title, co.name AS course_name,
            cs.card_id AS st_card_id, cs.due, cs.stability, cs.difficulty, cs.elapsed_days, cs.scheduled_days, cs.reps, cs.lapses, cs.state, cs.last_review
     FROM card c
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     JOIN card_state cs ON cs.card_id = c.id
     WHERE c.suspended = 0 AND cs.due <= ? AND cs.state != 0
     ORDER BY cs.due ASC LIMIT 60`,
    [nowIsoStr]
  )
  const fresh = await db.select<QueueItem[]>(
    `SELECT c.id, c.topic_id, c.type, c.front, c.back, c.explanation, c.choices_json, c.answer_index,
            t.title AS topic_title, co.name AS course_name,
            NULL AS st_card_id, NULL AS due, NULL AS stability, NULL AS difficulty, NULL AS elapsed_days, NULL AS scheduled_days, NULL AS reps, NULL AS lapses, NULL AS state, NULL AS last_review
     FROM card c
     JOIN topic t ON t.id = c.topic_id
     JOIN course co ON co.id = t.course_id
     LEFT JOIN card_state cs ON cs.card_id = c.id
     WHERE c.suspended = 0 AND cs.card_id IS NULL
     ORDER BY c.created_at DESC LIMIT ?`,
    [newLimit]
  )
  const map = (rows: unknown[]): QueueItem[] =>
    rows.map((row) => {
      const r = row as Record<string, unknown>
      const { st_card_id, st_due, ...rest } = r as never as Record<string, unknown>
      void st_card_id
      void st_due
      return {
        ...(rest as unknown as QueueItem),
        st: r.state === null || r.state === undefined ? null : {
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
      }
    })
  // 混排：合并新卡与到期卡，相邻卡片尽量不同知识点（同知识点最多连续 2 张）
  const merged = [...map(fresh as unknown[]), ...map(due as unknown[])]
  const out: QueueItem[] = []
  const pool = [...merged]
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
