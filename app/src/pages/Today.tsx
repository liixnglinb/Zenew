// 单词首页：知识云（词云） + 学习计划卡（新学/复习）+ 运营位 + 断点续学
// 计划卡支持拖动排序（顺序本地持久化），全部数据来自本地库。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  FileUp,
  GripVertical,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { getDb, loadSession } from '../db'
import { daysUntil } from './Exams'
import { WORD_BOOKS } from '../vocab'
import { getPlan, getSettings, loadHomeStats, WORDS_PER_GROUP, loadStreak, type HomeStats } from '../study'
import { formatNumber } from '../lib/format'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Progress,
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

interface CloudWord {
  text: string
  size: number
  delay: number
  fresh: boolean
  /** 垂直抖动（px）：让流式排布看起来仍是"云"而不是表格 */
  shift: number
}

interface HomeData {
  books: BookRow[]
  stats: HomeStats
  words: { w: string; fresh: boolean }[]
  exam: { title: string; days: number } | null
  resume: { idx: number; total: number } | null
}

const ORDER_KEY = 'zenew_book_order'

function hash(s: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

/** 词云布局：流式排布（flex-wrap），字号按词长自适应，长词不再相互压字 */
function layoutCloud(words: { w: string; fresh: boolean }[]): CloudWord[] {
  return words.map((it, i) => {
    const h = hash(it.w, 41)
    const len = it.w.length
    const base = len <= 4 ? 28 : len <= 6 ? 24 : len <= 8 ? 20 : len <= 11 ? 17 : 15
    return {
      text: it.w,
      size: base + (h % 3) * 2 + (it.fresh ? 2 : 0),
      delay: (i % 7) * 0.35,
      fresh: it.fresh,
      shift: (h % 13) - 6,
    }
  })
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
            (SELECT COUNT(*) FROM card c JOIN topic t ON t.id=c.topic_id WHERE t.course_id=co.id AND c.suspended=0) AS cards,
            (SELECT COUNT(*) FROM card c JOIN topic t ON t.id=c.topic_id JOIN card_state s ON s.card_id=c.id WHERE t.course_id=co.id AND c.suspended=0 AND s.state!=0) AS learned,
            (SELECT COUNT(*) FROM card c JOIN topic t ON t.id=c.topic_id JOIN card_state s ON s.card_id=c.id WHERE t.course_id=co.id AND c.suspended=0 AND s.state!=0 AND s.due<=?) AS due
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

  let words: { w: string; fresh: boolean }[] = []
  try {
    const learned = await db.select<{ front: string; last_review: string | null }[]>(
      `SELECT c.front, s.last_review FROM card c JOIN card_state s ON s.card_id=c.id
       WHERE c.suspended=0 AND s.state!=0 AND c.type='word'
       ORDER BY s.last_review DESC LIMIT 32`
    )
    words = learned.map((r, i) => ({ w: r.front, fresh: i < 8 }))
    if (words.length < 14) {
      const topics = await db.select<{ title: string }[]>(
        'SELECT title FROM topic WHERE parent_id IS NOT NULL ORDER BY id DESC LIMIT 20'
      )
      for (const t of topics) {
        if (words.length >= 20) break
        if (t.title.length <= 12) words.push({ w: t.title, fresh: false })
      }
    }
  } catch {
    words = []
  }

  let exam: { title: string; days: number } | null = null
  try {
    const ex = await db.select<{ title: string; exam_date: string }[]>(
      'SELECT title, exam_date FROM exam WHERE exam_date >= ? ORDER BY exam_date ASC LIMIT 1',
      [new Date().toISOString().slice(0, 10)]
    )
    if (ex.length) exam = { title: ex[0].title, days: daysUntil(ex[0].exam_date) }
  } catch {
    /* 考试表为空 */
  }

  let resume: { idx: number; total: number } | null = null
  try {
    const saved = await loadSession()
    if (saved) resume = { idx: saved.idx, total: saved.card_ids.length }
  } catch {
    /* 无快照 */
  }

  return { books: mapped, stats, words, exam, resume }
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

  const cloud = useMemo(() => layoutCloud(data?.words ?? []), [data?.words])
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
      {/* 知识云 */}
      <section className="home-hero">
        <div className="home-hero-head">
          <div className="home-hero-title">
            <Sparkles size={16} aria-hidden /> 我的知识云
          </div>
          <div className="home-hero-sub">{formatNumber(stats?.learned ?? 0)} WORDS IN ORBIT</div>
        </div>
        <div className="wordcloud">
          {cloud.map((w) => (
            <span
              key={w.text}
              className={`wc-word${w.fresh ? ' is-bright' : ''}`}
              style={{ fontSize: w.size, animationDelay: `${w.delay}s`, marginTop: w.shift }}
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
                去「学习」导入一本词书，知识云会随着学习亮起来。
              </span>
              <Button variant="primary" size="sm" onClick={() => nav('/vocab')}>
                导入词书
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* 考试倒计时 */}
      {data?.exam && (
        <button
          className={`exam-strip fade-up${data.exam.days <= 7 ? ' is-urgent' : ''}`}
          onClick={() => nav('/exams')}
          style={{ width: '100%', textAlign: 'start' }}
        >
          <div className="exam-days tnum">{data.exam.days <= 0 ? '今' : data.exam.days}</div>
          <div className="spacer-flex">
            <div className="row-title truncate">{data.exam.title}</div>
            <div className="row-meta">
              {data.exam.days <= 0 ? '今天考试 · 复习已排到考前' : `还有 ${data.exam.days} 天 · 按考试日期倒排每日新学量`}
            </div>
          </div>
          <CalendarDays size={17} aria-hidden style={{ color: 'var(--ink-3)' }} />
        </button>
      )}

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
            <div style={{ minWidth: 0 }}>
              <div className="plan-name truncate">{book.name}</div>
              <div className="row-meta" style={{ marginTop: 3 }}>
                {book.desc} · 每日 {plan.groups} 组（每组 {WORDS_PER_GROUP} 词）
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
          <div className="plan-progress-row">
            <Progress value={Math.max(2, pct)} label={`${book.name} 学习进度`} />
            <span className="plan-count tnum">
              {formatNumber(book.learned)}/{formatNumber(book.cards)} 词 ›
            </span>
          </div>
          <div className="plan-buttons">
            <button className="btn-plan" onClick={() => nav(`/vocab/${book.key}`)}>
              新学
              <span className="btn-plan-sub">
                0/{plan.groups} 组
              </span>
            </button>
            <button className="btn-plan is-ghost" onClick={() => nav('/review')}>
              复习
              <span className="btn-plan-sub">0/{reviewGroups} 组</span>
            </button>
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
        <button className="promo-card" onClick={() => nav('/courses')}>
          <div className="promo-body">
            <div className="promo-title">导入教材 PDF，自动建练习卡</div>
            <div className="promo-sub">本地解析 · 扫描页跳过 · 不等解析完就能学</div>
          </div>
          <div className="promo-thumb is-warm" aria-hidden>
            <FileUp size={22} />
          </div>
        </button>
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
