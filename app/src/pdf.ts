// 教材 PDF 流水线：解析 → 分段落库 → 提取知识点 → 后台自动建卡
// 关键特性：全部状态落库（可关软件后继续）、可导入到已有课程、渐进可学
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getDb, nowIso } from './db'
import { api, genCards, ApiError, type GenCard } from './api'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface PipelineEvent {
  onStage?: (stage: 'reading' | 'parsing' | 'extracting' | 'cards', detail: string) => void
  onCourseCreated?: (courseId: number) => void
  /** 新章节建立时触发一次 */
  onChapterReady?: (chapterTitle: string) => void
  /** 知识点增量落库后触发 */
  onTopics?: (added: number) => void
  onCards?: (n: number) => void
}

export interface PipelineResult {
  courseId: number
  chapters: number
  topics: number
  cards: number
  failedSegments: number
  quotaExhausted: boolean
}

export type ImportStatus = 'none' | 'parsing' | 'processing' | 'paused' | 'done' | 'error'

/** 未完成导入的课程（用于「继续导入」入口） */
export interface PendingImport {
  courseId: number
  name: string
  fileName: string
  status: ImportStatus
  total: number
  done: number
  failed: number
}

interface ParsedSegment {
  chapter: string
  text: string
}

interface SegmentRow {
  id: number
  seg_index: number
  chapter: string
  text: string
  status: string
}

const MIN_CHARS_PER_PAGE = 20 // 少于此视为扫描页，跳过
const SEGMENT_CHARS = 4500   // 每段字符数（喂给 LLM 提知识点）
const CHAPTER_RE = /^\s*(第\s*[一二三四五六七八九十百0-9０-９]+\s*[章讲篇部]|Chapter\s+\d+)/i
/** 目录/习题类行：点导引、以页码结尾、或非正文章节名 → 不作为章标题切分 */
const TOC_RE = /(\.{3,}|…{2,}|\s\d{1,3}\s*$|习题|思考题|练习题|参考文献|目录|索引|附录\s*[A-Z]?$)/
const isRealChapterLine = (ln: string): boolean => {
  if (ln.length > 32) return false
  if (TOC_RE.test(ln)) return false
  return true
}

/** 解析 PDF → 按「第X章」分段的文本 */
async function parsePdf(data: ArrayBuffer, ev: PipelineEvent): Promise<ParsedSegment[]> {
  const pdf = await pdfjsLib.getDocument({ data }).promise
  ev.onStage?.('parsing', `共 ${pdf.numPages} 页`)

  const segments: ParsedSegment[] = []
  let chapter = '前言'
  let buf = ''
  let scanned = 0

  for (let p = 1; p <= pdf.numPages; p++) {
    ev.onStage?.('parsing', `第 ${p}/${pdf.numPages} 页`)
    const page = await pdf.getPage(p)
    const tc = await page.getTextContent()
    // 按 y 坐标重组成行（pdf.js 返回的是无序文本片段）
    const linesMap = new Map<number, { x: number; s: string }[]>()
    for (const it of tc.items as any[]) {
      if (!it.str) continue
      const y = Math.round(it.transform[5] / 4) * 4 // 4pt 容差合并同行
      if (!linesMap.has(y)) linesMap.set(y, [])
      linesMap.get(y)!.push({ x: it.transform[4], s: it.str })
    }
    const ys = [...linesMap.keys()].sort((a, b) => b - a) // 从上到下
    const lines = ys.map((y) =>
      linesMap
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((w) => w.s)
        .join('')
        .trim()
    ).filter(Boolean)
    const text = lines.join('\n')
    if (text.trim().length < MIN_CHARS_PER_PAGE) {
      scanned++
      continue
    }
    // 章标题检测：独立短行；跳过同名页眉、目录行与习题行
    for (const ln of lines) {
      if (CHAPTER_RE.test(ln) && ln !== chapter && isRealChapterLine(ln)) {
        if (buf.trim().length > 200) segments.push({ chapter, text: buf })
        chapter = ln.slice(0, 40).replace(/\s+/g, ' ').trim()
        buf = ''
        break
      }
    }
    buf += (buf ? '\n' : '') + text
    if (buf.length >= SEGMENT_CHARS) {
      segments.push({ chapter, text: buf.slice(0, SEGMENT_CHARS * 1.6) })
      buf = ''
    }
  }
  if (buf.trim().length > 200) segments.push({ chapter, text: buf })
  ev.onStage?.('parsing', `识别 ${segments.length} 段，跳过扫描页 ${scanned}`)
  return segments
}

/** 处理单个待办段落：提取知识点 → 落库 → 建卡；成功后标记 done */
async function processSegment(
  db: Awaited<ReturnType<typeof getDb>>,
  courseId: number,
  courseName: string,
  seg: SegmentRow,
  seenChapters: Map<string, number>,
  counters: { topics: number; cards: number; failed: number },
  ev: PipelineEvent
): Promise<{ ok: boolean; quota: boolean }> {
  // 1) 提取知识点（429 退避重试；402 上报额度耗尽）
  let topics: string[] | null = null
  for (let attempt = 0; attempt < 4 && topics === null; attempt++) {
    try {
      ev.onStage?.('extracting', `${seg.chapter}${attempt ? ` · 重试 ${attempt}` : ''}`)
      const res = (await api('/gen/outline-segment', {
        method: 'POST',
        body: { text: seg.text, course: courseName },
        timeoutMs: 120000,
      })) as { topics: string[] }
      topics = res.topics || []
    } catch (e: unknown) {
      const status = e instanceof ApiError ? e.status : 0
      if (status === 402) return { ok: false, quota: true }
      if (status === 429) {
        await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)))
        continue
      }
      console.warn('段提取失败', seg.chapter, e)
      break
    }
  }
  if (topics === null) {
    await db.execute("UPDATE import_segment SET status='failed', error=? WHERE id=?", ['提取失败', seg.id])
    counters.failed++
    return { ok: false, quota: false }
  }

  // 2) 章节与知识点落库（同章追加）
  let chId = seenChapters.get(seg.chapter)
  if (!chId) {
    const rr = await db.execute('INSERT INTO topic(course_id, parent_id, title, sort) VALUES(?,NULL,?,?)', [courseId, seg.chapter, seenChapters.size])
    chId = Number(rr.lastInsertId)
    seenChapters.set(seg.chapter, chId)
    ev.onChapterReady?.(seg.chapter)
  }
  const sort = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM topic WHERE parent_id=?', [chId])
  let tSort = sort[0]?.n || 0
  const topicIds: number[] = []
  for (const tp of topics) {
    const dup = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM topic WHERE parent_id=? AND title=?', [chId, tp])
    if (dup[0]?.n) continue
    const tr = await db.execute('INSERT INTO topic(course_id, parent_id, title, sort) VALUES(?,?,?,?)', [courseId, chId, tp, tSort++])
    topicIds.push(Number(tr.lastInsertId))
    counters.topics++
  }
  if (topicIds.length) ev.onTopics?.(topicIds.length)

  // 3) 每个知识点自动建卡（429 真重试；402 上报）
  for (const tid of topicIds) {
    const title = (await db.select<{ title: string }[]>('SELECT title FROM topic WHERE id=?', [tid]))[0]?.title || ''
    let done = false
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const res = await genCards(title, seg.text.slice(0, 2500), 3, ['basic', 'why', 'choice'], { course: courseName, chapter: seg.chapter })
        for (const cd of res.cards as GenCard[]) {
          await db.execute(
            'INSERT INTO card(topic_id,type,front,back,explanation,choices_json,answer_index,created_at) VALUES(?,?,?,?,?,?,?,?)',
            [tid, cd.type, cd.front, cd.back, cd.explanation, cd.choices ? JSON.stringify(cd.choices) : null, cd.answer_index ?? null, nowIso()]
          )
          counters.cards++
        }
        ev.onCards?.(counters.cards)
        done = true
      } catch (e: unknown) {
        const status = e instanceof ApiError ? e.status : 0
        if (status === 402) return { ok: false, quota: true }
        if (status === 429) {
          await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)))
          continue
        }
        console.warn('建卡失败', title, e)
        break
      }
    }
  }
  await db.execute("UPDATE import_segment SET status='done', error=NULL WHERE id=?", [seg.id])
  return { ok: true, quota: false }
}

/** 按待办段落推进流水线（新建导入与断点续传共用） */
async function runPending(
  db: Awaited<ReturnType<typeof getDb>>,
  courseId: number,
  courseName: string,
  ev: PipelineEvent
): Promise<PipelineResult> {
  const pending = await db.select<SegmentRow[]>(
    "SELECT id, seg_index, chapter, text, status FROM import_segment WHERE course_id=? AND status='pending' ORDER BY seg_index",
    [courseId]
  )
  // 恢复时重建已有章节映射（避免重复建章）
  const chRows = await db.select<{ id: number; title: string }[]>(
    'SELECT id, title FROM topic WHERE course_id=? AND parent_id IS NULL ORDER BY sort',
    [courseId]
  )
  const seenChapters = new Map<string, number>(chRows.map((r) => [r.title, r.id]))
  const counters = { topics: 0, cards: 0, failed: 0 }
  let quotaExhausted = false

  for (const seg of pending) {
    const r = await processSegment(db, courseId, courseName, seg, seenChapters, counters, ev)
    if (r.quota) {
      quotaExhausted = true
      break
    }
  }

  const failedRows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM import_segment WHERE course_id=? AND status='failed'",
    [courseId]
  )
  const pendingLeft = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM import_segment WHERE course_id=? AND status='pending'",
    [courseId]
  )
  const failed = (failedRows[0]?.n || 0)
  const left = pendingLeft[0]?.n || 0
  const status: ImportStatus = quotaExhausted ? 'paused' : left > 0 ? 'paused' : failed > 0 ? 'error' : 'done'
  await db.execute('UPDATE course SET import_status=? WHERE id=?', [status, courseId])

  const topicCount = await db.select<{ n: number }[]>(
    'SELECT COUNT(*) AS n FROM topic WHERE course_id=? AND parent_id IS NOT NULL',
    [courseId]
  )
  const cardCount = await db.select<{ n: number }[]>(
    'SELECT COUNT(*) AS n FROM card WHERE topic_id IN (SELECT id FROM topic WHERE course_id=?)',
    [courseId]
  )
  return {
    courseId,
    chapters: seenChapters.size,
    topics: topicCount[0]?.n || 0,
    cards: cardCount[0]?.n || 0,
    failedSegments: failed,
    quotaExhausted,
  }
}

/** 一次性完成导入：新建课程（或导入到已有课程）→ 解析 → 段落落库 → 逐段提取/建卡 */
export async function runImportPipeline(
  file: File,
  courseName: string,
  opts: { existingCourseId?: number } = {},
  ev: PipelineEvent = {}
): Promise<PipelineResult> {
  const db = await getDb()
  const name = courseName || file.name.replace(/\.pdf$/i, '')

  // 1. 课程：新建或复用已有
  let courseId: number
  if (opts.existingCourseId) {
    courseId = opts.existingCourseId
    await db.execute("UPDATE course SET import_status='parsing', import_name=? WHERE id=?", [file.name, courseId])
  } else {
    const r = await db.execute('INSERT INTO course(name, kind, created_at, import_status, import_name) VALUES(?,?,?,?,?)', [name, 'pdf', nowIso(), 'parsing', file.name])
    courseId = Number(r.lastInsertId)
  }
  ev.onCourseCreated?.(courseId) // 立刻可点「边解析边学习」

  // 2. 解析（内存中）→ 段落落库（断点续传的依据）
  ev.onStage?.('reading', file.name)
  const buf = await file.arrayBuffer()
  let segments: ParsedSegment[]
  try {
    segments = await parsePdf(buf, ev)
  } catch (e) {
    console.error('PDF 解析失败', e)
    await db.execute("UPDATE course SET import_status='error' WHERE id=?", [courseId])
    throw new Error('PDF 解析失败：文件可能已损坏或被加密')
  }

  await db.execute('DELETE FROM import_segment WHERE course_id=? AND status!=?', [courseId, 'done'])
  for (let i = 0; i < segments.length; i++) {
    await db.execute('INSERT INTO import_segment(course_id, seg_index, chapter, text, status) VALUES(?,?,?,?,?)', [
      courseId,
      i,
      segments[i].chapter,
      segments[i].text,
      'pending',
    ])
  }
  await db.execute("UPDATE course SET import_status='processing', import_total=? WHERE id=?", [segments.length, courseId])

  // 3. 记录来源文档
  await db.execute('INSERT INTO source_doc(course_id, filename, pages, parsed_at) VALUES(?,?,?,?)', [courseId, file.name, null, nowIso()])

  // 4. 逐段推进
  const res = await runPending(db, courseId, name, ev)
  const summary = res.quotaExhausted
    ? `额度不足，已暂停：${res.chapters} 章 · ${res.topics} 知识点 · ${res.cards} 张卡（可充值后继续导入）`
    : `完成：${res.chapters} 章 · ${res.topics} 个知识点 · ${res.cards} 张卡${res.failedSegments ? ` · 失败 ${res.failedSegments} 段` : ''}`
  ev.onStage?.('cards', summary)
  return res
}

/** 断点续传：继续处理该课程剩余的待办段落 */
export async function resumeImport(courseId: number, ev: PipelineEvent = {}): Promise<PipelineResult> {
  const db = await getDb()
  const rows = await db.select<{ name: string; import_name: string | null }[]>(
    'SELECT name, import_name FROM course WHERE id=?',
    [courseId]
  )
  if (!rows.length) throw new Error('课程不存在')
  const name = rows[0].name
  await db.execute("UPDATE course SET import_status='processing' WHERE id=?", [courseId])
  const res = await runPending(db, courseId, name, ev)
  const summary = res.quotaExhausted
    ? `额度不足，仍暂停：${res.topics} 知识点 · ${res.cards} 张卡`
    : `续传完成：${res.chapters} 章 · ${res.topics} 个知识点 · ${res.cards} 张卡${res.failedSegments ? ` · 失败 ${res.failedSegments} 段` : ''}`
  ev.onStage?.('cards', summary)
  return res
}

/** 放弃未完成的导入：清掉待办段落并把状态归为完成（已落库的知识点/卡片保留） */
export async function dropPendingImport(courseId: number): Promise<void> {
  const db = await getDb()
  await db.execute("DELETE FROM import_segment WHERE course_id=? AND status='pending'", [courseId])
  await db.execute("UPDATE course SET import_status='done' WHERE id=?", [courseId])
}

/** 列出未完成的导入（启动时提示「继续导入」） */
export async function listPendingImports(): Promise<PendingImport[]> {
  const db = await getDb()
  const rows = await db.select<{ id: number; name: string; import_name: string | null; import_status: string; import_total: number }[]>(
    "SELECT id, name, import_name, import_status, import_total FROM course WHERE import_status IN ('parsing','processing','paused') ORDER BY id DESC"
  )
  const out: PendingImport[] = []
  for (const r of rows) {
    const done = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM import_segment WHERE course_id=? AND status='done'", [r.id])
    const failed = await db.select<{ n: number }[]>("SELECT COUNT(*) AS n FROM import_segment WHERE course_id=? AND status='failed'", [r.id])
    out.push({
      courseId: r.id,
      name: r.name,
      fileName: r.import_name || '',
      status: r.import_status as ImportStatus,
      total: r.import_total || 0,
      done: done[0]?.n || 0,
      failed: failed[0]?.n || 0,
    })
  }
  return out
}
