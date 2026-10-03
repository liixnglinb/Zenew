import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  Segmented,
  Tag,
  useAsync,
} from '../ui'
import '../stats.css'

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
}

/** 累计进展数据点 */
type ProgressPoint = { label: string; value: number }

/** 累计进展图时间范围（Segmented 切换，progressSeries 懒加载 + 按档缓存） */
type RangeKey = 7 | 14 | 30

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: 7, label: '7 天' },
  { value: 14, label: '14 天' },
  { value: 30, label: '30 天' },
]

/** 预测柱悬停浮层的「周几」：第 i 根柱 = 今天 + i 天 */
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function weekdayOf(offset: number): string {
  return WEEKDAYS[new Date(Date.now() + offset * 86400000).getDay()] || ''
}

/* ---- SVG 折线/面积图几何（viewBox 固定、等比缩放，不引入图表库） ---- */
const SVG_W = 640
const SVG_H = 220
const PLOT_TOP = 18
const PLOT_BOTTOM = 20
/** 横向参考线的纵坐标（fraction: 0=底线 1=顶） */
function gridY(fraction: number): number {
  return PLOT_TOP + (1 - fraction) * (SVG_H - PLOT_TOP - PLOT_BOTTOM)
}

type StateKey = 'fresh' | 'strong' | 'solid' | 'known' | 'cut'

/** 五档白话解释（每档一句、≤18 字；solid 带实时词数） */
const TIER_NOTES: Record<StateKey, (v: number) => string> = {
  fresh: () => '刚学第一次，记忆还没站稳',
  strong: () => '进入复习节奏，正在扎根',
  solid: (v) => `还有 ${formatNumber(v)} 词处在 21 天内关键期`,
  known: () => '稳定期超过 21 天，基本拿下',
  cut: () => '已确认认识，不再占用计划',
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
  const [fresh, strong, solid, known, cut, learned, due, freshLeft, todayReviews, nearMastery, forecast] =
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
    ])
  return { fresh, strong, solid, known, cut, learned, due, freshLeft, todayReviews, nearMastery, forecast }
}

export default function Stats() {
  const nav = useNavigate()
  const { data, loading, error, reload } = useAsync(loadStats, [])

  /* ---- 累计进展：7/14/30 天切换（懒加载，切过的档缓存复用） ---- */
  const [range, setRange] = useState<RangeKey>(7)
  const [prog, setProg] = useState<ProgressPoint[] | null>(null)
  const [progLoading, setProgLoading] = useState(true)
  const [progNonce, setProgNonce] = useState(0)
  const progCache = useRef(new Map<RangeKey, ProgressPoint[]>())

  useEffect(() => {
    const cached = progCache.current.get(range)
    if (cached) {
      setProg(cached)
      setProgLoading(false)
      return
    }
    let dead = false
    setProgLoading(true)
    progressSeries(range)
      .then((rows) => {
        if (dead) return
        progCache.current.set(range, rows)
        setProg(rows)
        setProgLoading(false)
      })
      .catch(() => {
        /* progressSeries 内部已兜底为 []，这里仅防御未捕获拒绝 */
        if (dead) return
        setProg([])
        setProgLoading(false)
      })
    return () => {
      dead = true
    }
  }, [range, progNonce])

  /** 顶栏刷新：主统计与进展图一起重取 */
  const refreshAll = () => {
    progCache.current.clear()
    setProg(null)
    setProgNonce((n) => n + 1)
    reload()
  }

  const states = useMemo(() => {
    if (!data) return []
    return [
      { key: 'fresh' as const, label: '初记', value: data.fresh, cls: 'state-fresh' },
      { key: 'strong' as const, label: '强化', value: data.strong, cls: 'state-strong' },
      { key: 'solid' as const, label: '巩固', value: data.solid, cls: 'state-solid' },
      { key: 'known' as const, label: '熟识', value: data.known, cls: 'state-known' },
      { key: 'cut' as const, label: '已斩', value: data.cut, cls: 'state-cut' },
    ]
  }, [data])
  const stateTotal = states.reduce((n, x) => n + x.value, 0)

  /* ---- SVG 折线/面积图几何：等比映射到 viewBox，末点高亮沿用「最后一根柱」的语义 ---- */
  const geo = useMemo(() => {
    const pts = prog ?? []
    const count = pts.length
    const max = Math.max(1, ...pts.map((p) => p.value))
    const plotH = SVG_H - PLOT_TOP - PLOT_BOTTOM
    const coords = pts.map((p, i) => ({
      x: count <= 1 ? 0 : (i / (count - 1)) * SVG_W,
      y: PLOT_TOP + (1 - p.value / max) * plotH,
    }))
    const linePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
    const areaPath = count
      ? `M 0 ${SVG_H} ${coords.map((c) => `L ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ')} L ${SVG_W} ${SVG_H} Z`
      : ''
    return { coords, linePoints, areaPath, last: coords[count - 1] }
  }, [prog])

  const lastPoint = prog && prog.length > 0 ? prog[prog.length - 1] : null
  const progEmpty = !prog || prog.length === 0 || prog.every((p) => p.value === 0)

  return (
    <div className="page-in">
      <PageHeader
        title="复习统计"
        kicker="STATS / RETENTION"
        onBack={() => nav(-1)}
        crumbs={[{ label: '我的', to: '/settings' }, { label: '复习统计' }]}
        onNavigate={(to) => nav(to)}
        actions={
          <IconButton label="刷新统计" onClick={refreshAll}>
            <TrendingUp size={17} />
          </IconButton>
        }
      />

      {loading && <LoadingState rows={3} title="正在统计复习情况" />}

      {!loading && error && (
        <ErrorState
          title="统计读取失败"
          desc={error}
          onRetry={refreshAll}
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
                      {/* 「今天」基准线：today 柱左缘色带，右视为未来 */}
                      {i === 0 && <span className="st-today-line" aria-hidden />}
                      <i
                        data-tip={f.count > 0 ? `${formatNumber(f.count)} 词 · ${weekdayOf(i)}` : undefined}
                        style={f.count > 0 ? { height: `${Math.max(6, Math.sqrt(f.count / Math.max(1, ...data.forecast.map((x) => x.count))) * 100)}%` } : undefined}
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
                          height: `${Math.max(4, (st.value / Math.max(1, stateTotal)) * 100)}%`,
                        }}
                      />
                      <small>{st.label}</small>
                    </div>
                  ))}
                </div>
                {/* 每档：百分比（值/合计）+ 一句白话解释 */}
                <ul className="st-state-notes">
                  {states.map((st) => (
                    <li key={st.key}>
                      <i className={`st-dot st-dot-${st.key}`} aria-hidden />
                      <b>{st.label}</b>
                      <span className="st-pct tnum">
                        {formatPercent(stateTotal > 0 ? (st.value / stateTotal) * 100 : 0)}（{formatNumber(st.value)}/{formatNumber(stateTotal)}）
                      </span>
                      <small>{TIER_NOTES[st.key](st.value)}</small>
                    </li>
                  ))}
                </ul>
                <div className="row-meta" style={{ marginTop: 'var(--sp-3)' }}>
                  合计 {formatNumber(stateTotal)} 个单词 · 熟识 = 稳定期 ≥ 21 天
                </div>
              </Card>

              <Card>
                <div className="st-prog-head">
                  <div className="section-label">我的掌握进展 · 累计学习</div>
                  <Segmented
                    value={range}
                    onChange={(v) => setRange(v)}
                    options={RANGE_OPTIONS}
                    ariaLabel="切换累计进展时间范围"
                  />
                </div>
                {progLoading && <div className="skeleton st-prog-skeleton" style={{ height: 220 }} aria-hidden />}
                {!progLoading && prog && !progEmpty && (
                  <>
                    <svg
                      className="st-progress-svg"
                      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                      role="img"
                      aria-label={`最近 ${range} 天累计学习进展，当前累计 ${formatNumber(lastPoint?.value ?? 0)} 词`}
                    >
                      <defs>
                        <linearGradient id="stProgFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.26" />
                          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {[0.25, 0.5, 0.75].map((g) => (
                        <line key={g} className="st-grid" x1="0" x2={SVG_W} y1={gridY(g)} y2={gridY(g)} />
                      ))}
                      <path d={geo.areaPath} fill="url(#stProgFill)" />
                      <polyline className="st-line" points={geo.linePoints} />
                      {geo.last && <circle className="st-dot-last" cx={geo.last.x} cy={geo.last.y} r="5" />}
                      <line className="st-baseline" x1="0" x2={SVG_W} y1={SVG_H - 1} y2={SVG_H - 1} />
                    </svg>
                    <div className="area-axis">
                      <span>{prog[0]?.label}</span>
                      <span className="tnum">
                        {lastPoint?.label} · 累计 {formatNumber(lastPoint?.value ?? 0)}
                      </span>
                    </div>
                  </>
                )}
                {!progLoading && prog && progEmpty && (
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
