// 查词：全量索引（14,625 词 = 四书 + 考研 + 托福 + SAT）按词与释义搜索，一键收藏进生词本
// 统一使用 src/ui 组件库：PageHeader / SearchInput / DataTable（排序）/ LoadMore / 三态 / IconButton / useToast
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Check, RefreshCw, Search } from 'lucide-react'
import { getDb } from '../db'
import { loadIndex, addWordToNotebook, type IndexItem } from '../vocab'
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  LoadMore,
  LoadingState,
  PageHeader,
  SearchInput,
  Tag,
  useDebounced,
  useToast,
  type Column,
} from '../ui'

async function q(sql: string, args?: unknown[]): Promise<Record<string, unknown>[]> {
  const db = await getDb()
  return db.select<Record<string, unknown>[]>(sql, args as never[])
}

const PAGE_SIZE = 20
const CORPUS_TOTAL = '14,625'

/**
 * 索引检索（口径与迁移前完全一致）：前缀优先 → 包含 → 中文释义，
 * 分别截取 30 / 20 / 12 条后取前 40 条。
 */
function searchIndex(idx: IndexItem[], raw: string): IndexItem[] {
  const s = raw.trim().toLowerCase()
  if (s.length < 1) return []
  const starts: IndexItem[] = []
  const contains: IndexItem[] = []
  const meanHits: IndexItem[] = []
  for (const it of idx) {
    if (it.w.startsWith(s)) starts.push(it)
    else if (it.w.includes(s)) contains.push(it)
    else if (s.length >= 2 && it.m.some((m) => m.t.includes(s))) meanHits.push(it)
    if (starts.length >= 30) break
  }
  const out = [...starts, ...contains.slice(0, 20), ...meanHits.slice(0, 12)]
  return out.slice(0, 40)
}

function pronounce(it: IndexItem): string {
  const first = it.p?.find((x) => x.ph.startsWith('/'))
  if (first) return first.ph
  return (it.p || []).slice(0, 2).map((x) => x.ph).join(' ')
}

/** 表格行：保留 DataTable 需要的排序取值与收藏入口（DataTable 要求行对象可索引） */
interface DictRow extends Record<string, unknown> {
  item: IndexItem
  w: string
  ph: string
  src: string
  mean: string
  meanTitle: string
}

function toRow(it: IndexItem): DictRow {
  return {
    item: it,
    w: it.w,
    ph: pronounce(it),
    src: it.src.join(' / '),
    mean: it.m.slice(0, 3).map((m) => (m.p ? `${m.p}. ${m.t}` : m.t)).join('；'),
    meanTitle: it.m.map((m) => (m.p ? `${m.p}. ${m.t}` : m.t)).join('；'),
  }
}

export default function Dict() {
  const nav = useNavigate()
  const toast = useToast()
  const [text, setText] = useState('')
  const searchText = useDebounced(text, 180)

  const [results, setResults] = useState<IndexItem[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [active, setActive] = useState(-1)
  const [visible, setVisible] = useState(PAGE_SIZE)

  // 词库索引（CDN）三态：进页预热一次，失败给错误态 + 重试
  const [index, setIndex] = useState<IndexItem[] | null>(null)
  const [idxTick, setIdxTick] = useState(0)

  useEffect(() => {
    let dead = false
    loadIndex()
      .then((rows) => {
        if (!dead) {
          setIdxTick((t) => t + 1)
          setIndex(rows)
        }
      })
      .catch((e: unknown) => {
        if (!dead) setErr(e instanceof Error ? e.message : '词库索引加载失败')
      })
    return () => {
      dead = true
    }
  }, [])

  // 搜索（防抖 180ms，与迁移前一致）；索引变化时重跑，保证重试/冷启动后结果自动补上。
  // 索引是内存数组，检索本身是同步的（14.6k 词），因此结果立即替换，不需要额外的 loading 文案。
  const ready = index !== null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return
    if (!searchText.trim()) {
      setResults([])
      setActive(-1)
      return
    }
    const out = searchIndex(index, searchText)
    setResults(out)
    setActive(out.length ? 0 : -1)
    setVisible(PAGE_SIZE)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, ready, idxTick])

  const collect = async (it: IndexItem) => {
    try {
      const r = await addWordToNotebook(it.w, it, { db: await getDb(), dbQuery: q })
      if (r === 'added') {
        setAdded((s) => new Set([...s, it.w]))
        toast.success(`已收藏「${it.w}」到生词本`)
      } else {
        setAdded((s) => new Set([...s, it.w]))
        toast.info(`「${it.w}」已在生词本里`)
      }
    } catch (e) {
      toast.error(`收藏失败：${e instanceof Error ? e.message : '请稍后重试'}`)
    }
  }

  // 键盘：↑↓ 选择，Enter 收藏（保留迁移前的键盘能力）
  useEffect(() => {
    if (!results.length) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => Math.min(a + 1, results.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => Math.max(a - 1, 0))
      } else if (e.key === 'Enter' && active >= 0) {
        const it = results[active]
        if (it) void collect(it)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, active])

  // 键盘高亮行滚动可见（视觉标记由 data-active 承担，表格语义仍由 DataTable 提供）
  useEffect(() => {
    const el = document.querySelector<HTMLTableRowElement>('.data-table tbody tr[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, visible])

  const hasText = text.trim().length > 0
  const shown = useMemo(() => results.slice(0, visible).map(toRow), [results, visible])
  const remaining = results.length - shown.length
  /** 当前键盘选中项按单词匹配，排序/翻页后高亮仍跟着同一个词 */
  const activeWord = useMemo(() => results[active]?.w, [results, active])

  const columns: Column<DictRow>[] = [
    {
      key: 'w',
      header: '单词',
      width: '22%',
      sortable: true,
      render: (r) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 0 }}>
          <b className="truncate" data-active={r.w === activeWord ? 'true' : undefined}>
            {r.w}
          </b>
          {added.has(r.w) && (
            <Tag tone="success" icon={<Check size={11} />} title="已在生词本">
              已收藏
            </Tag>
          )}
        </div>
      ),
    },
    {
      key: 'ph',
      header: '音标 / 来源',
      width: '24%',
      sortable: true,
      render: (r) => (
        <div style={{ minWidth: 0 }}>
          {r.ph && <div className="truncate">{r.ph}</div>}
          <div className="dict-src truncate" title={r.src}>
            {r.src}
          </div>
        </div>
      ),
    },
    {
      key: 'mean',
      header: '释义',
      sortable: true,
      render: (r) => (
        <div className="clamp-2" title={r.meanTitle}>
          {r.item.m.slice(0, 3).map((m, j) => (
            <span key={j}>
              {m.p && <i className="sense-pos">{m.p}.</i>}
              {m.t}
              {j < Math.min(2, r.item.m.length - 1) ? '；' : ''}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'ops',
      header: '操作',
      align: 'end',
      width: 96,
      render: (r) => (
        <IconButton
          label={added.has(r.w) ? `「${r.w}」已收藏进生词本` : `收藏「${r.w}」进生词本`}
          disabled={added.has(r.w)}
          onClick={() => void collect(r.item)}
        >
          {added.has(r.w) ? <Check size={16} /> : <BookOpen size={16} />}
        </IconButton>
      ),
    },
  ]

  return (
    <div className="page-in">
      <PageHeader
        title="查词"
        kicker={`DICTIONARY / ${CORPUS_TOTAL}`}
        onBack={() => nav(-1)}
        crumbs={[{ label: '词库', to: '/vocab' }, { label: '查词' }]}
        onNavigate={(to) => nav(to)}
        actions={
          <Button variant="outline" size="sm" icon={<BookOpen size={14} />} onClick={() => nav('/vocab')}>
            返回词书
          </Button>
        }
      />

      <p className="page-sub text-2" style={{ marginTop: 0 }}>
        {CORPUS_TOTAL} 词全量索引（四六级 / 高频 / 基础 / 考研 / 托福 / SAT），支持英文与中文释义检索。收藏的词进入生词本，走同一复习循环。
      </p>

      <div className="dict-search">
        <SearchInput
          value={text}
          onChange={setText}
          autoFocus
          label="搜索单词或中文释义"
          placeholder="输入单词或中文释义…"
        />
        {!ready && !err && <span className="dict-loading">索引加载中…</span>}
      </div>

      {/* 三态：索引加载中 / 失败可重试 / 无结果可换词 */}
      {!ready && !err && <LoadingState rows={3} title="正在加载词库索引（14,625 词）" />}

      {err && (
        <ErrorState
          title="词库索引加载失败"
          desc={`${err}（索引来自 CDN，恢复网络后重试即可，本地词书不受影响）`}
          onRetry={() => {
            setErr(null)
            setIdxTick((t) => t + 1)
          }}
          extra={
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw size={14} />}
                onClick={() => {
                  setErr(null)
                  setIdxTick((t) => t + 1)
                }}
              >
                重新加载索引
              </Button>
              <Button variant="ghost" size="sm" icon={<BookOpen size={14} />} onClick={() => nav('/vocab')}>
                改用本地词书
              </Button>
            </>
          }
        />
      )}

      {ready && !err && !hasText && (
        <EmptyState
          title="输入单词或中文释义开始搜索"
          desc="支持前缀 / 包含 / 中文释义匹配 · ↑↓ 选择 · Enter 收藏进生词本"
          art={<Search size={30} />}
          action={
            <Button variant="primary" icon={<BookOpen size={14} />} onClick={() => nav('/vocab')}>
              去词书按书背
            </Button>
          }
        />
      )}

      {ready && !err && hasText && results.length === 0 && (
        <EmptyState
          title={`没有找到「${text.trim()}」`}
          desc="试试更短的词根，或改用中文释义搜索；也可以直接去词书按主题背。"
          art={<Search size={30} />}
          action={
            <Button variant="outline" icon={<BookOpen size={14} />} onClick={() => nav('/vocab')}>
              去词书挑一本
            </Button>
          }
        />
      )}

      {ready && !err && results.length > 0 && (
        <>
          {/* 键盘高亮样式：在原页面迁出组件库后，用同一套 token 承接 ↑↓ 选中态（不引入新依赖、不写死颜色） */}
          <style>{`
            .data-table tbody tr:has(b[data-active="true"]) {
              background: var(--brand-soft);
              box-shadow: inset 3px 0 0 var(--brand);
            }
            .data-table tbody tr:has(b[data-active="true"]) b[data-active="true"] { color: var(--brand); }
          `}</style>
          <div className="section-label">
            RESULTS / {String(results.length).padStart(2, '0')} · ↑↓ 选择 · Enter 收藏
          </div>
          <DataTable<DictRow>
            caption="查词结果（表格可按单词、音标 / 来源、释义排序；↑↓ 选择，Enter 或行内按钮收藏）"
            rows={shown}
            rowKey={(r) => r.w}
            columns={columns}
          />
          <span className="sr-only" aria-live="polite">
            {activeWord ? `当前选中 ${activeWord}，按 Enter 收藏进生词本` : ''}
          </span>
          {/* 长列表增量渲染：>20 条时用「加载更多」而不是一次渲染全部 */}
          <LoadMore remaining={remaining} onClick={() => setVisible((v) => v + PAGE_SIZE)} />
          <div className="row-meta" aria-live="polite" style={{ marginTop: 'var(--sp-2)' }}>
            已显示 {Math.min(visible, results.length)} / {results.length} 条匹配结果
            {remaining > 0 ? ` · 还有 ${remaining} 条待加载` : ''}
          </div>
        </>
      )}
    </div>
  )
}
