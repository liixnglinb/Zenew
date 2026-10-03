// 词库商店：四本内置词书 + 生词本，导入即进入统一 FSRS 复习循环
// 全部界面元素来自 src/ui 组件库（PageHeader / Tabs / Card / Button / Tag / Progress / 三态 / DataTable）
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  Layers,
  Library,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react'
import { getDb } from '../db'
import { WORD_BOOKS, loadBook, vocabCourseStats, importVocabRange, type WordBook, type VocabEntry } from '../vocab'
import { getPlan, WORDS_PER_GROUP } from '../study'
import { formatNumber, formatPercent } from '../lib/format'
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  Progress,
  SearchInput,
  Tabs,
  Tag,
  type Column,
  type TabItem,
  useAsync,
  useToast,
} from '../ui'

/** 单本词书的导入进度（渲染用，字段全部就绪，避免半成品对象） */
interface BookStat {
  cards: number
  learned: number
  importing: number
  err: string
}

interface VocabData {
  stats: Record<string, BookStat>
  cards: number
  learned: number
  due: number
  mastered: number
  notebook: number
}

/** DataTable 行：词书词量 / 导入 / 学习进度对比 */
interface BookRow extends Record<string, unknown> {
  key: string
  name: string
  total: number
  cards: number
  learned: number
  pct: number
  groups: number
}

type CatKey = 'hot' | 'cet4' | 'cet6' | 'freq' | 'basic' | 'notebook'

const BOOK_TOTALS: Record<string, number> = { cet4: 4544, cet6: 3991, freq: 4544, basic: 3911 }

/** 3D 书封配色（沿用设计稿的彩色封面） */
const COVERS: Record<string, { bg: string; tag: string; sub: string }> = {
  cet4: { bg: 'linear-gradient(140deg, #2FC08A, #12885F)', tag: 'CET-4', sub: '四级' },
  cet6: { bg: 'linear-gradient(140deg, #F2705F, #C93A34)', tag: 'CET-6', sub: '六级' },
  freq: { bg: 'linear-gradient(140deg, #4C7DF7, #1B47C4)', tag: 'FREQ', sub: '高频' },
  basic: { bg: 'linear-gradient(140deg, #FFB020, #E07B39)', tag: 'BASIC', sub: '基础' },
}

const CATS: { key: CatKey; label: string; book?: string }[] = [
  { key: 'hot', label: '热门' },
  { key: 'cet4', label: '四级', book: 'cet4' },
  { key: 'cet6', label: '六级', book: 'cet6' },
  { key: 'freq', label: '高频', book: 'freq' },
  { key: 'basic', label: '基础', book: 'basic' },
  { key: 'notebook', label: '生词本' },
]

async function q(sql: string, args?: unknown[]): Promise<Record<string, unknown>[]> {
  const db = await getDb()
  return db.select<Record<string, unknown>[]>(sql, args as never[])
}

/** 读取词库总览：每本词书的卡片/已学 + 今日待复习 / 已熟识 / 生词本词量 */
async function loadVocab(): Promise<VocabData> {
  const stats: Record<string, BookStat> = {}
  let cards = 0
  let learned = 0
  for (const b of WORD_BOOKS) {
    const s = await vocabCourseStats(b.name, q)
    stats[b.key] = { cards: s.cards, learned: s.learned, importing: 0, err: '' }
    cards += s.cards
    learned += s.learned
  }
  const db = await getDb()
  const now = new Date().toISOString()
  const nb = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM card c JOIN topic t ON t.id=c.topic_id JOIN course co ON co.id=t.course_id
     WHERE co.kind='vocab' AND c.suspended=0`
  )
  const due = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM card_state cs JOIN card c ON c.id=cs.card_id
     JOIN topic t ON t.id=c.topic_id JOIN course co ON co.id=t.course_id
     WHERE co.kind='vocab' AND c.suspended=0 AND cs.due<=? AND cs.state!=0`,
    [now]
  )
  const mastered = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM card_state cs JOIN card c ON c.id=cs.card_id
     JOIN topic t ON t.id=c.topic_id JOIN course co ON co.id=t.course_id
     WHERE co.kind='vocab' AND cs.state=2 AND cs.stability>=21`
  )
  const notebook = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM card c JOIN topic t ON t.id=c.topic_id JOIN course co ON co.id=t.course_id
     WHERE co.kind='vocab' AND co.name='生词本' AND c.suspended=0`
  )
  return {
    stats,
    cards: Number(nb[0]?.n ?? 0),
    learned,
    due: Number(due[0]?.n ?? 0),
    mastered: Number(mastered[0]?.n ?? 0),
    notebook: Number(notebook[0]?.n ?? 0),
  }
}

export default function Vocab() {
  const nav = useNavigate()
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(loadVocab, [])

  const [cat, setCat] = useState<CatKey>('hot')
  const [kw, setKw] = useState('')
  const [importingKey, setImportingKey] = useState('')
  const [pendingAll, setPendingAll] = useState<WordBook | null>(null)
  const [showTable, setShowTable] = useState(false)
  /** 导入过程中的临时进度与错误（导入完成后清空，由总览数据接管） */
  const [mut, setMut] = useState<Record<string, { importing: number; err: string }>>({})
  /** 导入成功后写入的最新统计，让进度条立即更新，随后 reload 覆盖 */
  const [fresh, setFresh] = useState<Record<string, { cards: number; learned: number }>>({})

  const patch = (key: string, next: { importing: number; err: string }) =>
    setMut((m) => ({ ...m, [key]: next }))

  const statOf = (key: string): BookStat => {
    const base = data?.stats[key] ?? { cards: 0, learned: 0, importing: 0, err: '' }
    const f = fresh[key]
    const m = mut[key]
    return {
      cards: f?.cards ?? base.cards,
      learned: f?.learned ?? base.learned,
      importing: m?.importing ?? base.importing,
      err: m?.err ?? base.err,
    }
  }

  const importBatch = async (book: WordBook, entries: VocabEntry[], start: number, count: number) => {
    patch(book.key, { importing: count, err: '' })
    try {
      const db = await getDb()
      await importVocabRange(book, entries, start, Math.min(start + count, entries.length), { db, dbQuery: q })
      const s = await vocabCourseStats(book.name, q)
      setFresh((f) => ({ ...f, [book.key]: { cards: s.cards, learned: s.learned } }))
      patch(book.key, { importing: 0, err: '' })
    } catch (e) {
      patch(book.key, { importing: 0, err: String(e).slice(0, 120) })
      throw e
    }
  }

  const startImport = async (book: WordBook) => {
    if (importingKey) return
    setImportingKey(book.key)
    try {
      const entries = await loadBook(book.file)
      const start = statOf(book.key).cards
      await importBatch(book, entries, start, Math.min(300, entries.length - start))
      toast.success(`已导入《${book.name}》${Math.min(300, entries.length - start)} 词`)
      reload()
    } catch (e) {
      toast.error(`导入失败：${String(e).slice(0, 80)}`)
    } finally {
      setImportingKey('')
    }
  }

  const importAll = async (book: WordBook) => {
    if (importingKey) return
    setImportingKey(book.key)
    try {
      const entries = await loadBook(book.file)
      const start = statOf(book.key).cards
      for (let from = start; from < entries.length; from += 300) {
        await importBatch(book, entries, from, 300)
      }
      toast.success(`《${book.name}》已导入全部 ${formatNumber(entries.length)} 词`)
      reload()
    } catch (e) {
      toast.error(`导入失败：${String(e).slice(0, 80)}`)
    } finally {
      setImportingKey('')
    }
  }

  const tabs: TabItem<CatKey>[] = CATS.map((c) => ({
    key: c.key,
    label: c.label,
    icon: c.key === 'notebook' ? <BookOpen size={13} aria-hidden /> : undefined,
    badge:
      c.key === 'notebook' && (data?.notebook ?? 0) > 0 ? <span className="tnum">{formatNumber(data?.notebook)}</span> : undefined,
  }))

  const activeTab = CATS.find((c) => c.key === cat)
  const visible = WORD_BOOKS.filter((b) => {
    const hitCat = cat === 'hot' || activeTab?.book === b.key
    const hitKw = !kw.trim() || b.name.includes(kw.trim()) || b.desc.includes(kw.trim())
    return hitCat && hitKw
  })

  const rows: BookRow[] = WORD_BOOKS.map((b) => {
    const s = statOf(b.key)
    return {
      key: b.key,
      name: b.name,
      total: BOOK_TOTALS[b.key] ?? 0,
      cards: s.cards,
      learned: s.learned,
      pct: s.cards > 0 ? Math.round((s.learned / s.cards) * 100) : 0,
      groups: getPlan(b.key).groups,
    }
  })

  const columns: Column<BookRow>[] = [
    { key: 'name', header: '词书', render: (r) => <span className="truncate">{r.name}</span> },
    { key: 'total', header: '词量', align: 'end', sortable: true, render: (r) => <span className="tnum">{formatNumber(r.total)}</span> },
    { key: 'cards', header: '已导入', align: 'end', sortable: true, render: (r) => <span className="tnum">{formatNumber(r.cards)}</span> },
    { key: 'learned', header: '已学', align: 'end', sortable: true, render: (r) => <span className="tnum">{formatNumber(r.learned)}</span> },
    { key: 'pct', header: '学习进度', align: 'end', sortable: true, render: (r) => <span className="tnum">{formatPercent(r.pct)}</span> },
    { key: 'groups', header: '每日组数', align: 'end', render: (r) => <span className="tnum">{formatNumber(r.groups)} 组</span> },
    {
      key: 'ops',
      header: '操作',
      align: 'end',
      render: (r) => (
        <span className="inline gap-2" style={{ justifyContent: 'flex-end' }}>
          {r.cards > 0 ? (
            <Tag tone="success" icon={<CheckCircle2 size={11} aria-hidden />}>
              已导入
            </Tag>
          ) : (
            <Tag tone="neutral">未导入</Tag>
          )}
          <Button size="xs" variant="outline" onClick={() => nav(`/plan/${r.key}`)}>
            计划
          </Button>
        </span>
      ),
    },
  ]

  const searching = !!kw.trim()
  const emptyAction =
    cat === 'notebook' && (data?.notebook ?? 0) > 0 ? (
      <Button variant="primary" icon={<BookOpen size={14} aria-hidden />} onClick={() => nav('/vocab/notebook')}>
        学习生词本（{formatNumber(data?.notebook)} 词）
      </Button>
    ) : searching ? (
      <Button
        variant="primary"
        icon={<RotateCcw size={14} aria-hidden />}
        onClick={() => {
          setKw('')
          setCat('hot')
        }}
      >
        清空筛选，看全部词书
      </Button>
    ) : (
      <Button variant="primary" icon={<Library size={14} aria-hidden />} onClick={() => nav('/dict')}>
        去查词，收藏到生词本
      </Button>
    )

  return (
    <div className="page-in">
      <PageHeader
        title="词库"
        kicker="VOCAB / WORD BOOKS"
        onBack={() => nav('/today')}
        crumbs={[{ label: '单词', to: '/today' }, { label: '词库' }]}
        onNavigate={(to) => nav(to)}
        actions={
          <>
            <Button variant="outline" size="sm" icon={<Search size={14} aria-hidden />} onClick={() => nav('/dict')}>
              查词
            </Button>
            <IconButton label="刷新词库进度" onClick={reload}>
              <RefreshCw size={17} />
            </IconButton>
          </>
        }
      />

      {loading && <LoadingState rows={4} title="正在读取词库进度" />}

      {!loading && error && (
        <ErrorState
          title="词库进度读取失败"
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
            导入即进入科学复习循环：先想 → 作答 → 按遗忘曲线安排下一次
          </p>

          <div className="metric-row">
            <div className={`metric${data.due > 0 ? ' metric-hl' : ''}`}>
              <b className="tnum">{formatNumber(data.due)}</b>
              <span>今日待复习</span>
            </div>
            <div className="metric">
              <b className="tnum">{formatNumber(data.learned)}</b>
              <span>已学</span>
            </div>
            <div className="metric">
              <b className="tnum">{formatNumber(data.mastered)}</b>
              <span>已熟识</span>
            </div>
            <div className="metric">
              <b className="tnum">{formatNumber(data.cards)}</b>
              <span>词卡总数</span>
            </div>
          </div>

          <div style={{ marginBottom: 'var(--sp-4)' }}>
            <SearchInput value={kw} onChange={setKw} placeholder="搜索词书名称或说明" label="搜索词书" />
          </div>

          <Tabs tabs={tabs} active={cat} onChange={setCat} variant="pill" ariaLabel="词书分类" />

          <div id={`panel-${cat}`} role="tabpanel" aria-labelledby={`tab-${cat}`}>
            {visible.length > 0 ? (
              <div className="book-grid">
                {visible.map((b) => {
                  const s = statOf(b.key)
                  const total = BOOK_TOTALS[b.key] ?? 0
                  const pct = s.cards > 0 ? Math.round((s.learned / s.cards) * 100) : 0
                  const done = s.cards >= total
                  const canStudy = s.cards > 0
                  const plan = getPlan(b.key)
                  const cover = COVERS[b.key] || COVERS.cet4
                  const importing = s.importing > 0
                  const busy = !!importingKey || importing
                  return (
                    <Card key={b.key} className="fade-up">
                      <div className="inline" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 'var(--sp-3)' }}>
                        <div className="book-cover" style={{ background: cover.bg }} aria-hidden>
                          <b>{cover.tag}</b>
                          <span>{cover.sub}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="inline" style={{ flexWrap: 'nowrap', justifyContent: 'space-between' }}>
                            <span className="row-title truncate" title={b.name}>
                              {b.name}
                            </span>
                            {canStudy && (
                              <span className="book-pct tnum" title={`已学 ${formatNumber(s.learned)} / 已导入 ${formatNumber(s.cards)} 词`}>
                                {formatPercent(pct)}
                              </span>
                            )}
                          </div>
                          <div className="row-meta">
                            {b.desc} · 共 {formatNumber(total)} 词
                          </div>

                          {canStudy ? (
                            <>
                              <div style={{ marginTop: 'var(--sp-2)' }}>
                                <Progress
                                  value={pct}
                                  label={`${b.name} 学习进度 ${formatPercent(pct)}，已学 ${formatNumber(s.learned)} / 已导入 ${formatNumber(s.cards)} 词`}
                                />
                              </div>
                              <div className="row-meta" style={{ marginTop: 'var(--sp-2)' }}>
                                已导入 {formatNumber(s.cards)} · 已学 {formatNumber(s.learned)} · 每日 {formatNumber(plan.groups)} 组（
                                {formatNumber(plan.groups * WORDS_PER_GROUP)} 词）
                              </div>
                            </>
                          ) : (
                            <div className="inline gap-2" style={{ marginTop: 'var(--sp-2)' }}>
                              <Tag tone="neutral" icon={<Clock size={11} aria-hidden />}>
                                还没导入
                              </Tag>
                              <span className="row-meta">导入后即可开始学习</span>
                            </div>
                          )}

                          {done && (
                            <div className="inline gap-2" style={{ marginTop: 'var(--sp-2)' }}>
                              <Tag tone="success" icon={<CheckCircle2 size={11} aria-hidden />}>
                                已导入全部
                              </Tag>
                              {!canStudy && <span className="row-meta">从下面的「开始学习」建立记忆曲线</span>}
                            </div>
                          )}

                          {importing && (
                            <div className="inline gap-2" style={{ marginTop: 'var(--sp-2)' }}>
                              <Tag tone="brand" icon={<RefreshCw size={11} className="spin-ico" aria-hidden />}>
                                正在导入 {formatNumber(s.importing)} 词…
                              </Tag>
                            </div>
                          )}

                          {s.err && (
                            <div
                              role="alert"
                              className="inline"
                              style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-2)', color: 'var(--danger-ink)' }}
                            >
                              <AlertTriangle size={13} aria-hidden />
                              <span className="row-meta" style={{ color: 'inherit' }}>
                                导入失败：{s.err}
                              </span>
                              <Button size="xs" variant="outline" onClick={() => void startImport(b)}>
                                重试
                              </Button>
                            </div>
                          )}

                          <div className="inline" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
                            {!done && (
                              <Button
                                size="sm"
                                variant="outline"
                                icon={<Layers size={13} aria-hidden />}
                                loading={importingKey === b.key}
                                disabled={busy && importingKey !== b.key}
                                onClick={() => void startImport(b)}
                              >
                                {canStudy ? '继续导入 300 词' : '导入 300 词'}
                              </Button>
                            )}
                            {!done && canStudy && (
                              <Button size="sm" disabled={busy} onClick={() => setPendingAll(b)}>
                                导入全部（{formatNumber(total - s.cards)} 词）
                              </Button>
                            )}
                            {canStudy && (
                              <>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  icon={<Sparkles size={13} aria-hidden />}
                                  onClick={() => nav(`/vocab/${b.key}`)}
                                >
                                  开始学习
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon={<ListChecks size={13} aria-hidden />}
                                  onClick={() => nav(`/plan/${b.key}`)}
                                >
                                  计划
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            ) : (
              <Card>
                <EmptyState
                  title={searching ? '没有匹配的词书' : cat === 'notebook' ? '生词本还是空的' : '这个分类下暂时没有词书'}
                  desc={
                    searching
                      ? '换个关键词试试，或清空筛选查看全部四本词书。'
                      : cat === 'notebook'
                        ? '在查词页把不认识的词收藏进来，它们会和词书一起进入同一个复习循环。'
                        : '切回「热门」可以看到全部内置词书。'
                  }
                  action={emptyAction}
                />
              </Card>
            )}
          </div>

          <Card>
            <div className="inline" style={{ justifyContent: 'space-between' }}>
              <span className="section-label" style={{ margin: 0 }}>
                词书词量 / 进度对比
              </span>
              <Button
                size="xs"
                variant="text"
                aria-expanded={showTable}
                icon={showTable ? <RotateCcw size={12} aria-hidden /> : <BookOpen size={12} aria-hidden />}
                onClick={() => setShowTable((v) => !v)}
              >
                {showTable ? '收起对比表' : '展开对比表'}
              </Button>
            </div>
            {showTable && (
              <div style={{ marginTop: 'var(--sp-3)' }}>
                <DataTable
                  caption="四本内置词书的词量、导入情况与学习进度"
                  rows={rows}
                  rowKey={(r) => r.key}
                  columns={columns}
                  defaultSort={{ key: 'total', dir: 'desc' }}
                  empty={<EmptyState title="没有可对比的词书" desc="导入任意一本词书后这里会出现对比数据。" />}
                />
              </div>
            )}
          </Card>

          <div className="today-hint fade-up" style={{ marginTop: 'var(--sp-5)' }}>
            <span className="dot" aria-hidden />
            词书数据来自词典包，首次导入需要联网；导入后完全离线可用，每组 {WORDS_PER_GROUP} 词为一个知识点
          </div>

          <div className="inline gap-2" style={{ marginTop: 'var(--sp-3)' }}>
            <Tag tone="neutral" icon={<Library size={11} aria-hidden />}>
              学习记录保存在本机
            </Tag>
            {data.notebook > 0 && (
              <Button size="xs" variant="outline" icon={<BookOpen size={12} aria-hidden />} onClick={() => nav('/vocab/notebook')}>
                学习生词本（{formatNumber(data.notebook)} 词）
              </Button>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!pendingAll}
        title={`导入《${pendingAll?.name ?? ''}》全部单词？`}
        description={
          <>
            将把该词书剩余 <b>{formatNumber(Math.max(0, (BOOK_TOTALS[pendingAll?.key ?? ''] ?? 0) - statOf(pendingAll?.key ?? '').cards))}</b>{' '}
            个单词分批写入本机，字数较多，需要一段时间；期间请保持联网，已导入的词不会重复写入。
          </>
        }
        confirmText="开始导入全部"
        loading={!!importingKey}
        onCancel={() => {
          if (!importingKey) setPendingAll(null)
        }}
        onConfirm={() => {
          const book = pendingAll
          if (!book) return
          void importAll(book).finally(() => setPendingAll(null))
        }}
      />
    </div>
  )
}
