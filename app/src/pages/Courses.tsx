import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDb, insertOutline, type CourseRow } from '../db'
import { genOutline, ApiError } from '../api'
import { runImportPipeline, resumeImport, dropPendingImport, listPendingImports, type PendingImport } from '../pdf'
import Select from '../components/Select'
import { Plus, ChevronRight, FileUp, Trash2 } from 'lucide-react'

interface CourseInfo extends CourseRow {
  topicCount: number
  cardCount: number
  masteredCount?: number
}

interface ImportState {
  running: boolean
  /** idle=未开始 running=进行中 done=完成 error=失败 */
  phase: 'idle' | 'running' | 'done' | 'error'
  stage: string
  detail: string
  chapters: number
  topics: number
  cards: number
  courseId: number | null
  failed: number
}

const EMPTY_IMP: ImportState = { running: false, phase: 'idle', stage: '', detail: '', chapters: 0, topics: 0, cards: 0, courseId: null, failed: 0 }

const STAGE_LABEL: Record<string, string> = {
  reading: '读取 PDF',
  parsing: '解析中',
  extracting: '提取知识点',
  cards: '自动建卡',
  done: '导入完成',
  error: '导入失败',
}

export default function Courses() {
  const nav = useNavigate()
  const [list, setList] = useState<CourseInfo[]>([])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [imp, setImp] = useState<ImportState>(EMPTY_IMP)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)
  const [pending, setPending] = useState<PendingImport[]>([])
  const [targetCourse, setTargetCourse] = useState<number | ''>('') // ''=新建课程
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const db = await getDb()
    // 单条聚合查询（原实现每课程 3 次往返，导入期每 4s 全量重跑）
    const rows = await db.select<(CourseRow & { topicCount: number; cardCount: number; masteredCount: number })[]>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM topic t WHERE t.course_id=c.id AND t.parent_id IS NOT NULL) AS topicCount,
              (SELECT COUNT(*) FROM card cd WHERE cd.topic_id IN (SELECT id FROM topic WHERE course_id=c.id)) AS cardCount,
              (SELECT COUNT(*) FROM card cd JOIN card_state s ON s.card_id=cd.id
                 WHERE cd.topic_id IN (SELECT id FROM topic WHERE course_id=c.id) AND s.state=2 AND s.stability>=21) AS masteredCount
       FROM course c ORDER BY c.id`
    )
    setList(rows as CourseInfo[])
  }

  useEffect(() => {
    load().catch(console.error)
    listPendingImports().then(setPending).catch(() => {})
  }, [])

  /** 导入期间定时刷新列表（知识点/卡片渐进出现） */
  useEffect(() => {
    if (!imp.running) return
    const t = setInterval(() => load().catch(() => {}), 7000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imp.running])

  const createByName = async () => {
    if (!newName.trim()) return
    const name = newName.trim()
    if (list.some((c) => c.name === name)) {
      setErr(`已存在同名课程「${name}」，请换个名字或直接进入该课程`)
      return
    }
    setBusy(true)
    setErr('')
    try {
      const r = await genOutline(name, 5)
      const db = await getDb()
      const cr = await db.execute('INSERT INTO course(name, kind, created_at) VALUES(?,?,?)', [name, 'generated', new Date().toISOString()])
      await insertOutline(db, Number(cr.lastInsertId), { chapters: r.outline })
      setNewName('')
      await load()
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.status === 429 ? '生成太频繁，请稍等一分钟再试' : e.status === 402 ? '额度不足，去「设置 → 兑换充值码」充值后重试' : e.message)
      } else {
        setErr('生成失败：请检查网络连接')
      }
    } finally {
      setBusy(false)
    }
  }

  const deleteCourse = async (c: CourseInfo) => {
    setConfirmDel(null)
    setErr('')
    try {
      const db = await getDb()
      await db.execute('BEGIN')
      await db.execute('DELETE FROM card_state WHERE card_id IN (SELECT id FROM card WHERE topic_id IN (SELECT id FROM topic WHERE course_id=?))', [c.id])
      await db.execute('DELETE FROM review_log WHERE card_id IN (SELECT id FROM card WHERE topic_id IN (SELECT id FROM topic WHERE course_id=?))', [c.id])
      await db.execute('DELETE FROM card WHERE topic_id IN (SELECT id FROM topic WHERE course_id=?)', [c.id])
      await db.execute('DELETE FROM topic WHERE course_id=?', [c.id])
      await db.execute('DELETE FROM exam WHERE course_id=?', [c.id])
      await db.execute('DELETE FROM course WHERE id=?', [c.id])
      await db.execute('COMMIT')
      await load()
    } catch (e) {
      const db = await getDb()
      await db.execute('ROLLBACK').catch(() => {})
      console.error(e)
      setErr('删除失败，请重试')
    }
  }

  const startImport = async (file: File) => {
    if (imp.running) return
    setImp({ ...EMPTY_IMP, running: true, phase: 'running', stage: 'reading', detail: file.name })
    const existing = typeof targetCourse === 'number' ? targetCourse : undefined
    const courseName = existing ? (list.find((c) => c.id === existing)?.name || '') : file.name.replace(/\.pdf$/i, '')
    try {
      const r = await runImportPipeline(
        file,
        courseName,
        { existingCourseId: existing },
        {
          onStage: (stage, detail) => setImp((s) => ({ ...s, stage, detail })),
          onCourseCreated: (cid) => setImp((s) => ({ ...s, courseId: cid })),
          onChapterReady: () => setImp((s) => ({ ...s, chapters: s.chapters + 1 })),
          onTopics: (added) => setImp((s) => ({ ...s, topics: s.topics + added })),
          onCards: (n) => setImp((s) => ({ ...s, cards: n })),
        }
      )
      setImp((s) => ({
        ...s,
        running: false,
        phase: r.quotaExhausted ? 'error' : 'done',
        stage: r.quotaExhausted ? 'error' : 'done',
        failed: r.failedSegments,
        detail: r.quotaExhausted
          ? `额度不足已暂停：${r.chapters} 章 · ${r.topics} 知识点 · ${r.cards} 张卡（充值后可在上方「继续导入」续传）`
          : `完成：${r.chapters} 章 · ${r.topics} 个知识点 · ${r.cards} 张卡${r.failedSegments ? ` · 失败 ${r.failedSegments} 段` : ''}`,
        courseId: r.courseId,
      }))
    } catch (e) {
      setImp((s) => ({
        ...s,
        running: false,
        phase: 'error',
        stage: 'error',
        detail: e instanceof Error ? e.message : '导入失败（文件可能损坏或不是有效 PDF）',
      }))
    }
    await load()
    listPendingImports().then(setPending).catch(() => {})
  }

  /** 断点续传未完成的导入 */
  const doResume = async (p: PendingImport) => {
    if (imp.running) return
    setImp({ ...EMPTY_IMP, running: true, phase: 'running', stage: 'extracting', detail: `继续导入 ${p.name}`, courseId: p.courseId })
    try {
      const r = await resumeImport(p.courseId, {
        onStage: (stage, detail) => setImp((s) => ({ ...s, stage, detail })),
        onChapterReady: () => setImp((s) => ({ ...s, chapters: s.chapters + 1 })),
        onTopics: (added) => setImp((s) => ({ ...s, topics: s.topics + added })),
        onCards: (n) => setImp((s) => ({ ...s, cards: n })),
      })
      setImp((s) => ({
        ...s,
        running: false,
        phase: r.quotaExhausted ? 'error' : 'done',
        stage: r.quotaExhausted ? 'error' : 'done',
        failed: r.failedSegments,
        detail: r.quotaExhausted
          ? `额度仍不足：${r.topics} 知识点 · ${r.cards} 张卡`
          : `续传完成：${r.chapters} 章 · ${r.topics} 个知识点 · ${r.cards} 张卡${r.failedSegments ? ` · 失败 ${r.failedSegments} 段` : ''}`,
      }))
    } catch (e) {
      setImp((s) => ({ ...s, running: false, phase: 'error', stage: 'error', detail: e instanceof Error ? e.message : '续传失败' }))
    }
    await load()
    listPendingImports().then(setPending).catch(() => {})
  }

  const doDrop = async (p: PendingImport) => {
    await dropPendingImport(p.courseId).catch(() => {})
    await load()
    listPendingImports().then(setPending).catch(() => {})
  }

  return (
    <div className="page-in">
      <div className="kicker">COURSES / {String(list.length).padStart(2, '0')}</div>
      <div className="page-title">课程</div>

      {imp.phase !== 'idle' && (
        <div
          className="card fade-up"
          style={{
            marginTop: 16,
            padding: '16px 22px',
            ...(imp.phase === 'error' ? { border: '1px solid var(--red-wash)', background: 'var(--red-wash)' } : imp.phase === 'done' ? { border: '1px solid var(--gold-line)', background: 'var(--gold-wash)' } : {}),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {imp.running && <span className="dot" style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--gold)', animation: 'breathe 1.4s infinite' }} />}
            <b style={{ fontSize: 13.5 }}>{STAGE_LABEL[imp.stage] || imp.stage}</b>
            <span className="row-meta" style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 11 }}>{imp.detail}</span>
            {imp.courseId && (
              <button className="btn btn-sm btn-primary" onClick={() => nav(`/courses/${imp.courseId}`)}>
                {imp.running ? '边解析边学习 →' : '查看课程 →'}
              </button>
            )}
            {!imp.running && (
              <button className="btn btn-sm" onClick={() => setImp(EMPTY_IMP)} title="关闭提示">
                知道了
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, paddingLeft: imp.running ? 19 : 0, fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--ink-3)' }}>
            <span>章节 {imp.chapters}</span>
            <span>知识点 {imp.topics}</span>
            <span>卡片 {imp.cards}</span>
            {imp.failed > 0 && <span style={{ color: 'var(--red)' }}>失败 {imp.failed} 段</span>}
            {imp.running && <span style={{ marginLeft: 'auto' }}>可随时离开本页，后台继续</span>}
          </div>
        </div>
      )}

      {pending.length > 0 && !imp.running && (
        <div className="card fade-up" style={{ marginTop: 16, padding: '16px 22px', border: '1px solid var(--gold-line)', background: 'var(--gold-wash)' }}>
          {pending.map((p) => (
            <div key={p.courseId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 13.5 }}>导入未完成</b>
              <span className="row-meta" style={{ flex: 1, fontSize: 11 }}>
                《{p.name}》{p.fileName ? ` · ${p.fileName}` : ''} · 已处理 {p.done}/{p.total || '?'} 段{p.failed ? ` · 失败 ${p.failed}` : ''}
                {p.status === 'parsing' ? ' · 解析未完成，需重新选择文件' : p.status === 'paused' ? ' · 已暂停（额度不足）' : ''}
              </span>
              {p.status !== 'parsing' && (
                <button className="btn btn-sm btn-primary" disabled={imp.running} onClick={() => doResume(p)}>
                  继续导入
                </button>
              )}
              <button className="btn btn-sm" onClick={() => doDrop(p)}>
                放弃剩余
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rows" style={{ marginTop: 24 }}>
        {list.map((c, i) => (
          <div key={c.id} className="row" style={{ padding: '10px 14px 10px 20px' }}>
            <button
              className="row-open"
              onClick={() => nav(`/courses/${c.id}`)}
              title={`打开 ${c.name}`}
              aria-label={`打开课程 ${c.name}`}
            >
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-3)', width: 22 }}>{String(i + 1).padStart(2, '0')}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row-title">
                  {c.name}
                  {c.kind === 'pdf' && <span className="tag tag-mono" style={{ marginLeft: 8, textTransform: 'none' }}>教材</span>}
                </div>
                {c.cardCount > 0 && (c.masteredCount || 0) > 0 && (
                  <div className="bar" style={{ width: 110, height: 3, marginTop: 6 }}>
                    <span className="seg-gold" style={{ width: `${((c.masteredCount || 0) / c.cardCount) * 100}%` }} />
                  </div>
                )}
              </div>
              <span className="row-meta">{c.topicCount} 知识点 · {c.cardCount} 卡片</span>
              <ChevronRight size={15} style={{ color: 'var(--ink-3)' }} />
            </button>
            {confirmDel === c.id ? (
              <>
                <button className="btn btn-sm" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => deleteCourse(c)}>
                  确认删除
                </button>
                <button className="btn btn-sm" onClick={() => setConfirmDel(null)}>
                  取消
                </button>
              </>
            ) : (
              <button
                className="row-del"
                title="删除课程（含知识点、卡片与学习记录）"
                aria-label={`删除课程 ${c.name}`}
                disabled={imp.running}
                onClick={() => setConfirmDel(c.id)}
              >
                <Trash2 size={14} strokeWidth={1.8} />
              </button>
            )}
          </div>
        ))}
        {list.length === 0 && (
          <div className="card" style={{ padding: '28px 30px', textAlign: 'left' }}>
            <div className="muted" style={{ fontSize: 13 }}>还没有课程。导入一本教材 PDF，或输入课程名让 AI 生成大纲。</div>
          </div>
        )}
      </div>

      <div className="section-label" style={{ marginTop: 30 }}>IMPORT PDF</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          value={targetCourse === '' ? '' : String(targetCourse)}
          onChange={(v) => setTargetCourse(v === '' ? '' : Number(v))}
          width={230}
          title="导入到新建课程，或追加到已有课程"
          options={[
            { value: '', label: '导入为新课程' },
            ...list.map((c) => ({ value: String(c.id), label: `追加到：${c.name}` })),
          ]}
        />
        <button className="btn" disabled={imp.running} onClick={() => fileRef.current?.click()}>
          <FileUp size={14} /> {imp.running ? '导入中…' : '选择 PDF'}
        </button>
        <span className="row-meta" style={{ fontSize: 11 }}>本地解析，扫描页自动跳过；中断后可续传</span>
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

      <div className="section-label" style={{ marginTop: 22 }}>NEW COURSE</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <input
          className="input"
          placeholder="输入课程名，生成大纲"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createByName()}
        />
        <button className="btn btn-primary" disabled={busy || imp.running || !newName.trim()} onClick={createByName}>
          <Plus size={14} /> {busy ? '生成中' : '生成大纲'}
        </button>
      </div>
      {err && <div className="error-text">{err}</div>}
    </div>
  )
}
