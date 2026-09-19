import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDb, insertOutline, type CourseRow } from '../db'
import { genOutline, ApiError } from '../api'
import { Plus, ChevronRight } from 'lucide-react'

interface CourseInfo extends CourseRow {
  topicCount: number
  cardCount: number
  masteredCount?: number
}

export default function Courses() {
  const nav = useNavigate()
  const [list, setList] = useState<CourseInfo[]>([])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async () => {
    const db = await getDb()
    const courses = await db.select<CourseRow[]>('SELECT * FROM course ORDER BY id')
    const infos: CourseInfo[] = []
    for (const c of courses) {
      const t = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM topic WHERE course_id=? AND parent_id IS NOT NULL', [c.id])
      const cd = await db.select<{ n: number }[]>(
        'SELECT COUNT(*) AS n FROM card WHERE topic_id IN (SELECT id FROM topic WHERE course_id=?)',
        [c.id]
      )
      const m = await db.select<{ n: number }[]>(
        'SELECT COUNT(*) AS n FROM card c JOIN card_state s ON s.card_id=c.id WHERE c.topic_id IN (SELECT id FROM topic WHERE course_id=?) AND s.state=2 AND s.stability>=21',
        [c.id]
      )
      infos.push({ ...c, topicCount: t[0]?.n || 0, cardCount: cd[0]?.n || 0, masteredCount: m[0]?.n || 0 } as CourseInfo)
    }
    setList(infos)
  }

  useEffect(() => {
    load().catch(console.error)
  }, [])

  const createByName = async () => {
    if (!newName.trim()) return
    setBusy(true)
    setErr('')
    try {
      const r = await genOutline(newName.trim(), 5)
      const db = await getDb()
      const cr = await db.execute('INSERT INTO course(name, kind, created_at) VALUES(?,?,?)', [newName.trim(), 'generated', new Date().toISOString()])
      await insertOutline(db, Number(cr.lastInsertId), { chapters: r.outline })
      setNewName('')
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-in">
      <div className="kicker">COURSES / {String(list.length).padStart(2, '0')}</div>
      <div className="page-title">课程</div>

      <div className="rows" style={{ marginTop: 24 }}>
        {list.map((c, i) => (
          <div key={c.id} className="row" onClick={() => nav(`/courses/${c.id}`)}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', width: 22 }}>{String(i + 1).padStart(2, '0')}</span>
            <div style={{ flex: 1 }}>
              <div className="row-title">{c.name}</div>
              {(c.masteredCount || 0) > 0 && (
                <div className="bar" style={{ width: 110, height: 3, marginTop: 6 }}>
                  <span className="seg-gold" style={{ width: `${((c.masteredCount || 0) / c.cardCount) * 100}%` }} />
                </div>
              )}
            </div>
            <span className="row-meta">{c.topicCount} 知识点 · {c.cardCount} 卡片</span>
            <ChevronRight size={15} style={{ color: 'var(--ink-3)' }} />
          </div>
        ))}
      </div>

      <div className="section-label" style={{ marginTop: 30 }}>NEW COURSE</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          className="input"
          placeholder="输入课程名，生成大纲"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createByName()}
        />
        <button className="btn btn-primary" disabled={busy || !newName.trim()} onClick={createByName}>
          <Plus size={14} /> {busy ? '生成中' : '生成大纲'}
        </button>
      </div>
      {err && <div className="error-text">{err}</div>}
    </div>
  )
}
