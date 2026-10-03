// 单词列表页：/vocab/:key/words
// 顶部标题 + 返回 + 隐藏释义；六个筛选页签；共 N 词 + 排序 + 搜索 + 只看逾期；
// 行 = 5 点记忆状态条 + 单词 + 到期/逾期 + 按 state 着色的细进度条；
// 宽窗口（≥1180px）左右两栏：左列表 / 右详情，窄窗口点击行进入单栏详情；
// 底部固定「训练坞」5 个入口（训练页由 Train.tsx 负责，这里只做入口）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import {
  Eye,
  EyeOff,
  Headphones,
  LayoutGrid,
  ListChecks,
  PenLine,
  RefreshCw,
  SpellCheck,
  Star,
  Undo2,
  Zap,
} from 'lucide-react'
import { getDb, loadBookWords, type BookWordRow } from '../db'
import { tone } from '../study'
import { formatNumber } from '../lib/format'
import {
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  SearchInput,
  Tag,
  useAsync,
  useMediaQuery,
  useToast,
} from '../ui'
import WordDetailPanel, { dayIndex, dueText, parseWordBack, stateColor, STATE_LABELS, type WordBack } from './WordDetailPanel'
import '../wordlist.css'

/** 路由 key → 词书名（与 VocabStudy 的 BOOK_NAMES 同源；字典在词书页与学习页各有一份，这里保持第三份一致） */
const BOOK_NAMES: Record<string, string> = {
  cet4: '英语四级',
  cet6: '英语六级',
  freq: '高频词',
  basic: '基础英语',
  notebook: '生词本',
}

type FilterKey = 'all' | 'today' | 'new' | 'learning' | 'known' | 'cut'
type SortKey = 'default' | 'due' | 'alpha' | 'state'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今日' },
  { key: 'new', label: '未学习' },
  { key: 'learning', label: '学习中' },
  { key: 'known', label: '已熟识' },
  { key: 'cut', label: '已斩' },
]

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'default', label: '按词书默认顺序' },
  { key: 'due', label: '到期时间' },
  { key: 'alpha', label: '字母序' },
  { key: 'state', label: '掌握度' },
]

/** 训练坞入口（仅入口；训练逻辑在另一个代理的 Train.tsx 里） */
const TRAIN_ITEMS: { mode: string; label: string; icon: typeof Zap }[] = [
  { mode: 'listen', label: '速听', icon: Headphones },
  { mode: 'rush', label: '速刷', icon: Zap },
  { mode: 'choice', label: '单词选义', icon: LayoutGrid },
  { mode: 'spell', label: '拼写', icon: SpellCheck },
  { mode: 'dictation', label: '听写', icon: PenLine },
]

/* ---------- 六类筛选口径（全部收在这里，页面别处不再判断 state） ---------- */
/** 未学习：没有 card_state 行，或 state = 0 */
const isNew = (w: BookWordRow) => w.state === 0 && w.suspended === 0
/** 已熟识：state ≥ 3 */
const isKnown = (w: BookWordRow) => w.state >= 3
/** 学习中：其余有 state 的（1~2） */
const isLearning = (w: BookWordRow) => w.state >= 1 && w.state <= 2
/** 已斩：suspended = 1 */
const isCut = (w: BookWordRow) => w.suspended === 1
/** 今日：due ≤ 今天（按天比较，与行内「今天到期」文案同一口径；已斩的另归「已斩」） */
const isToday = (w: BookWordRow, now: number) =>
  !!w.due && dayIndex(new Date(w.due).getTime()) <= dayIndex(now) && w.suspended === 0
/** 只看逾期：到期日早于今天 */
const isOverdue = (w: BookWordRow, now: number) =>
  !!w.due && dayIndex(new Date(w.due).getTime()) < dayIndex(now) && w.suspended === 0

const MATCH: Record<FilterKey, (w: BookWordRow, now: number) => boolean> = {
  all: () => true,
  today: isToday,
  new: isNew,
  learning: isLearning,
  known: isKnown,
  cut: isCut,
}

/** 记忆状态 → 进度百分比（0/25/50/75/100） */
const pctOf = (state: number) => Math.max(0, Math.min(4, state || 0)) * 25

/* ---------- 星标收藏（localStorage: zenew_starred = card id 数组） ---------- */
const STAR_KEY = 'zenew_starred'

function readStarred(): number[] {
  try {
    const raw = localStorage.getItem(STAR_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is number => typeof x === 'number') : []
  } catch {
    return []
  }
}

function writeStarred(ids: number[]): void {
  try {
    localStorage.setItem(STAR_KEY, JSON.stringify(ids))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/** 一次渲染的行数：词书最多 4544 词，先渲染 120 行 + 触底加载更多（见文件顶部说明） */
const PAGE_SIZE = 120

/** 懒加载结果：data 为 null 表示这本书在库里还没有任何单词卡 */
interface Loaded {
  data: BookWordRow[] | null
  from: Date
}

export default function WordList() {
  const { key = '' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const name = BOOK_NAMES[key] || ''
  /** ≥1180px 用桌面两栏（与 desktop.css 的 .grid-2.is-aside 断点一致） */
  const wide = useMediaQuery('(min-width: 1180px)')

  const [filter, setFilter] = useState<FilterKey>('all')
  const [sort, setSort] = useState<SortKey>('default')
  const [kw, setKw] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [hideMeaning, setHideMeaning] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [starred, setStarred] = useState<number[]>(() => readStarred())
  const [cutBusy, setCutBusy] = useState(false)
  /** 详情面板是否展开（窄窗口：只有展开时才进单栏详情视图） */
  const [detailOpen, setDetailOpen] = useState(false)

  const loaded = useAsync<Loaded>(async () => {
    const from = new Date()
    const rows = await loadBookWords(name)
    return { data: rows.length ? rows : null, from }
  }, [name])

  const words = loaded.data?.data ?? null
  /** 相对日期基准：用本次读取的时刻，避免渲染过程中时间漂移 */
  const today = loaded.data?.from.getTime() ?? Date.now()

  /** 词条 JSON 解析结果缓存（搜索时逐行 JSON.parse 太贵，按 id 缓存一次） */
  const backOf = useMemo(() => {
    const m = new Map<number, WordBack | null>()
    for (const w of words ?? []) m.set(w.id, parseWordBack(w.back))
    return m
  }, [words])

  /** 一次遍历算出每个页签的计数（避免每行重复判定） */
  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: 0, today: 0, new: 0, learning: 0, known: 0, cut: 0 }
    const ts = today
    for (const w of words ?? []) {
      for (const f of FILTERS) if (MATCH[f.key](w, ts)) c[f.key]++
    }
    return c
  }, [words, today])

  /** 筛选 → 搜索 → 只看逾期 → 排序，得到当前词表（上一词 / 下一词也在这张表里移动） */
  const filtered = useMemo(() => {
    const base = words ?? []
    const q = kw.trim().toLowerCase()
    const hit = MATCH[filter]
    const list = base.filter((w) => {
      if (!hit(w, today)) return false
      if (overdueOnly && !isOverdue(w, today)) return false
      if (!q) return true
      if (w.front.toLowerCase().includes(q)) return true
      return (backOf.get(w.id)?.m ?? []).some((m) => m.t.toLowerCase().includes(q))
    })
    const arr = [...list]
    if (sort === 'due') {
      // 未学习的没有到期时间，统一排到最后
      const key = (w: BookWordRow) => (w.due ? dayIndex(new Date(w.due).getTime()) : Number.POSITIVE_INFINITY)
      arr.sort((a, b) => key(a) - key(b) || a.id - b.id)
    } else if (sort === 'alpha') {
      arr.sort((a, b) => a.front.localeCompare(b.front, 'en'))
    } else if (sort === 'state') {
      arr.sort((a, b) => b.state - a.state || a.id - b.id)
    }
    // default：保持 loadBookWords 的 card.id 升序
    return arr
  }, [words, backOf, filter, kw, overdueOnly, sort, today])

  const shown = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const remain = filtered.length - shown.length

  /** 筛选条件变化 → 回到第一批（否则会保留上一次的「已加载 600 行」） */
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [filter, sort, kw, overdueOnly, name])

  /** 列表变化后保证有选中行（桌面右栏始终有内容） */
  useEffect(() => {
    if (!filtered.length) {
      setSelected(null)
      return
    }
    setSelected((cur) => (cur !== null && filtered.some((w) => w.id === cur) ? cur : filtered[0].id))
  }, [filtered])

  const selectedRow = useMemo(() => filtered.find((w) => w.id === selected) ?? null, [filtered, selected])
  const selIdx = selectedRow ? filtered.indexOf(selectedRow) : -1

  /** 选中行 DOM（「上一词 / 下一词」跳到未渲染的行时把它滚进视野） */
  const rowEls = useRef(new Map<number, HTMLDivElement>())

  /** 选中某一行：窄窗口直接进入单栏详情 */
  const pick = useCallback(
    (id: number) => {
      setSelected(id)
      if (!wide) setDetailOpen(true)
    },
    [wide]
  )

  /* ---- 触底加载更多：哨兵进入视口就再放 120 行 ---- */
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || remain <= 0) return
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisibleCount((v) => v + PAGE_SIZE)
      },
      { rootMargin: '480px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [remain, shown.length])

  const toggleStar = useCallback(
    (id: number) => {
      setStarred((prev) => {
        const has = prev.includes(id)
        const next = has ? prev.filter((x) => x !== id) : [...prev, id]
        writeStarred(next)
        toast[has ? 'info' : 'success'](has ? '已取消收藏' : '已收藏（星标）')
        return next
      })
    },
    [toast]
  )

  const cut = useCallback(async () => {
    if (!selectedRow || cutBusy) return
    setCutBusy(true)
    try {
      const db = await getDb()
      await db.execute('UPDATE card SET suspended=1 WHERE id=?', [selectedRow.id])
      tone('cut')
      toast.success(`已斩「${selectedRow.front}」 · 不再出现在计划里`)
      // 立即在本地更新状态（不等重新查库），列表状态与详情同步刷新
      loaded.reload()
    } catch (e) {
      console.error('斩词失败', e)
      toast.error('斩词失败，请重试')
    } finally {
      setCutBusy(false)
    }
  }, [selectedRow, cutBusy, loaded, toast])

  const move = useCallback(
    (step: number) => {
      if (selIdx < 0) return
      const next = filtered[selIdx + step]
      if (!next) return
      setSelected(next.id)
      // 目标行可能还没被渲染出来（只渲染了前 N 行）→ 扩充渲染量把它带上
      const pos = filtered.indexOf(next)
      if (pos >= visibleCount) setVisibleCount(pos + PAGE_SIZE)
    },
    [selIdx, filtered, visibleCount]
  )

  /** 键盘 ↑↓ 在词表内移动选中行；Enter / 空格选中（链接与输入框上的方向键不受影响） */
  const onRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, w: BookWordRow) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(w.id)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const t = e.target as HTMLElement
    if (t.tagName === 'A' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'BUTTON') return
    e.preventDefault()
    if (filtered.findIndex((x) => x.id === w.id) < 0) return
    move(e.key === 'ArrowDown' ? 1 : -1)
  }

  /** 选中行不在可视范围内（如「下一词」跳到了未渲染的行）就滚进来 */
  useEffect(() => {
    if (selected === null) return
    const el = rowEls.current.get(selected)
    if (!el) return
    const list = el.closest('.wl-list')
    const lr = list?.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (lr && (r.top < lr.top || r.bottom > lr.bottom)) el.scrollIntoView({ block: 'center' })
  }, [selected])

  /* ---------------- 渲染 ---------------- */
  if (!name) {
    return (
      <div className="page-in">
        <PageHeader title="单词列表" onBack={() => nav('/vocab')} />
        <Card>
          <EmptyState
            title="没有找到这本词书"
            desc={
              <>
                路由参数 <b>{key || '（空）'}</b> 不在内置词书映射里（cet4 / cet6 / freq / basic / notebook）。
              </>
            }
            action={
              <button type="button" className="btn btn-primary" onClick={() => nav('/vocab')}>
                返回词库
              </button>
            }
          />
        </Card>
      </div>
    )
  }

  const listColumn = (
    <div className="wl-list card">
      {/* 行数据：单词 / 意义 / 状态 / 到期 / 星标 */}
      <div className="wl-rows">
        {shown.map((w) => {
          const state = Math.max(0, Math.min(4, w.state || 0))
          const color = stateColor(state)
          const due = dueText(w.due, today)
          const first = backOf.get(w.id)?.m?.[0]
          const isSel = w.id === selected
          return (
            <div
              key={w.id}
              ref={(el) => {
                if (el) rowEls.current.set(w.id, el)
                else rowEls.current.delete(w.id)
              }}
              role="button"
              tabIndex={0}
              aria-current={isSel ? 'true' : undefined}
              aria-label={`${w.front}${hideMeaning || !first ? '' : `：${first.p ? first.p + '. ' : ''}${first.t}`}（${STATE_LABELS[state]}，${due.text}）`}
              className={`wl-row${isSel ? ' is-selected' : ''}${w.suspended ? ' is-cut' : ''}`}
              style={{ ['--wl-due' as string]: color }}
              onClick={() => pick(w.id)}
              onKeyDown={(e) => onRowKeyDown(e, w)}
            >
              <span className="wl-dots" aria-hidden>
                {[1, 2, 3, 4].map((i) => (
                  <i key={i} className={i <= state ? 'is-on' : ''} style={i <= state ? { background: color } : undefined} />
                ))}
              </span>
              <span className="wl-row-main">
                <span className="wl-row-top">
                  <b className="wl-row-word">{w.front}</b>
                  {starred.includes(w.id) && <Star size={12} className="wl-row-star" fill="currentColor" aria-label="已收藏" />}
                  {w.suspended === 1 && <Tag tone="neutral">已斩</Tag>}
                  <span className="wl-row-due">{due.text}</span>
                </span>
                {!hideMeaning && (
                  <span className="wl-row-mean">{first ? `${first.p ? first.p + '. ' : ''}${first.t}` : '（无释义数据）'}</span>
                )}
                <span className="wl-track" aria-hidden>
                  <i style={{ width: `${pctOf(state)}%`, background: color }} />
                </span>
              </span>
            </div>
          )
        })}
      </div>

      {/* 触底哨兵 + 兜底按钮（不支持 IntersectionObserver 时也能加载） */}
      {remain > 0 && (
        <div className="wl-more" ref={sentinelRef}>
          <span className="row-meta">
            已显示 {formatNumber(shown.length)} / {formatNumber(filtered.length)} 词
          </span>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
            <ListChecks size={13} aria-hidden /> 加载更多（还有 {formatNumber(remain)} 词）
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div className="page-in wl-page">
      <PageHeader
        title="单词列表"
        onBack={() => nav('/vocab')}
        actions={
          <>
            <IconButton label="重新读取本词书单词" onClick={loaded.reload}>
              <RefreshCw size={17} />
            </IconButton>
            <IconButton
              label={hideMeaning ? '显示释义（当前已隐藏）' : '隐藏释义（自测模式）'}
              aria-pressed={hideMeaning}
              onClick={() => setHideMeaning((v) => !v)}
            >
              {hideMeaning ? <EyeOff size={17} /> : <Eye size={17} />}
            </IconButton>
          </>
        }
      />

      {loaded.loading && <LoadingState rows={5} title={`正在读取《${name}》的单词`} />}

      {!loaded.loading && loaded.error && (
        <ErrorState
          title="单词列表读取失败"
          desc={loaded.error}
          onRetry={loaded.reload}
          extra={
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => nav('/vocab')}>
              返回词库
            </button>
          }
        />
      )}

      {!loaded.loading && !loaded.error && loaded.data && !words && (
        <Card>
          <EmptyState
            title={`《${name}》还没有单词卡`}
            desc="这本词书还没导入内容：回到词库页导入后，这里会列出全部单词、记忆状态与下次复习时间。"
            action={
              <button type="button" className="btn btn-primary" onClick={() => nav('/vocab')}>
                去词库导入
              </button>
            }
          />
        </Card>
      )}

      {!loaded.loading && !loaded.error && words && (
        <>
          {/* 次行：筛选页签 */}
          <div className="wl-filters" role="group" aria-label="按记忆状态筛选">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`wl-chip${filter === f.key ? ' is-active' : ''}`}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <b className="tnum">{formatNumber(counts[f.key])}</b>
              </button>
            ))}
          </div>

          {/* 第三行：共 N 词 + 排序 + 搜索 + 只看逾期 */}
          <div className="wl-toolbar">
            <span className="wl-count">
              共 <b className="tnum">{formatNumber(filtered.length)}</b> 词
              {filtered.length !== words.length && <em className="wl-count-sub">（本词书 {formatNumber(words.length)} 词）</em>}
            </span>
            <label className="wl-sort">
              <span className="sr-only">排序方式</span>
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="wl-search">
              <SearchInput value={kw} onChange={setKw} placeholder="搜索单词" label="搜索单词" />
            </div>
            <button
              type="button"
              className={`wl-toggle${overdueOnly ? ' is-on' : ''}`}
              role="switch"
              aria-checked={overdueOnly}
              onClick={() => setOverdueOnly((v) => !v)}
            >
              <span className="wl-toggle-track" aria-hidden>
                <i />
              </span>
              只看逾期
            </button>
          </div>

          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                title="这个筛选下没有单词"
                desc={
                  kw.trim()
                    ? `没有匹配「${kw.trim()}」的单词，换个关键词或清空搜索。`
                    : overdueOnly
                      ? '当前没有逾期未复习的单词，说明进度很健康。'
                      : '换一个页签看看，或者去学习这本词书。'
                }
                action={
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      setKw('')
                      setOverdueOnly(false)
                      setFilter('all')
                    }}
                  >
                    <Undo2 size={14} aria-hidden /> 清空筛选
                  </button>
                }
              />
            </Card>
          ) : (
            <div className="wl-body">
              <div className={`grid-2 is-aside${wide && selectedRow ? ' wl-has-detail' : ''}`}>
                {listColumn}
                {wide && selectedRow && (
                  <div className="wl-aside">
                    <WordDetailPanel
                      row={selectedRow}
                      starred={starred.includes(selectedRow.id)}
                      onToggleStar={() => toggleStar(selectedRow.id)}
                      onCut={() => void cut()}
                      cutBusy={cutBusy}
                      onPrev={() => move(-1)}
                      onNext={() => move(1)}
                      hasPrev={selIdx > 0}
                      hasNext={selIdx >= 0 && selIdx < filtered.length - 1}
                      progress={pctOf(selectedRow.state)}
                      today={today}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 窄窗口：点击行进入单栏详情视图 */}
          {!wide && selectedRow && (
            <div className={`wl-drawer${detailOpen ? ' is-open' : ''}`}>
              <WordDetailPanel
                row={selectedRow}
                starred={starred.includes(selectedRow.id)}
                onToggleStar={() => toggleStar(selectedRow.id)}
                onCut={() => void cut()}
                cutBusy={cutBusy}
                onPrev={() => move(-1)}
                onNext={() => move(1)}
                hasPrev={selIdx > 0}
                hasNext={selIdx >= 0 && selIdx < filtered.length - 1}
                progress={pctOf(selectedRow.state)}
                today={today}
                onClose={() => setDetailOpen(false)}
              />
            </div>
          )}

          {/* 训练坞：5 个训练入口（毛玻璃胶囊条，sticky 停在内容区底部） */}
          <div className="wl-dockwrap">
            <nav className="wl-dock" aria-label="训练模式入口">
              {TRAIN_ITEMS.map((t) => {
                const Icon = t.icon
                return (
                  <NavLink key={t.mode} to={`/vocab/${key}/train/${t.mode}`} className="wl-dock-item" aria-label={`${t.label}训练`}>
                    <Icon size={16} aria-hidden />
                    <span>{t.label}</span>
                  </NavLink>
                )
              })}
            </nav>
          </div>
        </>
      )}
    </div>
  )
}
