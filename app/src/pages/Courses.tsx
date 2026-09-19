import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDb, insertOutline, type CourseRow } from '../db'
import { genOutline, ApiError } from '../api'
import { runImportPipeline } from '../pdf'
import { Plus, ChevronRight, FileUp } from 'lucide-react'

interface CourseInfo extends CourseRow {
  topicCount: number
  cardCount: number
  masteredCount?: number
}

interface ImportState {
  running: boolean
  stage: string
  detail: string
  chapters: number
  topics: number
  cards: number
  courseId: number | null
}

export default function Courses() {
  const nav = useNavigate()
  const [list, setList] = useState<CourseInfo[]>([])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [imp, setImp] = useState<ImportState>({ running: false, stage: '', detail: '', chapters: 0, topics: 0, cards: 0, courseId: null })
  const fileRef = useRef<HTMLInputElement>(null)
  const impRef = useRef(imp)
  impRef.current = imp

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

  /** 导入期间定时刷新列表（知识点/卡片渐进出现） */
  useEffect(() => {
    if (!imp.running) return
    const t = setInterval(() => load().catch(() => {}), 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imp.running])

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

  const startImport = async (file: File) => {
    if (imp.running) return
    setImp({ running: true, stage: 'reading', detail: file.name, chapters: 0, topics: 0, cards: 0, courseId: null })
    try {
      const r = await runImportPipeline(file, file.name.replace(/\.pdf$/i, ''), {
        onStage: (stage, detail) => setImp((s) => ({ ...s, stage, detail })),
        onCourseCreated: (cid) => setImp((s) => ({ ...s, courseId: cid })),
        onChapterReady: () => setImp((s) => ({ ...s, chapters: s.chapters + 1, topics: s.topics + 1 })),
        onCards: (n) => setImp((s) => ({ ...s, cards: n })),
      })
      setImp((s) => ({ ...s, running: false, stage: 'done', detail: `完成：${r.chapters} 章 · ${r.topics} 知识点 · ${r.cards} 张卡`, courseId: r.courseId }))
    } catch (e) {
      setImp((s) => ({ ...s, running: false, stage: 'error', detail: e instanceof Error ? e.message : '导入失败' }))
    }
    await load()
  }

  return (
    <div className="page-in">
      <div className="kicker">COURSES / {String(list.length).padStart(2, '0')}</div>
      <div className="page-title">课程</div>

      {imp.running && (
        <div className="card fade-up" style={{ marginTop: 16, padding: '16px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="dot" style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--gold)', animation: 'breathe 1.4s infinite' }} />
            <b style={{ fontSize: 13.5 }}>
              {imp.stage === 'reading' && '读取 PDF'}
              {imp.stage === 'parsing' && '解析中'}
              {imp.stage === 'extracting' && '提取知识点'}
              {imp.stage === 'cards' && '自动建卡'}
            </b>
            <span className="row-meta" style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 11 }}>{imp.detail}</span>
            {imp.courseId && (
              <button className="btn btn-sm btn-primary" onClick={() => nav(`/courses/${imp.courseId}`)}>
                边解析边学习 →
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, paddingLeft: 19, fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)' }}>
            <span>章节 {imp.chapters}</span>
            <span>知识点 {imp.topics}</span>
            <span>卡片 {imp.cards}</span>
            <span style={{ marginLeft: 'auto' }}>可随时离开本页，后台继续</span>
          </div>
        </div>
      )}

      <div className="rows" style={{ marginTop: 24 }}>
        {list.map((c, i) => (
          <div key={c.id} className="row" onClick={() => nav(`/courses/${c.id}`)}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', width: 22 }}>{String(i + 1).padStart(2, '0')}</span>
            <div style={{ flex: 1 }}>
              <div className="row-title">
                {c.name}
                {c.kind === 'pdf' && <span className="tag tag-mono" style={{ marginLeft: 8, textTransform: 'none' }}>教材</span>}
              </div>
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
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <input
          className="input"
          placeholder="导入自己的教材 PDF（本地解析，扫描页自动跳过）"
          readOnly
          onClick={() => fileRef.current?.click()}
          style={{ cursor: 'pointer', color: 'var(--ink-2)' }}
        />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <FileUp size={14} /> 选择文件
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) startImport(f)
            e.target.value = ''
          }}
        />
      </div>
      {err && <div className="error-text">{err}</div>}
    </div>
  )
}
