import { useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { BarChart3, Scissors, TrendingUp } from 'lucide-react'
import { getDb } from '../db'
import { forecastDays, progressSeries } from '../study'
import { formatNumber, formatPercent } from '../lib/format'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  Tag,
  useAsync,
} from '../ui'

interface Stats {
  fresh: number
  strong: number
  solid: number
  known: number
  cut: number
  learned: number
  due: number
  freshLeft: number
  todayReviews: number
  nearMastery: number
  forecast: { label: string; count: number; overdue: boolean }[]
  progress: { label: string; value: number }[]
}

// 统计口径：只统计词书单词卡（co.kind='vocab' AND c.type='word'），
// 历史遗留的非词书卡片与其复习记录仍留在库里，但不计入任何数字。
const WORD_ONLY = `JOIN card c ON c.id = cs.card_id
                   JOIN topic t ON t.id = c.topic_id
                   JOIN course co ON co.id = t.course_id`
const WORD_WHERE = `co.kind = 'vocab' AND c.type = 'word'`

async function loadStats(): Promise<Stats> {
  const db = await getDb()
  const now = new Date().toISOString()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const n = async (sql: string, args?: unknown[]) => {
    const r = await db.select<{ n: number }[]>(sql, args as never[])
    return Number(r[0]?.n || 0)
  }
  const [fresh, strong, solid, known, cut, learned, due, freshLeft, todayReviews, nearMastery, forecast, progress] =
    await Promise.all([
      n(`SELECT COUNT(*) AS n FROM card_state cs ${WORD_ONLY} WHERE ${WORD_WHERE} AND cs.state=1 AND cs.stability<1`),
      n(`SELECT COUNT(*) AS n FROM card_state cs ${WORD_ONLY} WHERE ${WORD_WHERE} AND cs.state IN (1,3) AND cs.stability>=1`),
      n(`SELECT COUNT(*) AS n FROM card_state cs ${WORD_ONLY} WHERE ${WORD_WHERE} AND cs.state=2 AND cs.stability<21`),
      n(`SELECT COUNT(*) AS n FROM card_state cs ${WORD_ONLY} WHERE ${WORD_WHERE} AND cs.state=2 AND cs.stability>=21`),
      n(`SELECT COUNT(*) AS n FROM card c JOIN topic t ON t.id = c.topic_id JOIN course co ON co.id = t.course_id WHERE ${WORD_WHERE} AND c.suspended=1`),
      n(`SELECT COUNT(*) AS n FROM card_state cs ${WORD_ONLY} WHERE ${WORD_WHERE} AND cs.state!=0`),
      n(`SELECT COUNT(*) AS n FROM card_state cs ${WORD_ONLY} WHERE ${WORD_WHERE} AND c.suspended=0 AND cs.due<=? AND cs.state!=0`, [now]),
      n(`SELECT COUNT(*) AS n FROM card c JOIN topic t ON t.id = c.topic_id JOIN course co ON co.id = t.course_id LEFT JOIN card_state cs ON cs.card_id=c.id WHERE ${WORD_WHERE} AND c.suspended=0 AND cs.card_id IS NULL`),
      n(`SELECT COUNT(*) AS n FROM review_log rl JOIN card c ON c.id = rl.card_id JOIN topic t ON t.id = c.topic_id JOIN course co ON co.id = t.course_id WHERE ${WORD_WHERE} AND rl.reviewed_at>=?`, [today.toISOString()]),
      n(`SELECT COUNT(*) AS n FROM card_state cs ${WORD_ONLY} WHERE ${WORD_WHERE} AND cs.state=2 AND cs.stability>=15 AND cs.stability<21`),
      forecastDays(10),
      progressSeries(10),
    ])
  return { fresh, strong, solid, known, cut, learned, due, freshLeft, todayReviews, nearMastery, forecast, progress }
}

export default function Stats() {
  const nav = useNavigate()
  const { data, loading, error, reload } = useAsync(loadStats, [])

  const states = useMemo(() => {
    if (!data) return []
    return [
      { key: 'fresh', label: '初记', value: data.fresh, cls: 'state-fresh' },
      { key: 'strong', label: '强化', value: data.strong, cls: 'state-strong' },
      { key: 'solid', label: '巩固', value: data.solid, cls: 'state-solid' },
      { key: 'known', label: '熟识', value: data.known, cls: 'state-known' },
      { key: 'cut', label: '已斩', value: data.cut, cls: 'state-cut' },
    ]
  }, [data])

  return (
    <div className="page-in">
      <PageHeader
        title="复习统计"
        kicker="STATS / RETENTION"
        onBack={() => nav(-1)}
        crumbs={[{ label: '我的', to: '/settings' }, { label: '复习统计' }]}
        onNavigate={(to) => nav(to)}
        actions={
          <IconButton label="刷新统计" onClick={reload}>
            <TrendingUp size={17} />
          </IconButton>
        }
      />

      {loading && <LoadingState rows={3} title="正在统计复习情况" />}

      {!loading && error && (
        <ErrorState
          title="统计读取失败"
          desc={error}
          onRetry={reload}
          extra={
            <Button variant="ghost" size="sm" onClick={() => nav('/today')}>
              回到单词页
            </Button>
          }
        />
      )}

      {!loading && !error && data && (
        <>
          <p className="page-sub" style={{ marginTop: 0 }}>
            FSRS 调度：初记 → 强化 → 巩固 → 熟识，已经认识的可直接「斩」出计划
          </p>

          {data.nearMastery > 0 && (
            <div className="robot-hint fade-up" style={{ marginBottom: 'var(--sp-3)' }}>
              <div className="robot-face" aria-hidden>
                <BarChart3 size={20} />
              </div>
              <p>
                目测有 <b>{formatNumber(data.nearMastery)}</b> 个单词接近「熟识」，可以斩了吧？
              </p>
              <Button variant="secondary" size="sm" icon={<Scissors size={13} />} onClick={() => nav('/review')}>
                斩词模式
              </Button>
            </div>
          )}

          <div className="metric-row">
            <div className="metric">
              <b className="tnum">{formatNumber(data.todayReviews)}</b>
              <span>今日已复习</span>
            </div>
            <div className="metric metric-hl">
              <b className="tnum">{formatNumber(data.known)}</b>
              <span>已熟识</span>
            </div>
            <div className="metric">
              <b className="tnum">{formatNumber(data.due)}</b>
              <span>待复习</span>
            </div>
            <div className="metric">
              <b className="tnum">{formatNumber(data.learned)}</b>
              <span>累计学习</span>
            </div>
          </div>

          {/* 桌面两栏：左侧主图（未来十天计划），右侧辅栏（掌握现状 + 进展） */}
          <div className="grid-2 is-aside">
            <div>
              <Card>
                <div className="section-label">我的复习计划 · 未来 10 天</div>
            <div className="chart-values">
              {data.forecast.map((f, i) => (
                <span key={i} style={{ visibility: f.count > 0 ? 'visible' : 'hidden' }} className="tnum">
                  {f.count}
                </span>
              ))}
            </div>
            <div className="chart" role="img" aria-label="未来十天每日到期卡片数量">
              {data.forecast.map((f, i) => (
                <div key={i} className={`chart-col${f.count === 0 ? ' zero' : ''}${f.overdue ? ' is-overdue' : ''}`}>
                  <i
                    style={f.count > 0 ? { height: `${Math.max(6, (f.count / Math.max(1, ...data.forecast.map((x) => x.count))) * 100)}%` } : undefined}
                  />
                </div>
              ))}
            </div>
            <div className="chart-labels">
              {data.forecast.map((f, i) => (
                <span key={i}>{f.label}</span>
              ))}
            </div>
          </Card>

            </div>

            <div className="stack">
              <Card>
                <div className="section-label">我的掌握现状</div>
            <div className="state-row">
              {states.map((st) => (
                <div key={st.key} className={`state-col ${st.cls}`}>
                  <span className="state-num tnum">{formatNumber(st.value)}</span>
                  <i
                    style={{
                      height: `${Math.max(4, (st.value / Math.max(1, states.reduce((n, x) => n + x.value, 0))) * 100)}%`,
                    }}
                  />
                  <small>{st.label}</small>
                </div>
              ))}
            </div>
            <div className="row-meta" style={{ marginTop: 'var(--sp-3)' }}>
              合计 {formatNumber(states.reduce((n, x) => n + x.value, 0))} 个单词 · 熟识 = 稳定期 ≥ 21 天
            </div>
          </Card>

          <Card>
            <div className="section-label">我的掌握进展 · 最近 10 天累计</div>
            {data.progress.length ? (
              <>
                <div className="area-chart" role="img" aria-label="最近十天累计学习进展">
                  {data.progress.map((p, i) => (
                    <div
                      key={i}
                      className={`area-col${i === data.progress.length - 1 ? ' is-last' : ''}`}
                      title={`${p.label} · 累计 ${p.value}`}
                    >
                      <i
                        style={{
                          height: `${Math.max(4, (p.value / Math.max(1, ...data.progress.map((x) => x.value))) * 100)}%`,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="area-axis">
                  <span>{data.progress[0]?.label}</span>
                  <span className="tnum">
                    {data.progress[data.progress.length - 1]?.label} · 累计 {formatNumber(data.progress[data.progress.length - 1]?.value)}
                  </span>
                </div>
              </>
            ) : (
              <EmptyState
                title="还没有复习记录"
                desc="学几张卡之后，这里会画出你的记忆增长曲线。"
                action={
                  <Button variant="primary" onClick={() => nav('/vocab')}>
                    去挑一本词书
                  </Button>
                }
              />
            )}
          </Card>

            </div>
          </div>

          <div className="metric-row" style={{ marginTop: 'var(--sp-3)' }}>
            <div className="metric">
              <b className="tnum">{formatNumber(data.learned)}</b>
              <span>累计学习</span>
            </div>
            <div className="metric">
              <b className="tnum">{formatNumber(data.freshLeft)}</b>
              <span>当前待学</span>
            </div>
            <div className="metric">
              <b className="tnum">{formatNumber(data.due)}</b>
              <span>待复习</span>
            </div>
            <div className="metric">
              <b className="tnum">{formatNumber(data.cut)}</b>
              <span>累计斩词</span>
            </div>
          </div>

          <Card>
            <div className="section-label">数据说明</div>
            <div className="inline" style={{ gap: 'var(--sp-2)' }}>
              <Tag tone="success" icon={<TrendingUp size={11} />}>
                学习记录全部存在本机
              </Tag>
              <Tag tone="neutral">已掌握 {formatPercent(
                (data.known / Math.max(1, data.learned)) * 100
              )}</Tag>
            </div>
            <p className="row-meta" style={{ marginTop: 'var(--sp-3)' }}>
              统计来自本地 SQLite 的复习日志与 FSRS 记忆状态，仅统计词书单词卡，不依赖网络，不上传任何学习数据。
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
