// 教材 PDF 流水线：解析 → 分段 → 提取知识点 → 后台自动建卡（渐进落库，可边学边解析）
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getDb, insertOutline, nowIso } from './db'
import { api, genCards, type GenCard } from './api'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface PipelineEvent {
  onStage?: (stage: 'reading' | 'parsing' | 'extracting' | 'cards', detail: string) => void
  onCourseCreated?: (courseId: number) => void
  onChapterReady?: (chapterTitle: string, topics: number) => void
  onCards?: (n: number) => void
}

interface ParsedSegment {
  chapter: string
  text: string
}

const MIN_CHARS_PER_PAGE = 20 // 少于此视为扫描页，跳过
const SEGMENT_CHARS = 4500   // 每段字符数（喂给 LLM 提知识点）
const CHAPTER_RE = /^\s*(第\s*[一二三四五六七八九十百0-9０-９]+\s*[章讲篇部]|Chapter\s+\d+)/i

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
    // 章标题检测：任何位置出现「第X章」独立短行；跳过与当前章同名的页眉
    for (const ln of lines) {
      if (CHAPTER_RE.test(ln) && ln.length <= 32 && ln !== chapter) {
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
export async function runImportPipeline(file: File, courseName: string, ev: PipelineEvent = {}): Promise<{ courseId: number; chapters: number; topics: number; cards: number }> {
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
  const seenChapters = new Map<string, number>()
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    try {
      ev.onStage?.('extracting', `${seg.chapter}（${i + 1}/${segments.length}）`)
      const { topics } = await api('/gen/outline-segment', {
        method: 'POST',
        body: { text: seg.text, course: courseName },
      }) as { topics: string[] }
      if (!topics.length) continue

      // 章节去重：同章的后续段落追加知识点
      let chId = seenChapters.get(seg.chapter)
      if (!chId) {
        const rr = await db.execute('INSERT INTO topic(course_id, parent_id, title, sort) VALUES(?,NULL,?,?)', [courseId, seg.chapter, seenChapters.size])
        chId = Number(rr.lastInsertId)
        seenChapters.set(seg.chapter, chId)
        ev.onChapterReady?.(seg.chapter, topics.length)
      }
      let sort = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM topic WHERE parent_id=?', [chId])
      let tSort = sort[0]?.n || 0
      const topicIds: number[] = []
      for (const tp of topics) {
        const dup = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM topic WHERE parent_id=? AND title=?', [chId, tp])
        if (dup[0]?.n) continue
        const tr = await db.execute('INSERT INTO topic(course_id, parent_id, title, sort) VALUES(?,?,?,?)', [courseId, chId, tp, tSort++])
        topicIds.push(Number(tr.lastInsertId))
        totalTopics++
      }
      ev.onChapterReady?.(seg.chapter, topicIds.length)

      // 4. 自动建卡（每知识点 3 张；逐个落库，可随时开始学）
      for (const tid of topicIds) {
        const title = (await db.select<{ title: string }[]>('SELECT title FROM topic WHERE id=?', [tid]))[0]?.title || ''
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
        } catch (e: any) {
          if (String(e?.message || e).includes('402') || String(e?.status) === '402') {
            ev.onStage?.('cards', '额度不足，解析继续（建卡暂停，稍后可在课程页补齐）')
            // 建卡暂停但大纲继续落库
            break
          }
          await new Promise((r) => setTimeout(r, 8000)) // 429 等待重试
        }
      }
    } catch (e: any) {
      if (String(e?.message || e).includes('429') || String(e?.status) === '429') {
        await new Promise((r) => setTimeout(r, 15000))
        i-- // 重试本段
      }
      // 其他错误：跳过本段继续
    }
  }
  ev.onStage?.('cards', `完成：${seenChapters.size} 章 · ${totalTopics} 个知识点 · ${totalCards} 张卡`)
  void insertOutline
  return { courseId, chapters: seenChapters.size, topics: totalTopics, cards: totalCards }
}
