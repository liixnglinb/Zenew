import { useEffect, useState } from 'react'
import { getDb, localDayKey } from '../db'
import { CalendarDays, Plus, Trash2 } from 'lucide-react'

interface ExamRow {
  id: number
  course_id: number
  title: string
  exam_date: string
  course_name?: string
  topics?: number
  cards?: number
}

/** 距今天数（按本地日期，今天=0） */
export function daysUntil(dateStr: string): number {
  const today = new Date(localDayKey() + 'T00:00:00')
  const target = new Date(dateStr.slice(0, 10) + 'T00:00:00')
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export default function Exams() {
  const [list, setList] = useState<ExamRow[]>([])
  const [courses, setCourses] = useState<{ id: number; name: string }[]>([])
  const [courseId, setCourseId] = useState<number | ''>('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [err, setErr] = useState('')

  const load = async () => {
    const db = await getDb()
    const cs = await db.select<{ id: number; name: string }[]>('SELECT id, name FROM course ORDER BY id')
    setCourses(cs)
    const rows = await db.select<ExamRow[]>(
      `SELECT e.id, e.course_id, e.title, e.exam_date, c.name AS course_name,
              (SELECT COUNT(*) FROM topic t WHERE t.course_id=e.course_id AND t.parent_id IS NOT NULL) AS topics,
              (SELECT COUNT(*) FROM card cd WHERE cd.topic_id IN (SELECT id FROM topic WHERE course_id=e.course_id)) AS cards
       FROM exam e LEFT JOIN course c ON c.id=e.course_id
       ORDER BY e.exam_date ASC`
    )
    setList(rows)
    if (courseId === '' && cs.length) setCourseId(cs[0].id)
  }

  useEffect(() => {
    load().catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = async () => {
    if (!courseId || !title.trim() || !date) {
      setErr('请填写课程、考试名称与日期')
      return
    }
    setErr('')
    const db = await getDb()
    await db.execute('INSERT INTO exam(course_id, title, exam_date) VALUES(?,?,?)', [courseId, title.trim(), date])
    setTitle('')
    setDate('')
    await load()
  }

  const del = async (id: number) => {
    const db = await getDb()
    await db.execute('DELETE FROM exam WHERE id=?', [id])
    await load()
  }

  return (
    <div className="page-in">
      <div className="kicker">EXAMS / {String(list.length).padStart(2, '0')}</div>
      <div className="page-title">考试</div>
      <div className="page-sub">按考试日期倒推每日新学量，把复习排到考前</div>

      <div className="rows" style={{ marginTop: 8 }}>
        {list.map((e) => {
          const d = daysUntil(e.exam_date)
          // 建议每日新学量：剩余天数内把课程知识点过一遍
          const perDay = d > 0 && (e.topics || 0) > 0 ? Math.max(1, Math.ceil((e.topics || 0) / d)) : 0
          return (
            <div key={e.id} className="row" style={{ padding: '12px 14px 12px 20px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row-title">
                  {e.title}
                  {d >= 0 ? (
                    <span className={`tag ${d <= 7 ? 'tag-danger' : 'tag-gold'}`} style={{ marginLeft: 8 }}>
                      {d === 0 ? '今天' : `${d} 天后`}
                    </span>
                  ) : (
                    <span className="tag" style={{ marginLeft: 8 }}>已结束</span>
                  )}
                </div>
                <div className="row-meta" style={{ marginTop: 4 }}>
                  {e.course_name || '（课程已删除）'} · {e.exam_date.slice(0, 10)}
                  {perDay > 0 ? ` · 建议每天新学 ${perDay} 个知识点` : ''}
                </div>
              </div>
              <button className="row-del" title="删除考试" aria-label={`删除考试 ${e.title}`} onClick={() => del(e.id)}>
                <Trash2 size={14} strokeWidth={1.8} />
              </button>
            </div>
          )
        })}
        {list.length === 0 && (
          <div className="card" style={{ padding: '24px 28px' }}>
            <div className="muted" style={{ fontSize: 13 }}>还没有考试安排。添加后，今日页会显示倒计时与每日建议量。</div>
          </div>
        )}
      </div>

      <div className="section-label" style={{ marginTop: 28 }}>NEW EXAM</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 190, cursor: 'pointer' }} value={courseId} onChange={(e) => setCourseId(Number(e.target.value))}>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="考试名称（如 期末考试）" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" style={{ width: 170 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button className="btn btn-primary" onClick={add}>
          <Plus size={14} /> 添加
        </button>
      </div>
      {err && <div className="error-text">{err}</div>}
      <div className="today-hint fade-up" style={{ marginTop: 16 }}>
        <span className="dot" />
        <CalendarDays size={13} /> 建议量按「剩余知识点 ÷ 剩余天数」估算，仅供参考
      </div>
    </div>
  )
}
