import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  FileText,
  FileUp,
  Layers,
  ListChecks,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { getDb, insertOutline, type CourseRow } from '../db'
import { genOutline, ApiError } from '../api'
import { formatNumber } from '../lib/format'
import {
  runImportPipeline,
  resumeImport,
  dropPendingImport,
  listPendingImports,
  type ImportStatus,
  type PendingImport,
} from '../pdf'
import Select from '../components/Select'
import {
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  LoadingState,
  PageHeader,
  Progress,
  Spinner,
  Tag,
  useSubmit,
  useToast,
} from '../ui'

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

/** 导入阶段顺序（仅用于进度条视觉进度，不参与任何数据逻辑） */
const STAGE_STEPS = ['reading', 'parsing', 'extracting', 'cards']

/** 阶段图标：状态用「图标 + 文字」表达，不只靠颜色 */
function stageIcon(stage: string, running: boolean) {
  if (running) return <Spinner size={11} label="导入进行中" />
  switch (stage) {
    case 'reading':
      return <FileText size={11} />
    case 'parsing':
      return <FileSearch size={11} />
    case 'extracting':
      return <ListChecks size={11} />
    case 'cards':
      return <Layers size={11} />
    case 'done':
      return <CheckCircle2 size={11} />
    default:
      return <AlertTriangle size={11} />
  }
}

/** 未完成导入的状态标签（中性文案，不含任何商业化表述） */
function PendingTag({ status }: { status: ImportStatus }) {
  switch (status) {
    case 'parsing':
      return (
        <Tag tone="warning" icon={<FileSearch size={11} />}>
          待重选文件
        </Tag>
      )
    case 'paused':
      return (
        <Tag tone="neutral" icon={<Pause size={11} />}>
          已暂停
        </Tag>
      )
    case 'processing':
      return (
        <Tag tone="brand" icon={<Spinner size={11} label="处理中" />}>
          处理中
        </Tag>
      )
    case 'done':
      return (
        <Tag tone="success" icon={<CheckCircle2 size={11} />}>
          已完成
        </Tag>
      )
    case 'error':
      return (
        <Tag tone="danger" icon={<AlertTriangle size={11} />}>
          失败
        </Tag>
      )
    default:
      return (
        <Tag tone="neutral" icon={<AlertTriangle size={11} />}>
          待处理
        </Tag>
      )
  }
}

export default function Courses() {
  const nav = useNavigate()
  const toast = useToast()
  const [list, setList] = useState<CourseInfo[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [newName, setNewName] = useState('')
  const [nameErr, setNameErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [imp, setImp] = useState<ImportState>(EMPTY_IMP)
  const [confirmDel, setConfirmDel] = useState<CourseInfo | null>(null)
  const [deleting, runDelete] = useSubmit()
  const [pending, setPending] = useState<PendingImport[]>([])
  const [targetCourse, setTargetCourse] = useState<number | ''>('') // ''=新建课程
  const fileRef = useRef<HTMLInputElement>(null)
  const nameBoxRef = useRef<HTMLDivElement>(null)

  /** silent=true 用于导入期轮询：不切骨架屏、不覆盖错误态 */
  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setListLoading(true)
      setListError('')
    }
    try {
      const db = await getDb()
      // 单条聚合查询（原实现每课程 3 次往返，导入期每 7s 全量重跑）
      const rows = await db.select<(CourseRow & { topicCount: number; cardCount: number; masteredCount: number })[]>(
        `SELECT c.*,
                (SELECT COUNT(*) FROM topic t WHERE t.course_id=c.id AND t.parent_id IS NOT NULL) AS topicCount,
                (SELECT COUNT(*) FROM card cd WHERE cd.topic_id IN (SELECT id FROM topic WHERE course_id=c.id)) AS cardCount,
                (SELECT COUNT(*) FROM card cd JOIN card_state s ON s.card_id=cd.id
                   WHERE cd.topic_id IN (SELECT id FROM topic WHERE course_id=c.id) AND s.state=2 AND s.stability>=21) AS masteredCount
         FROM course c ORDER BY c.id`
      )
      setList(rows as CourseInfo[])
      setListError('')
    } catch (e) {
      if (!silent) setListError(e instanceof Error ? e.message : '课程列表读取失败，请稍后重试')
    } finally {
      if (!silent) setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    listPendingImports().then(setPending).catch(() => {})
  }, [load])

  /** 导入期间定时刷新列表（知识点/卡片渐进出现） */
  useEffect(() => {
    if (!imp.running) return
    const t = setInterval(() => {
      void load(true)
    }, 7000)
    return () => clearInterval(t)
  }, [imp.running, load])

  const createByName = async () => {
    if (!newName.trim() || busy) return
    const name = newName.trim()
    if (list.some((c) => c.name === name)) {
      setNameErr(`已存在同名课程「${name}」，请换个名字或直接进入该课程`)
      return
    }
    setBusy(true)
    setNameErr('')
    try {
      const r = await genOutline(name, 5)
      const db = await getDb()
      const cr = await db.execute('INSERT INTO course(name, kind, created_at) VALUES(?,?,?)', [name, 'generated', new Date().toISOString()])
      await insertOutline(db, Number(cr.lastInsertId), { chapters: r.outline })
      setNewName('')
      toast.success(`已生成课程「${name}」的大纲`)
      await load(true)
    } catch (e) {
      if (e instanceof ApiError) {
        toast.error(
          e.status === 429
            ? '生成太频繁，请稍等一分钟再试'
            : e.status === 402
              ? '服务端生成暂时不可用，请稍后重试（已生成的部分会保留）'
              : e.message
        )
      } else {
        toast.error('生成失败：请检查网络连接后重试')
      }
    } finally {
      setBusy(false)
    }
  }

  const deleteCourse = async (c: CourseInfo) => {
    await runDelete(async () => {
      try {
        const db = await getDb()
        // ⚠ tauri-plugin-sql 的 execute 走连接池，BEGIN/COMMIT 会落在不同连接上（事务撕裂），
        // 不能用显式事务。按依赖顺序逐条删；中途失败重按「删除课程」即可续删（每条语句幂等）。
        await db.execute('DELETE FROM card_state WHERE card_id IN (SELECT id FROM card WHERE topic_id IN (SELECT id FROM topic WHERE course_id=?))', [c.id])
        await db.execute('DELETE FROM review_log WHERE card_id IN (SELECT id FROM card WHERE topic_id IN (SELECT id FROM topic WHERE course_id=?))', [c.id])
        await db.execute('DELETE FROM card WHERE topic_id IN (SELECT id FROM topic WHERE course_id=?)', [c.id])
        await db.execute('DELETE FROM topic WHERE course_id=?', [c.id])
        await db.execute('DELETE FROM exam WHERE course_id=?', [c.id])
        await db.execute('DELETE FROM course WHERE id=?', [c.id])
        toast.success(`已删除课程「${c.name}」及其知识点、卡片与学习记录`)
        await load(true)
      } catch (e) {
        console.error(e)
        toast.error('删除失败，请重试')
      } finally {
        setConfirmDel(null)
      }
    })
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
          ? `已暂停：${formatNumber(r.chapters)} 章 · ${formatNumber(r.topics)} 知识点 · ${formatNumber(r.cards)} 张卡（服务端生成暂时不可用，可在上方「继续导入」续传）`
          : `完成：${formatNumber(r.chapters)} 章 · ${formatNumber(r.topics)} 个知识点 · ${formatNumber(r.cards)} 张卡${r.failedSegments ? ` · 失败 ${formatNumber(r.failedSegments)} 段` : ''}`,
        courseId: r.courseId,
      }))
      if (r.quotaExhausted) toast.warning('服务端生成暂时不可用，已完成的章节会保留，可稍后继续导入')
      else toast.success(`导入完成：${formatNumber(r.topics)} 个知识点 · ${formatNumber(r.cards)} 张卡`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '导入失败（文件可能损坏或不是有效 PDF）'
      setImp((s) => ({ ...s, running: false, phase: 'error', stage: 'error', detail: msg }))
      toast.error(msg)
    }
    await load(true)
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
          ? `已暂停：${formatNumber(r.topics)} 知识点 · ${formatNumber(r.cards)} 张卡（服务端生成暂时不可用，可在上方「继续导入」续传）`
          : `续传完成：${formatNumber(r.chapters)} 章 · ${formatNumber(r.topics)} 个知识点 · ${formatNumber(r.cards)} 张卡${r.failedSegments ? ` · 失败 ${formatNumber(r.failedSegments)} 段` : ''}`,
      }))
      if (r.quotaExhausted) toast.warning('服务端生成暂时不可用，已生成的部分会保留')
      else toast.success(`续传完成：新增 ${formatNumber(r.topics)} 个知识点 · ${formatNumber(r.cards)} 张卡`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '续传失败，请稍后重试'
      setImp((s) => ({ ...s, running: false, phase: 'error', stage: 'error', detail: msg }))
      toast.error(msg)
    }
    await load(true)
    listPendingImports().then(setPending).catch(() => {})
  }

  const doDrop = async (p: PendingImport) => {
    await dropPendingImport(p.courseId).catch(() => {})
    toast.info(`已放弃《${p.name}》的剩余导入`)
    await load(true)
    listPendingImports().then(setPending).catch(() => {})
  }

  /** 导入进度条的视觉百分比（按阶段推进） */
  const stagePct = imp.phase === 'done' || imp.phase === 'error'
    ? 100
    : Math.max(12, ((STAGE_STEPS.indexOf(imp.stage) + 1) / (STAGE_STEPS.length + 1)) * 100)
  const phaseText = imp.running ? '进行中' : imp.phase === 'done' ? '已完成' : '已中断'
  const stageTone = imp.phase === 'error' ? 'danger' : imp.phase === 'done' ? 'success' : 'brand'
  const detailCls = `row-meta spacer-flex ${imp.stage === 'reading' ? 'truncate' : 'wrap-anywhere'}`

  return (
    <div className="page-in">
      <PageHeader
        title="课程"
        kicker={`COURSES / ${String(list.length).padStart(2, '0')}`}
        onBack={() => nav(-1)}
        crumbs={[{ label: '课程' }]}
        onNavigate={(to) => nav(to)}
        actions={
          <IconButton label="刷新课程列表" onClick={() => { void load() }}>
            <RefreshCw size={17} />
          </IconButton>
        }
      />
      <p className="page-sub" style={{ marginTop: 0 }}>
        导入教材 PDF 自动提取知识点并建卡，或输入课程名让服务端先出一份课程大纲
      </p>

      {imp.phase !== 'idle' && (
        <Card className="fade-up">
          <div className="inline gap-3">
            <Tag tone={stageTone} icon={stageIcon(imp.stage, imp.running)}>
              {STAGE_LABEL[imp.stage] || imp.stage}
            </Tag>
            <Tag tone="neutral">{phaseText}</Tag>
            <span className={detailCls} title={imp.detail}>{imp.detail}</span>
            {imp.courseId && (
              <Button size="sm" variant="primary" iconRight={<ChevronRight size={14} />} onClick={() => nav(`/courses/${imp.courseId}`)}>
                {imp.running ? '边解析边学习' : '查看课程'}
              </Button>
            )}
            {!imp.running && (
              <Button size="sm" variant="outline" onClick={() => setImp(EMPTY_IMP)}>
                知道了
              </Button>
            )}
          </div>

          <Progress
            value={stagePct}
            tone={imp.phase === 'done' ? 'mint' : 'brand'}
            label={`导入进度 ${Math.round(stagePct)}%`}
            style={{ marginTop: 'var(--sp-3)' }}
          />

          <div className="inline gap-2 mt-3">
            <Tag tone="neutral" mono icon={<BookOpen size={11} />}>章节 {formatNumber(imp.chapters)}</Tag>
            <Tag tone="neutral" mono icon={<ListChecks size={11} />}>知识点 {formatNumber(imp.topics)}</Tag>
            <Tag tone="neutral" mono icon={<Layers size={11} />}>卡片 {formatNumber(imp.cards)}</Tag>
            {imp.failed > 0 && (
              <Tag tone="danger" mono icon={<AlertTriangle size={11} />}>失败 {formatNumber(imp.failed)} 段</Tag>
            )}
            {imp.running && <span className="row-meta" style={{ marginLeft: 'auto' }}>可随时离开本页，后台继续</span>}
          </div>
          <span className="sr-only" aria-live="polite">
            {`导入${STAGE_LABEL[imp.stage] || imp.stage}${phaseText}：章节 ${formatNumber(imp.chapters)} · 知识点 ${formatNumber(imp.topics)} · 卡片 ${formatNumber(imp.cards)}`}
          </span>
        </Card>
      )}

      {pending.length > 0 && !imp.running && (
        <Card className="fade-up">
          <div className="section-label">未完成的导入</div>
          <div className="stack">
            {pending.map((p) => {
              const tot = p.total || 0
              const ppct = tot ? Math.round((p.done / tot) * 100) : 0
              return (
                <div key={p.courseId}>
                  <div className="inline gap-3">
                    <b className="row-title truncate" style={{ flex: '1 1 auto', maxWidth: '100%' }} title={p.name}>
                      《{p.name}》
                    </b>
                    <PendingTag status={p.status} />
                    {p.fileName && (
                      <span className="row-meta truncate" style={{ flex: '1 1 auto', maxWidth: '100%' }} title={p.fileName}>
                        {p.fileName}
                      </span>
                    )}
                    <span className="row-meta" style={{ flex: '1 1 auto' }}>
                      已处理 {formatNumber(p.done)}/{tot ? formatNumber(tot) : '?'} 段
                      {p.failed ? ` · 失败 ${formatNumber(p.failed)}` : ''}
                      {p.status === 'parsing' ? ' · 解析未完成，需重新选择文件' : ''}
                      {p.status === 'paused' ? ' · 可在上方「继续导入」续传' : ''}
                    </span>
                    {p.status !== 'parsing' && (
                      <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => { void doResume(p) }}>
                        继续导入
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => { void doDrop(p) }}>
                      放弃剩余
                    </Button>
                  </div>
                  {tot > 0 && (
                    <Progress
                      value={p.done}
                      max={tot}
                      label={`《${p.name}》导入进度 ${ppct}%`}
                      style={{ marginTop: 'var(--sp-2)' }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {listLoading && <div className="mt-4"><LoadingState rows={3} title="正在读取课程列表" /></div>}

      {!listLoading && listError && (
        <div className="mt-4">
          <Card>
            <ErrorState title="课程列表读取失败" desc={listError} onRetry={() => { void load() }} />
          </Card>
        </div>
      )}

      {!listLoading && !listError && list.length === 0 && (
        <div className="mt-4">
          <Card>
            <EmptyState
              art={<BookOpen size={30} />}
              title="还没有课程"
              desc="导入一本教材 PDF，自动提取知识点并建卡；也可以输入课程名，先要一份课程大纲。"
              action={
                <>
                  <Button variant="primary" icon={<FileUp size={14} />} onClick={() => fileRef.current?.click()}>
                    导入教材 PDF
                  </Button>
                  <Button
                    variant="outline"
                    icon={<Sparkles size={14} />}
                    onClick={() => nameBoxRef.current?.querySelector('input')?.focus()}
                  >
                    输入课程名生成大纲
                  </Button>
                </>
              }
            />
          </Card>
        </div>
      )}

      {!listLoading && !listError && list.length > 0 && (
        <div className="stack mt-4">
          {list.map((c) => {
            const pct = c.cardCount > 0 ? Math.round(((c.masteredCount || 0) / c.cardCount) * 100) : 0
            return (
              <Card key={c.id} className="fade-up">
                <div className="inline" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
                  <Avatar seed={c.name} name={c.name} size="md" />
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div className="inline gap-2">
                      <span className="row-title truncate" style={{ flex: '1 1 auto', minWidth: 0 }} title={c.name}>
                        {c.name}
                      </span>
                      {c.kind === 'pdf' && (
                        <Tag tone="warning" mono icon={<FileText size={11} />}>教材</Tag>
                      )}
                      {c.cardCount > 0 && pct >= 100 && (
                        <Tag tone="success" icon={<Check size={11} />}>已掌握</Tag>
                      )}
                    </div>
                    <div className="row-meta mt-2">
                      {formatNumber(c.topicCount)} 知识点 · {formatNumber(c.cardCount)} 卡片 · 已掌握 {formatNumber(c.masteredCount || 0)}
                    </div>
                    {c.cardCount > 0 && (
                      <Progress
                        value={pct}
                        label={`《${c.name}》卡片已掌握 ${pct}%`}
                        style={{ marginTop: 'var(--sp-2)' }}
                      />
                    )}
                  </div>
                  <div className="inline gap-2">
                    <Button size="sm" variant="secondary" iconRight={<ChevronRight size={14} />} onClick={() => nav(`/courses/${c.id}`)}>
                      进入课程
                    </Button>
                    <IconButton
                      label={`删除课程「${c.name}」`}
                      tone="danger"
                      disabled={imp.running}
                      onClick={() => setConfirmDel(c)}
                    >
                      <Trash2 size={15} strokeWidth={1.8} />
                    </IconButton>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Card className="mt-4">
        <div className="section-label">IMPORT PDF</div>
        <div className="row-inline" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <Select
              value={targetCourse === '' ? '' : String(targetCourse)}
              onChange={(v) => setTargetCourse(v === '' ? '' : Number(v))}
              width="100%"
              disabled={imp.running}
              title="导入到新建课程，或追加到已有课程"
              options={[
                { value: '', label: '导入为新课程' },
                ...list.map((c) => ({ value: String(c.id), label: `追加到：${c.name}` })),
              ]}
            />
          </div>
          <Button variant="outline" icon={<FileUp size={14} />} loading={imp.running} onClick={() => fileRef.current?.click()}>
            {imp.running ? '导入中' : '选择 PDF 文件'}
          </Button>
          <span className="row-meta" style={{ flex: '1 1 auto' }}>本地解析，扫描页自动跳过；中断后可续传</span>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void startImport(f)
              e.target.value = ''
            }}
          />
        </div>
      </Card>

      <Card>
        <div className="section-label">AI OUTLINE</div>
        <div className="row-inline" style={{ alignItems: 'flex-end' }}>
          <div ref={nameBoxRef} style={{ flex: '1 1 auto', minWidth: 0 }}>
            <Input
              label="课程名"
              placeholder="例如：数据结构与算法"
              value={newName}
              error={nameErr}
              hint="按课程名生成章节与知识点大纲，之后可在课程里按知识点补卡"
              disabled={imp.running}
              onChange={(e) => {
                setNewName(e.target.value)
                if (nameErr) setNameErr('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createByName()
              }}
            />
          </div>
          <Button
            variant="primary"
            icon={<Sparkles size={14} />}
            loading={busy}
            disabled={imp.running || !newName.trim()}
            onClick={() => { void createByName() }}
          >
            生成大纲
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={!!confirmDel}
        danger
        title={`删除课程「${confirmDel?.name ?? ''}」？`}
        description="该课程下的章节、知识点、卡片与学习记录都会一并删除，且无法恢复。"
        confirmText="确认删除"
        loading={deleting}
        onCancel={() => setConfirmDel(null)}
        onConfirm={() => {
          if (confirmDel) void deleteCourse(confirmDel)
        }}
      />
    </div>
  )
}
