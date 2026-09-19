import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDb, type CourseRow } from '../db'
import { genOutline, ApiError } from '../api'
import { insertOutline } from '../db'
import { Plus } from 'lucide-react'

interface CourseInfo extends CourseRow {
  topicCount: number
  cardCount: number
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
      infos.push({ ...c, topicCount: t[0]?.n || 0, cardCount: cd[0]?.n || 0 })
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
      setErr(e instanceof ApiError ? e.message : '生成失败，请确认已登录且服务可用')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-title">课程</div>
      <div className="page-sub">内置课程可直接生成卡片，也可输入任意课程名生成大纲（经云端网关）</div>

      {list.map((c) => (
        <div key={c.id} className="card" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => nav(`/courses/${c.id}`)}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{c.name}</div>
            <div className="muted">
              {c.topicCount} 个知识点 · {c.cardCount} 张卡片 {c.kind === 'generated' ? '· 自建' : ''}
            </div>
          </div>
          <span className="tag">查看</span>
        </div>
      ))}

      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>新建课程</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="input" placeholder="课程名，如：机器学习导论、电路原理" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createByName()} />
          <button className="btn btn-primary" disabled={busy || !newName.trim()} onClick={createByName}>
            <Plus size={15} /> {busy ? '生成中…' : '生成大纲'}
          </button>
        </div>
        {err && <div className="error-text">{err}</div>}
        <div className="muted" style={{ marginTop: 8 }}>AI 按课程名生成章节与知识点树；随后在课程详情里逐个知识点生成卡片。</div>
      </div>
    </div>
  )
}
