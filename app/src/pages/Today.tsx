// 单词首页：今日驾驶舱（≥1180px 两栏：左栏主行动区 + 右栏状态区；窄窗口自动单栏）
// 计划卡支持拖动排序（顺序本地持久化），全部数据来自本地库（只统计词书单词卡）。
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, Bell, BookOpen, ChevronRight, Flame, GripVertical, MoreHorizontal, Play, RefreshCw, Search, TrendingUp } from 'lucide-react'
import { getDb, loadSession } from '../db'
import { WORD_BOOKS } from '../vocab'
import { getPlan, getSettings, loadHomeStats, WORDS_PER_GROUP, loadStreak, estimateMinutes, type HomeStats } from '../study'
import { formatNumber, formatPercent } from '../lib/format'
import { parseWordBack } from './WordDetailPanel'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Tag,
  useAsync,
  useToast,
} from '../ui'
import '../home.css'

interface BookRow {
  key: string
  name: string
  desc: string
  cards: number
  learned: number
  due: number
}

/** 记忆状态分档：刚学（亮）· 巩固中 · 待复习 */
type WordTier = 'new' | 'solid' | 'due'

/** 最近学习的词：单词 + 首个词性释义 + 记忆状态分档（最近学习的词卡一行显示） */
interface RecentWord {
  w: string
  mean: string
  pos: string
  tier: WordTier
}

/** 右栏压缩布局下最多显示 4 张最近学习的词卡 */
const RECENT_LIMIT = 4

interface HomeData {
  books: BookRow[]
  stats: HomeStats
  words: RecentWord[]
  resume: { idx: number; total: number } | null
  /** 已过当天零点的到期卡数（含逾期口径：due < 今天 00:00） */
  overdue: number
}

/** 记忆状态 → 分档：到期=待复习，近三天动过=刚学，其余=巩固中 */
function tierOf(last: string | null, due: string | null, now: number): WordTier {
  const dueAt = due ? Date.parse(due) : NaN
  if (Number.isFinite(dueAt) && dueAt <= now) return 'due'
  const lastAt = last ? Date.parse(last) : NaN
  return Number.isFinite(lastAt) && (now - lastAt) / 86400000 <= 3 ? 'new' : 'solid'
}

const ORDER_KEY = 'zenew_book_order'

/* ---- 书封：与词库页 Vocab.tsx 的 BookCover 完全同款（改配色请两处同步） ---- */
interface CoverSpec {
  from: string
  to: string
  tag: string
  sub: string
  /** 几何纹样（内联 SVG 平铺，白色且透明度 ≤ .12，压在渐变之上、文字之下） */
  pattern: string
}

const PATTERN_RING =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='52' height='52'%3E%3Cg fill='none' stroke='%23fff' stroke-opacity='.1'%3E%3Ccircle cx='26' cy='26' r='7' stroke-width='1.3'/%3E%3Ccircle cx='26' cy='26' r='15' stroke-width='1.1'/%3E%3Ccircle cx='26' cy='26' r='23' stroke-width='.9'/%3E%3C/g%3E%3C/svg%3E\")"
const PATTERN_WAVE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18'%3E%3Cg stroke='%23fff' stroke-opacity='.1' stroke-width='1.1' fill='none'%3E%3Cpath d='M-2 18 L18 -2 M4 22 L22 4'/%3E%3C/g%3E%3C/svg%3E\")"
const PATTERN_DOT =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14'%3E%3Cg fill='%23fff' fill-opacity='.11'%3E%3Ccircle cx='3' cy='3' r='1.3'/%3E%3Ccircle cx='10' cy='10' r='1'/%3E%3C/g%3E%3C/svg%3E\")"

/** 低饱和渐变 + 按 key 固定的一种几何纹样（纯 CSS/SVG 绘制，不用图片） */
const COVERS: Record<string, CoverSpec> = {
  cet4: { from: '#2AAF8E', to: '#1B7A66', tag: 'CET-4', sub: '四级', pattern: PATTERN_RING },
  cet6: { from: '#D9705F', to: '#A6453C', tag: 'CET-6', sub: '六级', pattern: PATTERN_WAVE },
  freq: { from: '#5478CF', to: '#33509B', tag: 'FREQ', sub: '高频', pattern: PATTERN_DOT },
  basic: { from: '#DDA347', to: '#AF7530', tag: 'BASIC', sub: '基础', pattern: PATTERN_RING },
  notebook: { from: '#8875CE', to: '#5F4AA6', tag: 'MY', sub: '生词本', pattern: PATTERN_WAVE },
  book: { from: '#5478CF', to: '#33509B', tag: '自建', sub: '词书', pattern: PATTERN_DOT },
}

/** 56×76 程序化书封：左缘书脊 + 1px 高光 + 纹样 + 上下两排文字（哑光，无塑料反光） */
function BookCover({ bookKey }: { bookKey: string }) {
  const c = COVERS[bookKey] || { ...COVERS.book, tag: bookKey.slice(0, 4) }
  return (
    <div
      className="book-cover"
      style={{
        backgroundImage: `${c.pattern}, linear-gradient(146deg, ${c.from}, ${c.to})`,
        backgroundSize: 'auto, 100% 100%',
        backgroundPosition: '50% 34%, 0 0',
        backgroundRepeat: 'repeat, no-repeat',
      }}
      aria-hidden
    >
      <b>{c.tag}</b>
      <span>{c.sub}</span>
    </div>
  )
}

function readOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function writeOrder(names: string[]) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(names))
  } catch {
    /* ignore */
  }
}

async function loadHome(): Promise<HomeData> {
  const db = await getDb()
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  const rows = await db.select<{ name: string; cards: number; learned: number; due: number; overdue: number }[]>(
    `SELECT co.name,
            (SELECT COUNT(*) FROM card c JOIN topic t ON t.id=c.topic_id WHERE t.course_id=co.id AND c.type='word' AND c.suspended=0) AS cards,
            (SELECT COUNT(*) FROM card c JOIN topic t ON t.id=c.topic_id JOIN card_state s ON s.card_id=c.id WHERE t.course_id=co.id AND c.type='word' AND c.suspended=0 AND s.state!=0) AS learned,
            (SELECT COUNT(*) FROM card c JOIN topic t ON t.id=c.topic_id JOIN card_state s ON s.card_id=c.id WHERE t.course_id=co.id AND c.type='word' AND c.suspended=0 AND s.state!=0 AND s.due<=?) AS due,
            (SELECT COUNT(*) FROM card c JOIN topic t ON t.id=c.topic_id JOIN card_state s ON s.card_id=c.id WHERE t.course_id=co.id AND c.type='word' AND c.suspended=0 AND s.state!=0 AND s.due<?) AS overdue
     FROM course co WHERE co.kind='vocab' ORDER BY co.id`,
    [now.toISOString(), todayStart.toISOString()]
  )
  /** 逾期数（due 早于今天零点），口径与 loadHomeStats 的 due 一致（不筛隐藏词书） */
  const overdue = rows.reduce((n, r) => n + Number(r.overdue || 0), 0)

  let hidden: string[] = []
  try {
    hidden = JSON.parse(localStorage.getItem('zenew_hidden_books') || '[]') as string[]
  } catch {
    hidden = []
  }
  const order = readOrder()
  const mapped: BookRow[] = rows
    .filter((r) => !hidden.includes(r.name))
    .map((r) => {
      const def = WORD_BOOKS.find((b) => b.name === r.name)
      return {
        key: def?.key || (r.name === '生词本' ? 'notebook' : r.name),
        name: r.name,
        desc: def?.desc || '生词本',
        cards: Number(r.cards),
        learned: Number(r.learned),
        due: Number(r.due),
      }
    })
  mapped.sort((a, b) => {
    const ia = order.indexOf(a.name)
    const ib = order.indexOf(b.name)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })

  const limit = getPlan(mapped[0]?.key || 'cet4').groups * WORDS_PER_GROUP
  const stats = await loadHomeStats(limit).catch(async () => ({
    due: 0,
    fresh: 0,
    learned: 0,
    mastered: 0,
    cut: 0,
    streak: await loadStreak().catch(() => 0),
  }))

  let words: RecentWord[] = []
  try {
    const learned = await db.select<{ front: string; back: string; state: number; last_review: string | null; due: string | null }[]>(
      `SELECT c.front, c.back, s.state, s.last_review, s.due FROM card c
       JOIN topic t ON t.id=c.topic_id
       JOIN course co ON co.id=t.course_id
       JOIN card_state s ON s.card_id=c.id
       WHERE co.kind='vocab' AND c.suspended=0 AND s.state!=0 AND c.type='word'
       ORDER BY s.last_review DESC LIMIT 32`
    )
    const now = Date.now()
    words = learned.map((r) => {
      const first = parseWordBack(r.back)?.m?.[0]
      const mean = first?.t?.trim() || '暂无释义'
      return {
        w: r.front,
        mean,
        pos: first?.p ? `${first.p}.` : '',
        tier: tierOf(r.last_review, r.due, now),
      }
    })
  } catch {
    words = []
  }

  let resume: { idx: number; total: number } | null = null
  try {
    const saved = await loadSession()
    if (saved) resume = { idx: saved.idx, total: saved.card_ids.length }
  } catch {
    /* 无快照 */
  }

  return { books: mapped, stats, words, resume, overdue }
}

export default function Today() {
  const nav = useNavigate()
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(loadHome, [])
  const [books, setBooks] = useState<BookRow[]>([])
  const [active, setActive] = useState(0)
  const [menu, setMenu] = useState(false)
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  useEffect(() => {
    if (data) setBooks(data.books)
  }, [data])

  const book = books[active]
  const plan = getPlan(book?.key || 'cet4')
  const stats = data?.stats
  const reviewGroups = stats ? Math.ceil(stats.due / WORDS_PER_GROUP) : 0
  const pct = book && book.cards > 0 ? (book.learned / book.cards) * 100 : 0
  /** 右栏最近学习的词（最多 4 张）与「全部单词」入口 */
  const recent = (data?.words ?? []).slice(0, RECENT_LIMIT)
  const wordsHref = book ? `/vocab/${book.key}/words` : '/vocab'
  /** 生词本一行文字入口的词量（books 里名为「生词本」的课程） */
  const notebook = books.find((b) => b.name === '生词本')

  /* ---- 右栏五档掌握概览：由现有聚合字段推导（待学 / 待复习 / 巩固中 / 熟识 / 已斩） ---- */
  const sumCards = books.reduce((n, b) => n + b.cards, 0)
  const sumLearned = books.reduce((n, b) => n + b.learned, 0)
  const tiers = [
    { key: 'fresh', label: '待学', value: Math.max(0, sumCards - sumLearned) },
    { key: 'due', label: '待复习', value: stats?.due ?? 0 },
    { key: 'solid', label: '巩固中', value: Math.max(0, sumLearned - (stats?.mastered ?? 0) - (stats?.due ?? 0)) },
    { key: 'known', label: '熟识', value: stats?.mastered ?? 0 },
    { key: 'cut', label: '已斩', value: stats?.cut ?? 0 },
  ]
  const tierTotal = tiers.reduce((n, t) => n + t.value, 0)
  const tierAria = `掌握概览：${tiers.map((t) => `${t.label} ${formatNumber(t.value)}`).join('，')}`

  /* ---- 拖动排序（顺序写入本地） ---- */
  const onDrop = (to: number) => {
    const from = dragFrom.current
    dragFrom.current = null
    setDragOver(null)
    if (from === null || from === to) return
    const next = [...books]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setBooks(next)
    setActive(to)
    writeOrder(next.map((b) => b.name))
    toast.success(`已调整计划顺序：${moved.name} 现在排在第 ${to + 1} 位`)
  }

  if (loading) {
    return (
      <div className="page-in">
        <LoadingState rows={3} title="正在读取本地学习数据" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-in">
        <ErrorState
          title="本地数据读取失败"
          desc={error}
          onRetry={reload}
          extra={
            <Button variant="ghost" size="sm" onClick={() => nav('/settings')}>
              打开设置
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="page-in">
      {/* 新用户首启引导：还没学过词时显示，学过第 1 组后自动消失 */}
      {(stats?.learned ?? 0) === 0 && (
        <Card className="fade-up" style={{ marginBottom: 'var(--sp-3)' }}>
          <div className="inline" style={{ gap: 'var(--sp-2)' }}>
            <span className="row-title">三步开始</span>
            <Button variant="outline" size="sm" onClick={() => nav('/vocab')}>
              ① 选词书
            </Button>
            <ChevronRight size={14} aria-hidden style={{ color: 'var(--ink-3)' }} />
            <Button variant="outline" size="sm" onClick={() => nav('/vocab')}>
              ② 导入 300 词
            </Button>
            <ChevronRight size={14} aria-hidden style={{ color: 'var(--ink-3)' }} />
            <Button variant="primary" size="sm" onClick={() => nav(book ? `/vocab/${book.key}` : '/vocab/cet4')}>
              ③ 开始第 1 组
            </Button>
          </div>
        </Card>
      )}

      {/* 今日驾驶舱：≥1180px 两栏（左 1fr + 右 340px），窄窗口自动单栏 */}
      <div className="grid-2 is-aside hm-cockpit">
        {/* 左栏：主行动区 */}
        <div className="hm-main">
          {/* 今日待复习大数字 + 新学/复习双按钮（按钮逻辑与原计划卡完全一致） */}
          <section className="hm-hero fade-up" aria-label="今日行动">
            <div className="hm-hero-score">
              <div className="hm-hero-numrow">
                <b className="hm-hero-num tnum">{formatNumber(stats?.due ?? 0)}</b>
                <span className="hm-hero-unit">词</span>
              </div>
              <div className="hm-hero-label">
                今日待复习
                {(data?.overdue ?? 0) > 0 && (
                  <span className="hm-hero-overdue">含逾期 {formatNumber(data?.overdue ?? 0)} 词</span>
                )}
              </div>
            </div>
            {book && (
              <div className="plan-buttons">
                <button className="btn-plan" onClick={() => nav(`/vocab/${book.key}`)}>
                  新学
                  <span className="btn-plan-sub">
                    {plan.groups} 组 · 约 {estimateMinutes(plan.groups * WORDS_PER_GROUP)} 分钟
                  </span>
                </button>
                <button className="btn-plan is-ghost" onClick={() => nav('/review')}>
                  复习
                  <span className="btn-plan-sub">
                    {reviewGroups} 组 · 待复习 {formatNumber(book.due)}
                  </span>
                </button>
              </div>
            )}
          </section>

          {/* 断点续学 */}
          {data?.resume && (
            <Card className="fade-up">
              <div className="inline" style={{ gap: 'var(--sp-3)' }}>
                <Play size={16} aria-hidden style={{ color: 'var(--brand)' }} />
                <div className="spacer-flex">
                  <div className="row-title">
                    上次学到第 {data.resume.idx + 1} / {data.resume.total} 张
                  </div>
                </div>
                <Button variant="primary" size="sm" onClick={() => nav('/review')}>
                  继续
                </Button>
              </div>
            </Card>
          )}

          {/* 学习计划卡 */}
          {book ? (
            <section
              className={`plan-card fade-up${dragOver === active ? ' is-drag-over' : ''}`}
              draggable
              onDragStart={() => {
                dragFrom.current = active
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(active)
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault()
                onDrop(active)
              }}
              onDragEnd={() => {
                dragFrom.current = null
                setDragOver(null)
              }}
            >
              <div className="plan-tabs">
                {books.map((b, i) => (
                  <button
                    key={b.key + i}
                    className={`plan-tab${i === active ? ' is-active' : ''}`}
                    onClick={() => setActive(i)}
                    aria-label={`切换到 ${b.name}`}
                    aria-pressed={i === active}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </button>
                ))}
                <button className="plan-tab-add" title="添加词书" aria-label="添加词书" onClick={() => nav('/vocab')}>
                  +
                </button>
                <span className="drag-handle" title="拖动卡片可调整计划顺序" aria-hidden style={{ marginInlineStart: 'auto' }}>
                  <GripVertical size={15} />
                </span>
              </div>
              <div className="plan-head">
                <BookCover bookKey={book.key} />
                <div style={{ minWidth: 0 }}>
                  <div className="plan-name truncate">{book.name}</div>
                  <div className="plan-head-meta">
                    {book.desc} · 每日 {plan.groups} 组
                  </div>
                </div>
                <div className="plan-actions-icons">
                  <IconButton label="复习统计" onClick={() => nav('/stats')}>
                    <TrendingUp size={16} />
                  </IconButton>
                  <IconButton label="更多计划操作" onClick={() => setMenu((m) => !m)}>
                    <MoreHorizontal size={16} />
                  </IconButton>
                </div>
              </div>

              <div className={`plan-body${book.cards === 0 ? ' is-empty' : ''}`}>
                {book.cards > 0 && (
                  <div className="ring" role="img" aria-label={`${book.name} 学习进度 ${formatPercent(pct)}`}>
                    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
                      <defs>
                        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="var(--brand-hi)" />
                          <stop offset="100%" stopColor="var(--brand)" />
                        </linearGradient>
                      </defs>
                      <circle className="ring-track" cx="48" cy="48" r="40" fill="none" strokeWidth="9" />
                      <circle
                        className="ring-value"
                        cx="48"
                        cy="48"
                        r="40"
                        fill="none"
                        strokeWidth="9"
                        strokeDasharray={2 * Math.PI * 40}
                        strokeDashoffset={2 * Math.PI * 40 * (1 - Math.min(1, pct / 100))}
                      />
                    </svg>
                    <div className="ring-label">
                      <b className="tnum">{formatPercent(pct)}</b>
                      <span>已学进度</span>
                    </div>
                  </div>
                )}

                <div style={{ minWidth: 0 }}>
                  <div className="plan-count tnum">
                    {book.cards > 0
                      ? `${formatNumber(book.learned)} / ${formatNumber(book.cards)} 词`
                      : `还没有导入词卡 · ${formatNumber(book.due)} 张待复习`}
                  </div>
                  <div className="row-meta" style={{ marginTop: 4 }}>
                    今日待复习 {formatNumber(book.due)} · 每次 {WORDS_PER_GROUP} 词一组
                  </div>

                  <div className="plan-chips">
                    {book.cards - book.learned > 0 && (
                      <span className="chip">
                        预计{' '}
                        {Math.max(1, Math.ceil((book.cards - book.learned) / Math.max(1, plan.groups * WORDS_PER_GROUP)))} 天学完
                      </span>
                    )}
                    <span className="chip">已导入 {formatNumber(book.cards)} 词</span>
                    <span className="chip">连续学习 {formatNumber(stats?.streak ?? 0)} 天</span>
                  </div>
                </div>
              </div>
              {menu && (
                <div className="plan-menu" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false)
                      nav(`/plan/${book.key}`)
                    }}
                  >
                    <RefreshCw size={14} /> 修改组数
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false)
                      nav('/vocab')
                    }}
                  >
                    <BookOpen size={14} /> 换个内容
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false)
                      toast.info('按住卡片拖动即可调整顺序')
                    }}
                  >
                    <MoreHorizontal size={14} /> 调整顺序
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenu(false)
                      try {
                        const hidden = JSON.parse(localStorage.getItem('zenew_hidden_books') || '[]') as string[]
                        localStorage.setItem('zenew_hidden_books', JSON.stringify([...new Set([...hidden, book.name])]))
                      } catch {
                        /* ignore */
                      }
                      setBooks((bs) => bs.filter((_, i) => i !== active))
                      setActive(0)
                      toast.success(`已从今日计划移出《${book.name}》`)
                    }}
                  >
                    ✕ 移出计划
                  </button>
                </div>
              )}
            </section>
          ) : (
            <Card className="fade-up">
              <EmptyState
                title="还没有加入学习计划的词书"
                desc="四本内置词书（四级 / 六级 / 高频 / 基础），导入即进入 FSRS 复习循环。"
                action={
                  <Button variant="primary" icon={<BookOpen size={15} />} onClick={() => nav('/vocab')}>
                    去挑一本词书
                  </Button>
                }
              />
            </Card>
          )}

          {/* 学习提醒 */}
          {getSettings().remind && (stats?.due ?? 0) > 0 && (
            <Card className="fade-up">
              <div className="inline" style={{ gap: 'var(--sp-3)' }}>
                <Bell size={17} aria-hidden style={{ color: 'var(--brand)' }} />
                <div className="spacer-flex">
                  <div className="row-title">学习提醒</div>
                  <div className="row-meta">今天还有 {formatNumber(stats?.due ?? 0)} 张待复习</div>
                </div>
                <Button variant="primary" size="sm" onClick={() => nav('/review')}>
                  去复习
                </Button>
              </div>
            </Card>
          )}
        </div>

        {/* 右栏：状态区 */}
        <aside className="hm-side" aria-label="学习状态">
          {/* 五档掌握迷你堆叠条 */}
          <section className="hm-side-card fade-up">
            <div className="hm-tiers-head">
              <span className="hm-tiers-title">掌握概览</span>
              <span className="hm-tiers-meta tnum">已学 {formatNumber(stats?.learned ?? 0)} 词</span>
            </div>
            <div className="hm-tiers-bar" role="img" aria-label={tierAria}>
              {tierTotal > 0
                ? tiers.map((t) =>
                    t.value > 0 ? <i key={t.key} className={`st-${t.key}`} style={{ flexGrow: t.value }} aria-hidden /> : null
                  )
                : <i className="st-none" style={{ flexGrow: 1 }} aria-hidden />}
            </div>
            <ul className="hm-tiers-legend">
              {tiers.map((t) => (
                <li key={t.key}>
                  <i className={`st-${t.key}`} aria-hidden />
                  {t.label} <b className="tnum">{formatNumber(t.value)}</b>
                </li>
              ))}
            </ul>
          </section>

          {/* 连续天数小卡 */}
          <section className="hm-side-card hm-streak fade-up">
            <span className="hm-streak-flame" aria-hidden>
              <Flame size={20} />
            </span>
            <b className="hm-streak-num tnum">{formatNumber(stats?.streak ?? 0)}</b>
            <div className="hm-streak-text">
              <span>连续天数</span>
              <small>{(stats?.streak ?? 0) > 0 ? '今天也别断哦' : '学 1 组就开始连击'}</small>
            </div>
          </section>

          {/* 最近学习的词（压缩为 4 卡，2×2） */}
          {recent.length > 0 ? (
            <section className="hm-words fade-up">
              <div className="hm-words-head">
                <span className="hm-words-title">最近学习的词</span>
                <button type="button" className="hm-words-all" onClick={() => nav(wordsHref)}>
                  全部单词
                </button>
              </div>
              <div className="hm-words-row">
                {recent.map((w) => (
                  <button
                    key={w.w}
                    type="button"
                    className={`hm-word is-tier-${w.tier}`}
                    title={`${w.w}${w.mean ? ` ${w.mean}` : ''}`}
                    onClick={() => nav(wordsHref)}
                  >
                    <span className="hm-word-text">{w.w}</span>
                    <span className={`hm-word-mean${w.mean ? '' : ' is-none'}`}>
                      {w.pos ? `${w.pos} ` : ''}
                      {w.mean}
                    </span>
                    <i className="hm-word-bar" aria-hidden />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="hm-empty fade-up">
              <p>还没有学过的词</p>
              <Button
                variant="primary"
                size="sm"
                icon={<BookOpen size={14} />}
                onClick={() => nav('/vocab')}
              >
                导入词书
              </Button>
            </section>
          )}

          {/* 生词本一行文字入口 */}
          <button type="button" className="hm-nb-entry fade-up" onClick={() => nav('/vocab/notebook')}>
            <span>生词本 · 已导入 {formatNumber(notebook?.cards ?? 0)} 词</span>
            <ChevronRight size={15} aria-hidden />
          </button>
        </aside>
      </div>

      {/* 功能入口 */}
      <div className="promo-row">
        <button className="promo-card" onClick={() => nav('/dict')}>
          <div className="promo-body">
            <div className="promo-title">14,625 词全量查词</div>
            <div className="promo-sub">收藏进生词本，走同一复习循环</div>
            <Tag tone="brand" className="mt-2">
              NEW
            </Tag>
          </div>
          <div className="promo-thumb is-mint" aria-hidden>
            <Search size={22} />
          </div>
        </button>
      </div>

      <Card className="fade-up" style={{ marginTop: 'var(--sp-3)' }}>
        <div className="inline" style={{ gap: 'var(--sp-3)' }}>
          <BarChart3 size={18} aria-hidden style={{ color: 'var(--brand)' }} />
          <div className="spacer-flex">
            <div className="row-title">
              今日新学上限 {formatNumber(plan.groups * WORDS_PER_GROUP)} 词
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => nav('/stats')}>
            查看
          </Button>
        </div>
      </Card>
    </div>
  )
}
