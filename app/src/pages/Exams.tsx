// 考试日历：列表（含每日建议量）+ 添加 + 删除（二次确认）
// 统一使用 src/ui 组件库：PageHeader / Card / Input / Tag / Progress / 三态 / ConfirmDialog / useToast
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, CheckCircle2, Info, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { getDb, localDayKey } from '../db'
import Select from '../components/Select'
import DatePicker from '../components/DatePicker'
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  PageHeader,
  Progress,
  Tag,
  useAsync,
  useSubmit,
  useToast,
} from '../ui'

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

/** 建议每日新学量：剩余天数内把课程知识点过一遍（口径与迁移前一致） */
function perDayOf(e: ExamRow, d: number): number {
  return d > 0 && (e.topics || 0) > 0 ? Math.max(1, Math.ceil((e.topics || 0) / d)) : 0
}

interface ExamData {
  courses: { id: number; name: string }[]
  list: ExamRow[]
}

async function loadExams(): Promise<ExamData> {
  const db = await getDb()
  const courses = await db.select<{ id: number; name: string }[]>('SELECT id, name FROM course ORDER BY id')
  const list = await db.select<ExamRow[]>(
    `SELECT e.id, e.course_id, e.title, e.exam_date, c.name AS course_name,
            (SELECT COUNT(*) FROM topic t WHERE t.course_id=e.course_id AND t.parent_id IS NOT NULL) AS topics,
            (SELECT COUNT(*) FROM card cd WHERE cd.topic_id IN (SELECT id FROM topic WHERE course_id=e.course_id)) AS cards
     FROM exam e LEFT JOIN course c ON c.id=e.course_id
     ORDER BY e.exam_date ASC`
  )
  return { courses, list }
}

export default function Exams() {
  const nav = useNavigate()
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(loadExams, [])
  const [busy, run] = useSubmit()

  const [courseId, setCourseId] = useState<number | ''>('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState<ExamRow | null>(null)

  const courses = data?.courses ?? []
  const list = data?.list ?? []

  // 首次拿到课程后默认选中第一门（等价于迁移前 load() 里的 courseId 兜底）
  useEffect(() => {
    if (courseId === '' && courses.length) setCourseId(courses[0].id)
  }, [courses, courseId])

  /** 按本地日期算出的下一场考试 */
  const days = list.map((e) => daysUntil(e.exam_date))
  const nextIdx = days.findIndex((d) => d >= 0)
  const next = nextIdx >= 0 ? list[nextIdx] : undefined
  const nextDays = nextIdx >= 0 ? days[nextIdx] : undefined

  const addExam = () =>
    run(async () => {
      if (!courseId || !title.trim() || !date) {
        setErr('请填写课程、考试名称与日期')
        return
      }
      setErr('')
      try {
        const db = await getDb()
        await db.execute('INSERT INTO exam(course_id, title, exam_date) VALUES(?,?,?)', [courseId, title.trim(), date])
        setTitle('')
        setDate('')
        reload()
        toast.success('已添加考试')
      } catch (e) {
        const msg = e instanceof Error ? e.message : '请稍后重试'
        setErr(`添加失败：${msg}`)
        toast.error(`添加考试失败：${msg}`)
      }
    })

  const delExam = () =>
    run(async () => {
      const target = confirm
      if (!target) return
      try {
        const db = await getDb()
        await db.execute('DELETE FROM exam WHERE id=?', [target.id])
        setConfirm(null)
        reload()
        toast.success(`已删除「${target.title}」`)
      } catch (e) {
        toast.error(`删除失败：${e instanceof Error ? e.message : '请稍后重试'}`)
      }
    })

  return (
    <div className="page-in">
      <PageHeader
        title="考试"
        kicker={`EXAMS / ${String(list.length).padStart(2, '0')}`}
        onBack={() => nav(-1)}
        crumbs={[{ label: '单词', to: '/today' }, { label: '考试日历' }]}
        onNavigate={(to) => nav(to)}
        actions={
          <IconButton label="刷新考试列表" onClick={reload}>
            <RefreshCw size={17} />
          </IconButton>
        }
      />

      <p className="page-sub text-2" style={{ marginTop: 0 }}>
        按考试日期倒推每日新学量，把复习排到考前
        {next && nextDays !== undefined
          ? ` · 最近一场「${next.title}」${nextDays === 0 ? '就是今天' : `还有 ${nextDays} 天`}`
          : ''}
      </p>

      {loading && <LoadingState rows={3} title="正在读取考试安排" />}

      {!loading && error && (
        <ErrorState
          title="考试安排读取失败"
          desc={error}
          onRetry={reload}
          extra={
            <Button variant="ghost" size="sm" onClick={() => nav('/courses')}>
              先去创建课程
            </Button>
          }
        />
      )}

      {!loading && !error && data && (
        <>
          {list.length === 0 ? (
            <EmptyState
              title="还没有考试安排"
              desc="添加考试日期后，单词页会显示倒计时与每日建议量；建议量按「剩余知识点 ÷ 剩余天数」估算。"
              action={
                <Button
                  variant="primary"
                  icon={<Plus size={14} />}
                  onClick={() => {
                    setErr('')
                    document.getElementById('exam-title')?.focus()
                  }}
                >
                  添加第一场考试
                </Button>
              }
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {list.map((e, i) => {
                const d = days[i]
                const perDay = perDayOf(e, d)
                const urgent = d >= 0 && d <= 7
                return (
                  <Card key={e.id} className="fade-up">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                      <span
                        className="exam-days"
                        aria-label={d < 0 ? `已过 ${-d} 天` : d === 0 ? '今天考试' : `还有 ${d} 天`}
                        style={{ color: urgent ? 'var(--danger-500)' : undefined }}
                      >
                        {d > 0 ? d : d === 0 ? '今' : '—'}
                      </span>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="row-title truncate">
                          {e.title}
                          {d >= 0 ? (
                            <Tag
                              tone={urgent ? 'danger' : 'warning'}
                              icon={d === 0 ? <Info size={11} /> : undefined}
                              className="fade-up"
                              title={d === 0 ? '今天考试' : `距考试还有 ${d} 天`}
                            >
                              {d === 0 ? '今天' : `${d} 天后`}
                            </Tag>
                          ) : (
                            <Tag tone="neutral" icon={<CheckCircle2 size={11} />}>
                              已结束
                            </Tag>
                          )}
                        </div>

                        <div className="row-meta" style={{ marginTop: 'var(--sp-1)' }}>
                          <span className="truncate">{e.course_name || '（课程已删除）'}</span>
                          {` · ${e.exam_date.slice(0, 10)} · ${e.topics || 0} 知识点 / ${e.cards || 0} 卡片`}
                          {d < 0 ? ` · 已过 ${-d} 天` : ''}
                        </div>

                        {perDay > 0 && (() => {
                          // 建议量相对「30 天从容过一遍」的强度，用进度条直观呈现（全部为 token 数值，口径不变）
                          const relaxed = Math.max(perDay, Math.ceil((e.topics || 0) / 30))
                          return (
                            <>
                              <div className="row-meta" style={{ marginTop: 'var(--sp-1)' }}>
                                建议每天新学 {perDay} 个知识点 · 剩余 {d} 天
                              </div>
                              <Progress
                                value={perDay}
                                max={relaxed}
                                label={`「${e.title}」建议量强度：每天 ${perDay} 个知识点，考前还有 ${d} 天`}
                                style={{ marginTop: 'var(--sp-2)' }}
                              />
                            </>
                          )
                        })()}
                      </div>

                      <IconButton label={`删除考试 ${e.title}`} tone="danger" onClick={() => setConfirm(e)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}

          <Card className="fade-up">
            <div className="section-label">新增考试</div>
            <div className="row-inline" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <Field label="课程" htmlFor="exam-course">
                  <Select
                    value={courseId === '' ? '' : String(courseId)}
                    onChange={(v) => setCourseId(Number(v))}
                    width="100%"
                    title="考试所属课程"
                    placeholder={courses.length ? '选择课程' : '还没有课程，先去创建'}
                    options={courses.map((c) => ({ value: String(c.id), label: c.name }))}
                  />
                </Field>
              </div>

              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <Input
                  id="exam-title"
                  label="考试名称"
                  required
                  style={{ width: '100%' }}
                  placeholder="考试名称（如 期末考试）"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    setErr('')
                  }}
                  error={err}
                />
              </div>

              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <Field label="考试日期">
                  <DatePicker value={date} onChange={setDate} width="100%" />
                </Field>
              </div>

              <Button variant="primary" icon={<Plus size={14} />} loading={busy} onClick={addExam}>
                添加考试
              </Button>
            </div>
          </Card>

          <div className="today-hint fade-up">
            <span className="dot" />
            <CalendarDays size={13} aria-hidden /> 建议量按「剩余知识点 ÷ 剩余天数」估算，仅供参考
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        danger
        title={`删除考试「${confirm?.title ?? ''}」？`}
        description="删除后这场考试的倒计时与每日建议量会一并消失，且无法恢复。"
        confirmText="确认删除"
        cancelText="取消"
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={delExam}
      />
    </div>
  )
}
