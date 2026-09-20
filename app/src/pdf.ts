// 教材 PDF 流水线：解析 → 分段 → 提取知识点 → 后台自动建卡（渐进落库，可边学边解析）
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getDb, nowIso } from './db'
import { api, genCards, ApiError, type GenCard } from './api'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface PipelineEvent {
  onStage?: (stage: 'reading' | 'parsing' | 'extracting' | 'cards', detail: string) => void
  onCourseCreated?: (courseId: number) => void
  /** 新章节建立时触发一次（不是每段落都触发） */
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

interface ParsedSegment {
  chapter: string
  text: string
}

const MIN_CHARS_PER_PAGE = 20 // 少于此视为扫描页，跳过
const SEGMENT_CHARS = 4500   // 每段字符数（喂给 LLM 提知识点）
const CHAPTER_RE = /^\s*(第\s*[一二三四五六七八九十百0-9０-９]+\s*[章讲篇部]|Chapter\s+\d+)/i
/** 目录/习题类行：点导引、以页码结尾、或是常见 non-正文章节名 → 不作为章标题切分 */
const TOC_RE = /(\.{3,}|…{2,}|\s\d{1,3}\s*$|习题|思考题|练习题|参考文献|目录|索引|附录\s*[A-Z]?$)/
const isRealChapterLine = (ln: string): boolean => {
  if (ln.length > 32) return false
  if (TOC_RE.test(ln)) return false
  // 章标题后面若紧跟大段正文同页，说明是正文起页（正常）
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
    // 章标题检测：任何位置出现「第X章」独立短行；跳过与当前章同名的页眉、目录行与习题行
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

/** 后台流水线：解析 → 建章节/知识点 → 自动生成卡片。随时可中断，全部渐进落库 */
export async function runImportPipeline(file: File, courseName: string, ev: PipelineEvent = {}): Promise<PipelineResult> {
  const db = await getDb()

  // 1. 立即建课程（用户马上能看见）
  const r = await db.execute('INSERT INTO course(name, kind, created_at) VALUES(?,?,?)', [courseName || file.name.replace(/\.pdf$/i, ''), 'pdf', nowIso()])
  const courseId = Number(r.lastInsertId)
  ev.onCourseCreated?.(courseId) // 立刻可点「边解析边学习」

  // 2. 解析（异步，不阻塞 UI）
  ev.onStage?.('reading', file.name)
  const buf = await file.arrayBuffer()
  const segments = await parsePdf(buf, ev)

  // 3. 逐段：提取知识点 → 落库 → 自动建卡
  let totalTopics = 0
  let totalCards = 0
  let failedSegments = 0
  let quotaExhausted = false
  const seenChapters = new Map<string, number>()
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    // 段级提取：429 有限次重试，其他错误计数后跳过（不再静默）
    let topics: string[] | null = null
    for (let attempt = 0; attempt < 4 && topics === null; attempt++) {
      try {
        ev.onStage?.('extracting', `${seg.chapter}（${i + 1}/${segments.length}）${attempt ? ` · 重试 ${attempt}` : ''}`)
        const res = (await api('/gen/outline-segment', {
          method: 'POST',
          body: { text: seg.text, course: courseName },
          timeoutMs: 120000,
        })) as { topics: string[] }
        topics = res.topics || []
      } catch (e: any) {
        const status = e instanceof ApiError ? e.status : 0
        if (status === 402) {
          // 额度耗尽：中止整条流水线（继续跑只会每段都失败）
          quotaExhausted = true
          failedSegments += segments.length - i
          ev.onStage?.('cards', '额度不足，已停止解析（可在课程页补齐卡片）')
          break
        }
        if (status === 429) {
          await new Promise((r) => setTimeout(r, 15000 * (attempt + 1))) // 退避递增，真重试
          continue
        }
        console.warn('段提取失败，跳过', seg.chapter, e)
        break
      }
    }
    if (quotaExhausted) break
    if (topics === null) {
      failedSegments++
      continue
    }
    if (!topics.length) continue

    try {
      // 章节去重：同章的后续段落追加知识点
      let chId = seenChapters.get(seg.chapter)
      if (!chId) {
        const rr = await db.execute('INSERT INTO topic(course_id, parent_id, title, sort) VALUES(?,NULL,?,?)', [courseId, seg.chapter, seenChapters.size])
        chId = Number(rr.lastInsertId)
        seenChapters.set(seg.chapter, chId)
        ev.onChapterReady?.(seg.chapter) // 仅新章触发一次
      }
      const sort = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM topic WHERE parent_id=?', [chId])
      let tSort = sort[0]?.n || 0
      const topicIds: number[] = []
      for (const tp of topics) {
        const dup = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM topic WHERE parent_id=? AND title=?', [chId, tp])
        if (dup[0]?.n) continue
        const tr = await db.execute('INSERT INTO topic(course_id, parent_id, title, sort) VALUES(?,?,?,?)', [courseId, chId, tp, tSort++])
        topicIds.push(Number(tr.lastInsertId))
        totalTopics++
      }
      if (topicIds.length) ev.onTopics?.(topicIds.length)

      // 4. 自动建卡（每知识点 3 张；逐个落库，可随时开始学）
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
              totalCards++
            }
            ev.onCards?.(totalCards)
            done = true
          } catch (e: any) {
            const status = e instanceof ApiError ? e.status : 0
            if (status === 402) {
              quotaExhausted = true
              ev.onStage?.('cards', '额度不足，建卡暂停（大纲已保留，可稍后在课程页补齐）')
              break
            }
            if (status === 429) {
              await new Promise((r) => setTimeout(r, 15000 * (attempt + 1))) // 真重试（原实现是等待后直接跳过）
              continue
            }
            console.warn('建卡失败', title, e)
            break
          }
        }
        if (quotaExhausted) break
      }
    } catch (e) {
      console.warn('段落落库失败，跳过', seg.chapter, e)
      failedSegments++
    }
    if (quotaExhausted) break
  }
  const summary = `完成：${seenChapters.size} 章 · ${totalTopics} 个知识点 · ${totalCards} 张卡${failedSegments ? ` · 失败 ${failedSegments} 段` : ''}`
  ev.onStage?.('cards', quotaExhausted ? `额度不足，已停止：${seenChapters.size} 章 · ${totalTopics} 知识点 · ${totalCards} 张卡` : summary)
  return { courseId, chapters: seenChapters.size, topics: totalTopics, cards: totalCards, failedSegments, quotaExhausted }
}
