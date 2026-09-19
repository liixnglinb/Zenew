import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getDb } from '../db'
import { genCards, ApiError, type GenCard } from '../api'

/** 每个知识点达标所需卡片数 */
const COVER_MIN = 3

interface TopicRow {
  id: number
  parent_id: number | null
  title: string
  sort: number
}
interface TopicWithStat extends TopicRow {
  total: number
  mastered: number
}
interface ChapterBlock {
  ch: TopicRow
  topics: TopicWithStat[]
}

interface BatchState {
  running: boolean
  total: number
  done: number
  current: string
  added: number
  rejected: number
  failed: number
  stop: boolean
}

export default function CourseDetail() {
  const { id } = useParams()
  const courseId = Number(id)
  const [courseName, setCourseName] = useState('')
  const [chapters, setChapters] = useState<ChapterBlock[]>([])
  const [genning, setGenning] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [err, setErr] = useState('')
  const [batch, setBatch] = useState<BatchState>({ running: false, total: 0, done: 0, current: '', added: 0, rejected: 0, failed: 0, stop: false })
  const batchRef = useRef(batch)
  batchRef.current = batch

  const load = async (): Promise<ChapterBlock[]> => {
    const db = await getDb()
    const cs = await db.select<{ name: string }[]>('SELECT name FROM course WHERE id=?', [courseId])
    setCourseName(cs[0]?.name || '')
    const parents = await db.select<TopicRow[]>('SELECT * FROM topic WHERE course_id=? AND parent_id IS NULL ORDER BY sort', [courseId])
    const result: ChapterBlock[] = []
    for (const ch of parents) {
      const kids = await db.select<TopicRow[]>('SELECT * FROM topic WHERE parent_id=? ORDER BY sort', [ch.id])
      const withStat: TopicWithStat[] = []
      for (const k of kids) {
        const total = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM card WHERE topic_id=?', [k.id])
        const mastered = await db.select<{ n: number }[]>(
          'SELECT COUNT(*) AS n FROM card c JOIN card_state s ON s.card_id=c.id WHERE c.topic_id=? AND s.state=2 AND s.stability>=21',
          [k.id]
        )
        withStat.push({ ...k, total: total[0]?.n || 0, mastered: mastered[0]?.n || 0 })
      }
      result.push({ ch, topics: withStat })
    }
    setChapters(result)
    return result
  }

  useEffect(() => {
    load().catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  /** 生成某个知识点的卡片：带上课程/章节上下文与已有题面（查重） */
  const genOne = async (topicId: number, title: string, chapterTitle: string, n = 5): Promise<{ added: number; rejected: number }> => {
    const db = await getDb()
    const existing = await db.select<{ front: string }[]>('SELECT front FROM card WHERE topic_id=?', [topicId])
    const avoid = existing.map((r) => r.front)
    const r = await genCards(title, null, n, ['basic', 'why', 'choice'], {
      course: courseName,
      chapter: chapterTitle,
      avoid,
    })
    let added = 0
    for (const c of r.cards as GenCard[]) {
      await db.execute(
        'INSERT INTO card(topic_id,type,front,back,explanation,choices_json,answer_index,created_at) VALUES(?,?,?,?,?,?,?,?)',
        [topicId, c.type, c.front, c.back, c.explanation, c.choices ? JSON.stringify(c.choices) : null, c.answer_index ?? null, new Date().toISOString()]
      )
      added++
    }
    return { added, rejected: (r.rejected as unknown[])?.length || 0 }
  }

  /** 单个知识点按钮 */
  const generate = async (topicId: number, title: string, chapterTitle: string) => {
    if (batch.running) return
    setGenning(topicId)
    setErr('')
    setNotice('')
    try {
      const { added, rejected } = await genOne(topicId, title, chapterTitle)
      setNotice(`《${title}》+${added} 张${rejected ? ` · 质检丢弃 ${rejected}` : ''}`)
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '生成失败')
    } finally {
      setGenning(null)
    }
  }

  /** 批量生成：targets 为空则取全部；onlyMissing=true 时只补未达标知识点 */
  const runBatch = async (targets: { topic: TopicWithStat; chapter: string }[], label: string) => {
    if (batch.running || !targets.length) return
    setErr('')
    setNotice('')
    setBatch({ running: true, total: targets.length, done: 0, current: '', added: 0, rejected: 0, failed: 0, stop: false })
    let added = 0
    let rejected = 0
    let failed = 0
    for (let i = 0; i < targets.length; i++) {
      if (batchRef.current.stop) break
      const { topic, chapter } = targets[i]
      setBatch((b) => ({ ...b, current: topic.title, done: i }))
      let ok = false
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const need = Math.max(3, COVER_MIN + 2 - topic.total)
          const r = await genOne(topic.id, topic.title, chapter, Math.min(6, need))
          added += r.added
          rejected += r.rejected
          ok = true
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 0
          if (status === 429) {
            await new Promise((r) => setTimeout(r, 15000)) // 限流：等 15 秒重试
          } else if (status === 402) {
            setErr('额度不足，去「设置 → 兑换充值码」充值后继续（已生成部分保留）')
            failed += targets.length - i
            setBatch((b) => ({ ...b, running: false, added, rejected, failed }))
            await load()
            return
          } else {
            failed++
            break
          }
        }
      }
      setBatch((b) => ({ ...b, done: i + 1, added, rejected, failed }))
      await new Promise((r) => setTimeout(r, 1200)) // 轻微节流
    }
    setBatch((b) => ({ ...b, running: false, current: '' }))
    setNotice(`${label}完成：+${added} 张${rejected ? ` · 质检丢弃 ${rejected}` : ''}${failed ? ` · 失败 ${failed}` : ''}`)
    await load()
  }

  const allTargets = () => chapters.flatMap(({ ch, topics }) => topics.map((t) => ({ topic: t, chapter: ch.title })))
  const missingTargets = () => chapters.flatMap(({ ch, topics }) => topics.filter((t) => t.total < COVER_MIN).map((t) => ({ topic: t, chapter: ch.title })))

  const totalTopics = chapters.reduce((n, c) => n + c.topics.length, 0)
  const coveredTopics = chapters.reduce((n, c) => n + c.topics.filter((t) => t.total >= COVER_MIN).length, 0)
  const totalCards = chapters.reduce((n, c) => n + c.topics.reduce((m, t) => m + t.total, 0), 0)
  const pct = totalTopics ? Math.round((coveredTopics / totalTopics) * 100) : 0

  return (
    <div className="page-in">
      <div className="kicker">COURSE / 覆盖度 {coveredTopics}/{totalTopics}</div>
      <div className="page-title">{courseName}</div>

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div className="bar" style={{ flex: 1, minWidth: 160, height: 6 }}>
            <span className="seg-gold" style={{ width: `${pct}%` }} />
          </div>
          <span className="tag tag-mono tag-gold">知识点覆盖 {pct}%</span>
          <span className="tag tag-mono">{totalCards} 张卡</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" disabled={batch.running || !missingTargets().length} onClick={() => runBatch(missingTargets(), '补齐未覆盖')}>
            补齐未覆盖（{missingTargets().length}）
          </button>
          <button className="btn btn-sm" disabled={batch.running} onClick={() => runBatch(allTargets(), '整课生成')}>
            整课生成（{totalTopics} 个知识点）
          </button>
          {batch.running && (
            <button className="btn btn-sm" onClick={() => setBatch((b) => ({ ...b, stop: true }))}>停止</button>
          )}
        </div>
        {batch.running && (
          <div style={{ marginTop: 12 }}>
            <div className="bar" style={{ height: 5 }}>
              <span className="seg-gold" style={{ width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%` }} />
            </div>
            <div className="row-meta" style={{ fontFamily: 'var(--mono)', fontSize: 10.5, marginTop: 6 }}>
              正在生成 {batch.done + 1}/{batch.total}：{batch.current} · 已入库 +{batch.added}{batch.rejected ? ` · 质检丢弃 ${batch.rejected}` : ''}{batch.failed ? ` · 失败 ${batch.failed}` : ''}
            </div>
          </div>
        )}
      </div>

      {notice && <span className="tag tag-ok fade-up" style={{ marginTop: 12, display: 'inline-flex' }}>{notice}</span>}
      {err && <div className="error-text">{err}</div>}

      <div style={{ marginTop: 22 }}>
        {chapters.map(({ ch, topics }, ci) => {
          const covered = topics.filter((t) => t.total >= COVER_MIN).length
          return (
            <div key={ch.id} style={{ marginBottom: 26 }}>
              <div className="section-label" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>CH {String(ci + 1).padStart(2, '0')} — {ch.title}</span>
                <span className="tag tag-mono" style={{ textTransform: 'none' }}>{covered}/{topics.length}</span>
                <button
                  className="btn btn-sm"
                  style={{ marginLeft: 'auto' }}
                  disabled={batch.running}
                  onClick={() => runBatch(topics.map((t) => ({ topic: t, chapter: ch.title })), `本章（${ch.title}）`)}
                >
                  生成本章
                </button>
              </div>
              <div className="rows">
                {topics.map((t) => {
                  const ok = t.total >= COVER_MIN
                  return (
                    <div key={t.id} className="row" style={{ cursor: 'default' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row-title" style={{ fontWeight: 500 }}>
                          {t.title}
                          {ok && <span style={{ color: 'var(--green)', marginLeft: 8, fontSize: 12 }}>✓ 已覆盖</span>}
                        </div>
                        {t.total > 0 && (
                          <div className="bar" style={{ width: 140, marginTop: 6 }}>
                            <span className="seg-ok" style={{ width: `${(t.mastered / t.total) * 100}%` }} />
                            <span className="seg-gold" style={{ width: `${((t.total - t.mastered) / t.total) * 100}%` }} />
                          </div>
                        )}
                      </div>
                      <span className="row-meta" style={{ minWidth: 78, textAlign: 'right' }}>
                        {t.total > 0 ? `${t.total} 张` : '—'}
                      </span>
                      <button className="btn btn-sm" disabled={batch.running || genning === t.id} onClick={() => generate(t.id, t.title, ch.title)}>
                        {genning === t.id ? '···' : ok ? '+5' : '生成'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
