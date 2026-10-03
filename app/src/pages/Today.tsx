// 单词首页：单词云（词云） + 学习计划卡（新学/复习）+ 运营位 + 断点续学
// 计划卡支持拖动排序（顺序本地持久化），全部数据来自本地库（只统计词书单词卡）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  BookOpen,
  GripVertical,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { getDb, loadSession } from '../db'
import { WORD_BOOKS } from '../vocab'
import { getPlan, getSettings, loadHomeStats, WORDS_PER_GROUP, loadStreak, estimateMinutes, type HomeStats } from '../study'
import { formatNumber, formatPercent } from '../lib/format'
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

interface BookRow {
  key: string
  name: string
  desc: string
  cards: number
  learned: number
  due: number
}

/** 记忆状态分档：刚学（亮）· 巩固中 · 待复习（灰） */
type CloudTier = 'new' | 'solid' | 'due'

interface CloudWord {
  text: string
  size: number
  delay: number
  tier: CloudTier
  /** 词云内绝对定位（px） */
  x: number
  y: number
  /** 外框尺寸（用于避让计算） */
  bw: number
  bh: number
  /** 中心点（用于绘制连线） */
  cx: number
  cy: number
}

interface Link2D {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface HomeData {
  books: BookRow[]
  stats: HomeStats
  words: { w: string; tier: CloudTier }[]
  resume: { idx: number; total: number } | null
}

/** 内置词书封面（与词库页一致） */
const COVERS: Record<string, { bg: string; tag: string; sub: string }> = {
  cet4: { bg: 'linear-gradient(140deg, #2FC08A, #12885F)', tag: 'CET-4', sub: '四级' },
  cet6: { bg: 'linear-gradient(140deg, #F2705F, #C93A34)', tag: 'CET-6', sub: '六级' },
  freq: { bg: 'linear-gradient(140deg, #4C7DF7, #1B47C4)', tag: 'FREQ', sub: '高频' },
  basic: { bg: 'linear-gradient(140deg, #FFB020, #E07B39)', tag: 'BASIC', sub: '基础' },
  notebook: { bg: 'linear-gradient(140deg, #7C5CFF, #5436D6)', tag: 'MY', sub: '生词本' },
}
const DEFAULT_COVER = { bg: 'linear-gradient(140deg, #4C7DF7, #1B47C4)', tag: 'BOOK', sub: '词书' }

const ORDER_KEY = 'zenew_book_order'

/** 各档基础字号（长词自动降号，避免长词挤压） */
const TIER_SIZE: Record<CloudTier, number> = { new: 32, solid: 25, due: 20 }

/** 词的稳定指纹：让同一档内也有大小节奏，云看起来才"活" */
function wordSeed(s: string): number {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003
  return h
}

/**
 * 知识云布局：从中心螺旋外扩，逐词避让已占位区域 —— 保证任何词都不会互相压字。
 * 同时记录中心点，供 SVG 连线画出"知识星图"的感觉。
 */
function layoutCloud(words: { w: string; tier: CloudTier }[], box: { w: number; h: number }): CloudWord[] {
  const W = box.w || 660
  const H = box.h || 250
  const pad = 10
  const gapX = 14
  const gapY = 10

  const items = words
    .map((it, i) => {
      const len = it.w.length
      const seed = wordSeed(it.w)
      const size = Math.max(
        13,
        TIER_SIZE[it.tier] - (len > 11 ? 5 : len > 8 ? 3 : len > 6 ? 1 : 0) + (seed % 5) - 2
      )
      return {
        text: it.w,
        tier: it.tier,
        size,
        bw: Math.max(34, len * size * 0.57),
        bh: size * 1.28,
        delay: (i % 7) * 0.34,
      }
    })
    .sort((a, b) => b.bh - a.bh)

  const placed: CloudWord[] = []
  const cx0 = W / 2
  const cy0 = H / 2
  const rx = Math.max(40, (W / 2 - pad) * 0.94)
  const ry = Math.max(24, (H / 2 - pad) * 0.94)
  const TRIES = 3200

  for (const it of items) {
    /* 椭圆螺旋铺满整个容器；找不到空位时退让到"重叠最少"的位置，保证每个词都上云 */
    let best: { x: number; y: number; cx: number; cy: number; overlap: number } | null = null
    for (let t = 0; t < TRIES; t++) {
      const ang = t * 0.42
      const s = Math.sqrt(t / TRIES)
      const cx = cx0 + Math.cos(ang) * s * rx
      const cy = cy0 + Math.sin(ang) * s * ry
      const x = cx - it.bw / 2
      const y = cy - it.bh / 2
      if (x < pad || y < pad || x + it.bw > W - pad || y + it.bh > H - pad) continue

      let overlap = 0
      for (const p of placed) {
        const ox = Math.min(x + it.bw + gapX, p.x + p.bw + gapX) - Math.max(x - gapX, p.x - gapX)
        const oy = Math.min(y + it.bh + gapY, p.y + p.bh + gapY) - Math.max(y - gapY, p.y - gapY)
        if (ox > 0 && oy > 0) overlap += ox * oy
      }
      if (overlap === 0) {
        best = { x, y, cx, cy, overlap: 0 }
        break
      }
      if (!best || overlap < best.overlap) best = { x, y, cx, cy, overlap }
    }
    if (best) {
      placed.push({ text: it.text, tier: it.tier, size: it.size, delay: it.delay, x: best.x, y: best.y, bw: it.bw, bh: it.bh, cx: best.cx, cy: best.cy })
    }
  }
  return placed
}

/** 每个词连到最近的一个词，去重后最多 16 条线 */
function cloudLinks(cloud: CloudWord[]): Link2D[] {
  const out: Link2D[] = []
  const seen = new Set<string>()
  for (let i = 0; i < cloud.length; i++) {
    let best = -1
    let bestD = Infinity
    for (let j = 0; j < cloud.length; j++) {
      if (i === j) continue
      const d = (cloud[i].cx - cloud[j].cx) ** 2 + (cloud[i].cy - cloud[j].cy) ** 2
      if (d < bestD) {
        bestD = d
        best = j
      }
    }
    if (best < 0) continue
    const key = i < best ? `${i}-${best}` : `${best}-${i}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ x1: cloud[i].cx, y1: cloud[i].cy, x2: cloud[best].cx, y2: cloud[best].cy })
    if (out.length >= 16) break
  }
  return out
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

  const rows = await db.select<{ name: string; cards: number; learned: number; due: number }[]>(
    `SELECT co.name,
            (SELECT COUNT(*) FROM card c JOIN topic t ON t.id=c.topic_id WHERE t.course_id=co.id AND c.type='word' AND c.suspended=0) AS cards,
            (SELECT COUNT(*) FROM card c JOIN topic t ON t.id=c.topic_id JOIN card_state s ON s.card_id=c.id WHERE t.course_id=co.id AND c.type='word' AND c.suspended=0 AND s.state!=0) AS learned,
            (SELECT COUNT(*) FROM card c JOIN topic t ON t.id=c.topic_id JOIN card_state s ON s.card_id=c.id WHERE t.course_id=co.id AND c.type='word' AND c.suspended=0 AND s.state!=0 AND s.due<=?) AS due
     FROM course co WHERE co.kind='vocab' ORDER BY co.id`,
    [new Date().toISOString()]
  )

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
        key: def?.key || r.name,
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

  let words: { w: string; tier: CloudTier }[] = []
  try {
    const learned = await db.select<{ front: string; last_review: string | null; due: string | null }[]>(
      `SELECT c.front, s.last_review, s.due FROM card c
       JOIN topic t ON t.id=c.topic_id
       JOIN course co ON co.id=t.course_id
       JOIN card_state s ON s.card_id=c.id
       WHERE co.kind='vocab' AND c.suspended=0 AND s.state!=0 AND c.type='word'
       ORDER BY s.last_review DESC LIMIT 32`
    )
    const now = Date.now()
    words = learned.map((r) => {
      const last = r.last_review ? Date.parse(r.last_review) : NaN
      const due = r.due ? Date.parse(r.due) : NaN
      const ageDays = Number.isFinite(last) ? (now - last) / 86400000 : 99
      const tier: CloudTier = Number.isFinite(due) && due <= now ? 'due' : ageDays <= 3 ? 'new' : 'solid'
      return { w: r.front, tier }
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

  return { books: mapped, stats, words, resume }
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

  const cloudRef = useRef<HTMLDivElement | null>(null)
  const [cloudBox, setCloudBox] = useState({ w: 0, h: 0 })

  /* 量出词云实际尺寸后再排布：窗口缩放会自动重排，永不压字 */
  useEffect(() => {
    const el = cloudRef.current
    if (!el) return
    const measure = () =>
      setCloudBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [data])

  const cloud = useMemo(() => layoutCloud(data?.words ?? [], cloudBox), [data?.words, cloudBox])
  const links = useMemo(() => cloudLinks(cloud), [cloud])
  const tierCount = useMemo(() => {
    const c: Record<CloudTier, number> = { new: 0, solid: 0, due: 0 }
    for (const w of cloud) c[w.tier] += 1
    return c
  }, [cloud])
  const book = books[active]
  const plan = getPlan(book?.key || 'cet4')
  const stats = data?.stats
  const reviewGroups = stats ? Math.ceil(stats.due / WORDS_PER_GROUP) : 0
  const pct = book && book.cards > 0 ? (book.learned / book.cards) * 100 : 0

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
      {/* 单词云 */}
      <section className="home-hero">
        <div className="home-hero-head">
          <div className="home-hero-title">
            <Sparkles size={16} aria-hidden /> 我的单词云
          </div>
          <div className="home-hero-sub">{formatNumber(stats?.learned ?? 0)} WORDS IN ORBIT</div>
        </div>
        <div className="wordcloud" ref={cloudRef}>
          {cloud.length > 1 && (
            <svg
              className="wc-line"
              viewBox={`0 0 ${cloudBox.w || 660} ${cloudBox.h || 250}`}
              preserveAspectRatio="none"
              aria-hidden
            >
              {links.map((l, i) => (
                <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
              ))}
            </svg>
          )}
          {cloud.map((w) => (
            <span
              key={w.text}
              className={`wc-word is-${w.tier}`}
              style={{ left: w.x, top: w.y, fontSize: w.size, animationDelay: `${w.delay}s` }}
              title={w.text}
            >
              {w.text}
            </span>
          ))}
          {cloud.length === 0 && (
            <div className="wc-empty">
              <BookOpen size={26} aria-hidden />
              <span>
                还没有学过的词。
                <br />
                去「学习」导入一本词书，单词云会随着学习亮起来。
              </span>
              <Button variant="primary" size="sm" onClick={() => nav('/vocab')}>
                导入词书
              </Button>
            </div>
          )}
        </div>
        {cloud.length > 0 && (
          <div className="cloud-legend">
            <span className="cloud-legend-item is-new">
              <i /> 刚学会 <b>{tierCount.new}</b>
            </span>
            <span className="cloud-legend-item is-solid">
              <i /> 巩固中 <b>{tierCount.solid}</b>
            </span>
            <span className="cloud-legend-item is-due">
              <i /> 待复习 <b>{tierCount.due}</b>
            </span>
          </div>
        )}
      </section>

      {/* 学习提醒 */}
      {getSettings().remind && (stats?.due ?? 0) > 0 && (
        <Card className="fade-up" style={{ marginBottom: 'var(--sp-3)' }}>
          <div className="inline" style={{ gap: 'var(--sp-3)' }}>
            <Bell size={17} aria-hidden style={{ color: 'var(--brand)' }} />
            <div className="spacer-flex">
              <div className="row-title">学习提醒</div>
              <div className="row-meta">今天还有 {formatNumber(stats?.due ?? 0)} 张待复习，趁记忆还热乎先过一遍</div>
            </div>
            <Button variant="primary" size="sm" onClick={() => nav('/review')}>
              去复习
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
            <div className="plan-cover" style={{ background: (COVERS[book.key] || DEFAULT_COVER).bg }} aria-hidden>
              <b>{(COVERS[book.key] || DEFAULT_COVER).tag}</b>
              <span>{(COVERS[book.key] || DEFAULT_COVER).sub}</span>
            </div>
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

      {/* 断点续学 */}
      {data?.resume && (
        <Card className="fade-up" style={{ marginTop: 'var(--sp-3)' }}>
          <div className="inline" style={{ gap: 'var(--sp-3)' }}>
            <Play size={16} aria-hidden style={{ color: 'var(--brand)' }} />
            <div className="spacer-flex">
              <div className="row-title">
                上次学到第 {data.resume.idx + 1} / {data.resume.total} 张
              </div>
              <div className="row-meta">进度已保存，接着上次继续</div>
            </div>
            <Button variant="primary" size="sm" onClick={() => nav('/review')}>
              继续
            </Button>
          </div>
        </Card>
      )}

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
            <div className="row-title">复习统计</div>
            <div className="row-meta">
              待复习 {formatNumber(stats?.due ?? 0)} · 今日新学上限 {formatNumber(plan.groups * WORDS_PER_GROUP)} 词 · 连续{' '}
              {formatNumber(stats?.streak ?? 0)} 天
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
