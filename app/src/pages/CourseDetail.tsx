import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getDb } from '../db'
import { genCards, ApiError, type GenCard } from '../api'

interface TopicRow {
  id: number
  parent_id: number | null
  title: string
  sort: number
}
interface TopicStat {
  total: number
  mastered: number
}

export default function CourseDetail() {
  const { id } = useParams()
  const courseId = Number(id)
  const [courseName, setCourseName] = useState('')
  const [chapters, setChapters] = useState<{ ch: TopicRow; topics: (TopicRow & { stat: TopicStat })[] }[]>([])
  const [genning, setGenning] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [err, setErr] = useState('')

  const load = async () => {
    const db = await getDb()
    const cs = await db.select<{ name: string }[]>('SELECT name FROM course WHERE id=?', [courseId])
    setCourseName(cs[0]?.name || '')
    const parents = await db.select<TopicRow[]>('SELECT * FROM topic WHERE course_id=? AND parent_id IS NULL ORDER BY sort', [courseId])
    const result: typeof chapters = []
    for (const ch of parents) {
      const kids = await db.select<TopicRow[]>('SELECT * FROM topic WHERE parent_id=? ORDER BY sort', [ch.id])
      const withStat: (TopicRow & { stat: TopicStat })[] = []
      for (const k of kids) {
        const total = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM card WHERE topic_id=?', [k.id])
        const mastered = await db.select<{ n: number }[]>(
          'SELECT COUNT(*) AS n FROM card c JOIN card_state s ON s.card_id=c.id WHERE c.topic_id=? AND s.state=2 AND s.stability>=21',
          [k.id]
        )
        withStat.push({ ...k, stat: { total: total[0]?.n || 0, mastered: mastered[0]?.n || 0 } })
      }
      result.push({ ch, topics: withStat })
    }
    setChapters(result)
  }

  useEffect(() => {
    load().catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId])

  const generate = async (topicId: number, title: string) => {
    setGenning(topicId)
    setErr('')
    setNotice('')
    try {
      const r = await genCards(title, null, 5)
      const db = await getDb()
      let added = 0
      for (const c of r.cards as GenCard[]) {
        await db.execute(
          'INSERT INTO card(topic_id,type,front,back,explanation,choices_json,answer_index,created_at) VALUES(?,?,?,?,?,?,?,?)',
          [topicId, c.type, c.front, c.back, c.explanation, c.choices ? JSON.stringify(c.choices) : null, c.answer_index ?? null, new Date().toISOString()]
        )
        added++
      }
      setNotice(`《${title}》生成 ${added} 张卡片${r.rejected?.length ? `，${r.rejected.length} 张未通过质检被丢弃` : ''}`)
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '生成失败')
    } finally {
      setGenning(null)
    }
  }

  return (
    <div>
      <div className="page-title">{courseName}</div>
      <div className="page-sub">点击知识点生成练习卡片（每张卡都是一次"先回忆再看答案"的提取练习）</div>
      {notice && (
        <div className="card" style={{ borderColor: 'var(--ok)', background: 'var(--ok-soft)', padding: 12 }}>
          <span style={{ color: 'var(--ok)', fontSize: 13 }}>{notice}</span>
        </div>
      )}
      {err && <div className="error-text">{err}</div>}

      {chapters.map(({ ch, topics }) => (
        <div key={ch.id} className="card">
          <div style={{ fontWeight: 700, marginBottom: 10 }}>{ch.title}</div>
          {topics.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div>{t.title}</div>
                {t.stat.total > 0 && (
                  <div className="bar" style={{ width: 180, marginTop: 4 }}>
                    <span className="seg-ok" style={{ width: `${(t.stat.mastered / t.stat.total) * 100}%` }} />
                    <span className="seg-accent" style={{ width: `${((t.stat.total - t.stat.mastered) / t.stat.total) * 100}%` }} />
                  </div>
                )}
              </div>
              <div className="muted" style={{ minWidth: 90, textAlign: 'right' }}>
                {t.stat.total > 0 ? `${t.stat.mastered}/${t.stat.total} 掌握` : '尚无卡片'}
              </div>
              <button className="btn" disabled={genning !== null} onClick={() => generate(t.id, t.title)}>
                {genning === t.id ? '生成中…' : t.stat.total > 0 ? '再生成 5 张' : '生成卡片'}
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
