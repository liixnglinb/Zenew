import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  Ban,
  Check,
  Layers,
  ListChecks,
  ListTree,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { getDb } from '../db'
import { genCards, ApiError, type GenCard } from '../api'
import { formatNumber, formatPercent } from '../lib/format'
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  Progress,
  Tag,
  useToast,
  type Column,
} from '../ui'

/** 每个知识点达标所需卡片数 */
const COVER_MIN = 3

/** 章节（父级知识点） */
type ChapterRow = {
  id: number
  parent_id: number | null
  title: string
  sort: number
}

/** 知识点表格行（用 type 别名而非 interface：DataTable 需要隐式索引签名） */
type TopicRowData = {
  id: number
  parent_id: number | null
  title: string
  sort: number
  total: number
  mastered: number
}

type ChapterBlock = {
  ch: ChapterRow
  topics: TopicRowData[]
}

type CardItem = {
  id: number
  front: string
  back: string
  suspended: number
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
  const nav = useNavigate()
  const { id } = useParams()
  const toast = useToast()
  const courseId = Number(id)
  const [courseName, setCourseName] = useState('')
  const [chapters, setChapters] = useState<ChapterBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [genning, setGenning] = useState<number | null>(null)
  const [batch, setBatch] = useState<BatchState>({ running: false, total: 0, done: 0, current: '', added: 0, rejected: 0, failed: 0, stop: false })
  const [confirmAll, setConfirmAll] = useState(false)
  const batchRef = useRef(batch)
  batchRef.current = batch
  /** 打开卡片抽屉的知识点（含所属章节，用于生成时的上下文） */
  const [cardCtx, setCardCtx] = useState<{ topic: TopicRowData; chapter: string } | null>(null)
  const [cards, setCards] = useState<CardItem[]>([])
  const [cardsLoading, setCardsLoading] = useState(false)

  /** silent=true 用于轮询与生成后的静默刷新：不切骨架屏、不覆盖错误态 */
  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setLoadError('')
    }
    try {
      const db = await getDb()
      const cs = await db.select<{ name: string }[]>('SELECT name FROM course WHERE id=?', [courseId])
      setCourseName(cs[0]?.name || '')
      const parents = await db.select<ChapterRow[]>('SELECT * FROM topic WHERE course_id=? AND parent_id IS NULL ORDER BY sort', [courseId])
      const result: ChapterBlock[] = []
      for (const ch of parents) {
        const kids = await db.select<ChapterRow[]>('SELECT * FROM topic WHERE parent_id=? ORDER BY sort', [ch.id])
        const withStat: TopicRowData[] = []
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
      setLoadError('')
    } catch (e) {
      if (!silent) setLoadError(e instanceof Error ? e.message : '知识点读取失败，请稍后重试')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void load()
    // 边解析边学：详情页也要跟着导入进度刷新（有未完成导入时轮询）
    const t = setInterval(() => {
      if (!batchRef.current.running) void load(true)
    }, 8000)
    return () => clearInterval(t)
  }, [load])

  /** 展开知识点看卡片（可暂停/恢复） */
  const openCards = async (topic: TopicRowData, chapter: string) => {
    setCardCtx({ topic, chapter })
    setCardsLoading(true)
    try {
      const db = await getDb()
      const rows = await db.select<CardItem[]>(
        'SELECT id, front, back, suspended FROM card WHERE topic_id=? ORDER BY id',
        [topic.id]
      )
      setCards(rows)
    } catch (e) {
      console.error(e)
      setCards([])
      toast.error('卡片读取失败，请稍后重试')
    } finally {
      setCardsLoading(false)
    }
  }

  const toggleSuspend = async (cardId: number, next: boolean) => {
    try {
      const db = await getDb()
      await db.execute('UPDATE card SET suspended=? WHERE id=?', [next ? 1 : 0, cardId])
      setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, suspended: next ? 1 : 0 } : c)))
      toast.info(next ? '已暂停这张卡片，不再出现在复习队列' : '已恢复这张卡片，重新进入复习队列')
    } catch (e) {
      console.error(e)
      toast.error('操作失败，请稍后重试')
    }
  }

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
    if (batchRef.current.running) return
    setGenning(topicId)
    try {
      const { added, rejected } = await genOne(topicId, title, chapterTitle)
      toast.success(`《${title}》新增 ${formatNumber(added)} 张卡${rejected ? ` · 质检丢弃 ${formatNumber(rejected)}` : ''}`)
      await load(true)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '生成失败，请稍后重试')
    } finally {
      setGenning(null)
    }
  }

  /** 批量生成：targets 为空则取全部；onlyMissing=true 时只补未达标知识点 */
  const runBatch = async (targets: { topic: TopicRowData; chapter: string }[], label: string) => {
    if (batch.running || !targets.length) return
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
            await new Promise((r) => setTimeout(r, 15000 * (attempt + 1))) // 退避递增 15s/30s
          } else if (status === 402) {
            toast.error('服务端生成暂时不可用，请稍后重试（已生成的部分会保留）')
            failed += targets.length - i
            setBatch((b) => ({ ...b, running: false, added, rejected, failed }))
            await load(true)
            return
          } else {
            break
          }
        }
      }
      if (!ok) failed++ // 重试耗尽也要计数（原来静默少计）
      setBatch((b) => ({ ...b, done: i + 1, added, rejected, failed }))
      await new Promise((r) => setTimeout(r, 1200)) // 轻微节流
    }
    const stopped = batchRef.current.stop
    setBatch((b) => ({ ...b, running: false, current: '' }))
    const summary = `+${formatNumber(added)} 张卡${rejected ? ` · 质检丢弃 ${formatNumber(rejected)}` : ''}${failed ? ` · 失败 ${formatNumber(failed)}` : ''}`
    if (stopped) toast.info(`已停止：${label}${summary}`)
    else if (failed) toast.warning(`${label}完成：${summary}`)
    else toast.success(`${label}完成：${summary}`)
    await load(true)
  }

  const allTargets = () => chapters.flatMap(({ ch, topics }) => topics.map((t) => ({ topic: t, chapter: ch.title })))
  const missingTargets = () => chapters.flatMap(({ ch, topics }) => topics.filter((t) => t.total < COVER_MIN).map((t) => ({ topic: t, chapter: ch.title })))

  const totalTopics = chapters.reduce((n, c) => n + c.topics.length, 0)
  const coveredTopics = chapters.reduce((n, c) => n + c.topics.filter((t) => t.total >= COVER_MIN).length, 0)
  const totalCards = chapters.reduce((n, c) => n + c.topics.reduce((m, t) => m + t.total, 0), 0)
  const pct = totalTopics ? Math.round((coveredTopics / totalTopics) * 100) : 0
  const missingCount = missingTargets().length
  const batchDone = Math.min(batch.done, batch.total)

  return (
    <div className="page-in">
      <PageHeader
        title={courseName || '课程详情'}
        kicker={`COURSE / COVERAGE ${coveredTopics}/${totalTopics}`}
        onBack={() => nav(-1)}
        crumbs={[{ label: '课程', to: '/courses' }, { label: courseName || '课程详情' }]}
        onNavigate={(to) => nav(to)}
        actions={
          <IconButton label="刷新覆盖度看板" onClick={() => { void load() }}>
            <RefreshCw size={17} />
          </IconButton>
        }
      />
      <p className="page-sub" style={{ marginTop: 0 }}>
        章节 · 知识点覆盖度看板：每个知识点攒够 {COVER_MIN} 张卡算覆盖，可单个生成、按章补齐或整课批量生成
      </p>

      {loading && <LoadingState rows={4} title="正在读取课程知识点" />}

      {!loading && loadError && (
        <Card>
          <ErrorState
            title="知识点读取失败"
            desc={loadError}
            onRetry={() => { void load() }}
            extra={
              <Button variant="ghost" size="sm" onClick={() => nav('/courses')}>
                回课程列表
              </Button>
            }
          />
        </Card>
      )}

      {!loading && !loadError && totalTopics === 0 && (
        <Card>
          <EmptyState
            art={<ListChecks size={30} />}
            title="本课程还没有知识点"
            desc="导入教材 PDF 后会自动提取知识点并建卡；也可以回课程列表用「生成大纲」创建章节与知识点。"
            action={
              <Button variant="primary" size="sm" onClick={() => nav('/courses')}>
                回课程列表
              </Button>
            }
          />
        </Card>
      )}

      {!loading && !loadError && totalTopics > 0 && (
        <>
          <div className="metric-row">
            <div className="metric">
              <b className="tnum">{formatNumber(totalTopics)}</b>
              <span>知识点</span>
            </div>
            <div className={`metric${coveredTopics === totalTopics ? ' metric-hl' : ''}`}>
              <b className="tnum">{formatNumber(coveredTopics)}</b>
              <span>已覆盖</span>
            </div>
            <div className="metric">
              <b className="tnum">{formatNumber(totalCards)}</b>
              <span>卡片总数</span>
            </div>
            <div className="metric">
              <b className="tnum">{formatPercent(pct)}</b>
              <span>覆盖率</span>
            </div>
          </div>

          <Card>
            <div className="inline gap-3">
              <Progress value={pct} label={`整课覆盖率 ${pct}%`} style={{ flex: '1 1 auto', minWidth: 'var(--sp-9)' }} />
              <Tag tone="neutral" mono icon={<Layers size={11} />}>{formatPercent(pct)} 覆盖</Tag>
              <Tag tone={coveredTopics === totalTopics ? 'success' : 'neutral'} mono icon={<Check size={11} />}>
                {formatNumber(coveredTopics)}/{formatNumber(totalTopics)} 达标
              </Tag>
              <Tag tone="neutral" mono icon={<ListChecks size={11} />}>{formatNumber(totalCards)} 张卡</Tag>
            </div>
            <div className="row-inline mt-3">
              <Button
                variant="primary"
                size="sm"
                icon={<Sparkles size={14} />}
                loading={batch.running}
                disabled={batch.running || !missingCount}
                onClick={() => { void runBatch(missingTargets(), '补齐未覆盖') }}
              >
                补齐未覆盖（{formatNumber(missingCount)}）
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon={<ListChecks size={14} />}
                disabled={batch.running}
                title="对所有知识点（含已达标）再生成一批卡片"
                onClick={() => setConfirmAll(true)}
              >
                整课生成（{formatNumber(totalTopics)} 个知识点）
              </Button>
              {batch.running && (
                <Button variant="danger" size="sm" icon={<Ban size={13} />} onClick={() => setBatch((b) => ({ ...b, stop: true }))}>
                  停止批量生成
                </Button>
              )}
            </div>
          </Card>

          {batch.running && (
            <Card className="fade-up">
              <div className="inline" style={{ alignItems: 'flex-end', gap: 'var(--sp-4)' }}>
                <div className="display-num" aria-hidden>
                  {formatNumber(batchDone)}
                  <span className="row-meta">/{formatNumber(batch.total)}</span>
                </div>
                <div className="spacer-flex">
                  <div className="row-title">批量生成中</div>
                  <div className="row-meta mt-2">{batch.current || '准备中…'}</div>
                </div>
              </div>
              <Progress
                value={batchDone}
                max={batch.total}
                label={`批量生成进度 ${formatNumber(batchDone)}/${formatNumber(batch.total)}`}
                style={{ marginTop: 'var(--sp-3)' }}
              />
              <span className="sr-only" aria-live="polite">
                {`批量生成进度 ${formatNumber(batchDone)}/${formatNumber(batch.total)}，当前知识点：${batch.current || '准备中'}`}
              </span>
              <div className="inline gap-2 mt-3">
                <Tag tone="success" mono icon={<Check size={11} />}>已入库 +{formatNumber(batch.added)}</Tag>
                {batch.rejected > 0 && (
                  <Tag tone="warning" mono icon={<AlertTriangle size={11} />}>质检丢弃 {formatNumber(batch.rejected)}</Tag>
                )}
                {batch.failed > 0 && (
                  <Tag tone="danger" mono icon={<AlertTriangle size={11} />}>失败 {formatNumber(batch.failed)}</Tag>
                )}
                <span className="row-meta" style={{ marginLeft: 'auto' }}>可随时停止，已生成的卡片会保留</span>
              </div>
            </Card>
          )}

          {chapters.map(({ ch, topics }, ci) => {
            const covered = topics.filter((t) => t.total >= COVER_MIN).length
            const chPct = topics.length ? Math.round((covered / topics.length) * 100) : 0
            const cols: Column<TopicRowData>[] = [
              {
                key: 'title',
                header: '知识点',
                sortable: true,
                render: (t) => <span className="row-title wrap-anywhere">{t.title}</span>,
              },
              {
                key: 'total',
                header: '卡片数',
                align: 'end',
                sortable: true,
                render: (t) => <span className="tnum">{formatNumber(t.total)}</span>,
              },
              {
                key: 'mastered',
                header: '已掌握',
                align: 'end',
                sortable: true,
                render: (t) => <span className="tnum">{formatNumber(t.mastered)}</span>,
              },
              {
                key: 'cover',
                header: '覆盖情况',
                sortable: true,
                sortValue: (t) => t.total,
                render: (t) => {
                  const ok = t.total >= COVER_MIN
                  const done = Math.min(t.total, COVER_MIN)
                  return (
                    <div className="inline gap-2">
                      <Progress
                        value={done}
                        max={COVER_MIN}
                        tone={ok ? 'mint' : 'brand'}
                        label={`《${t.title}》覆盖 ${done}/${COVER_MIN} 张卡`}
                        style={{ width: 'var(--sp-9)' }}
                      />
                      <Tag tone={ok ? 'success' : 'warning'} icon={ok ? <Check size={11} /> : <AlertTriangle size={11} />}>
                        {ok ? '已覆盖' : `缺 ${COVER_MIN - t.total} 张`}
                      </Tag>
                    </div>
                  )
                },
              },
              {
                key: 'ops',
                header: '操作',
                align: 'end',
                render: (t) => (
                  <div className="inline gap-2" style={{ justifyContent: 'flex-end' }}>
                    <Button size="xs" variant="outline" icon={<ListTree size={12} />} onClick={() => { void openCards(t, ch.title) }}>
                      查看卡片
                    </Button>
                    <Button
                      size="xs"
                      variant={t.total >= COVER_MIN ? 'secondary' : 'primary'}
                      loading={genning === t.id}
                      disabled={batch.running}
                      onClick={() => { void generate(t.id, t.title, ch.title) }}
                    >
                      {t.total >= COVER_MIN ? '再生成 5 张' : '生成卡片'}
                    </Button>
                  </div>
                ),
              },
            ]
            return (
              <section key={ch.id} className="mt-5">
                <div className="section-label">CH {String(ci + 1).padStart(2, '0')} — {ch.title}</div>
                <div className="inline gap-2" style={{ marginBottom: 'var(--sp-3)' }}>
                  <Progress value={chPct} label={`《${ch.title}》覆盖率 ${chPct}%`} style={{ width: 'var(--sp-9)' }} />
                  <Tag tone={topics.length > 0 && covered === topics.length ? 'success' : 'neutral'} mono>
                    {formatNumber(covered)}/{formatNumber(topics.length)} 达标
                  </Tag>
                  <Button
                    size="xs"
                    variant="outline"
                    icon={<Sparkles size={12} />}
                    disabled={batch.running || !topics.length}
                    onClick={() => { void runBatch(topics.map((t) => ({ topic: t, chapter: ch.title })), `本章（${ch.title}）`) }}
                  >
                    生成本章
                  </Button>
                </div>
                <DataTable
                  caption={`第 ${ci + 1} 章 · 知识点覆盖情况（攒够 ${COVER_MIN} 张卡算覆盖）`}
                  rows={topics}
                  rowKey={(t) => t.id}
                  columns={cols}
                  empty={<EmptyState title="本章还没有知识点" desc="导入教材或生成大纲后会自动出现。" />}
                />
              </section>
            )
          })}
        </>
      )}

      <Drawer
        open={!!cardCtx}
        onClose={() => {
          setCardCtx(null)
          setCards([])
        }}
        side="right"
        title={cardCtx ? `卡片 · ${cardCtx.topic.title}` : '卡片'}
      >
        <p className="row-meta">
          {cardCtx?.chapter ? `${cardCtx.chapter} · ` : ''}
          暂停的卡片不再出现在复习队列，可随时恢复；当前 {formatNumber(cards.length)} 张。
        </p>
        {cardsLoading && <LoadingState rows={2} title="正在读取卡片" />}
        {!cardsLoading && cards.length === 0 && (
          <EmptyState
            title="该知识点还没有卡片"
            desc="让服务端按这个知识点补一批卡片，生成后会自动刷新列表。"
            action={
              <Button
                size="sm"
                variant="primary"
                icon={<Sparkles size={13} />}
                loading={genning === cardCtx?.topic.id}
                disabled={batch.running}
                onClick={() => {
                  if (!cardCtx) return
                  const ctx = cardCtx
                  void (async () => {
                    await generate(ctx.topic.id, ctx.topic.title, ctx.chapter)
                    await openCards(ctx.topic, ctx.chapter)
                  })()
                }}
              >
                生成卡片
              </Button>
            }
          />
        )}
        {!cardsLoading && cards.length > 0 && (
          <div className="card-list">
            {cards.map((c) => (
              <div key={c.id} className={`card-item${c.suspended ? ' is-suspended' : ''}`}>
                <span className="card-item-front" title={c.front}>{c.front}</span>
                <Tag tone={c.suspended ? 'neutral' : 'success'} icon={c.suspended ? <Pause size={11} /> : <Play size={11} />}>
                  {c.suspended ? '已暂停' : '学习中'}
                </Tag>
                <Button
                  size="xs"
                  variant={c.suspended ? 'primary' : 'outline'}
                  title={c.suspended ? '恢复这张卡进入学习队列' : '暂停这张卡（不再出现在复习队列）'}
                  onClick={() => { void toggleSuspend(c.id, !c.suspended) }}
                >
                  {c.suspended ? '恢复' : '暂停'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmAll}
        title="整课生成卡片？"
        description={`将对全部 ${formatNumber(totalTopics)} 个知识点（含已覆盖的）各生成若干张卡，耗时较长；已生成的部分会保留，可随时停止。`}
        confirmText="开始生成"
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => {
          setConfirmAll(false)
          void runBatch(allTargets(), '整课生成')
        }}
      />
    </div>
  )
}
