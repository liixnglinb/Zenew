// 导航组件：Tabs / Breadcrumb / PageHeader / Pagination
// Tabs 支持 ← → 方向键切换（role=tablist 无障碍语义）
import { useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Home } from 'lucide-react'

/* ---------------- Tabs ---------------- */
export interface TabItem<K extends string = string> {
  key: K
  label: ReactNode
  icon?: ReactNode
  /** 角标（如未读数） */
  badge?: ReactNode
}

export function Tabs<K extends string = string>({
  tabs,
  active,
  onChange,
  variant = 'pill',
  ariaLabel,
}: {
  tabs: TabItem<K>[]
  active: K
  onChange: (key: K) => void
  /** pill=胶囊分类 | navy=深色详情头 | mini=细底线下划线 */
  variant?: 'pill' | 'navy' | 'mini'
  ariaLabel: string
}) {
  const listRef = useRef<HTMLDivElement | null>(null)

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = tabs.findIndex((t) => t.key === active)
    if (idx < 0) return
    let next = idx
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    onChange(tabs[next].key)
    const btns = listRef.current?.querySelectorAll<HTMLButtonElement>('button')
    btns?.[next]?.focus()
  }

  const wrapClass = variant === 'navy' ? 'detail-tabs' : variant === 'mini' ? 'mini-tabs' : 'cat-tabs'
  const tabClass = variant === 'navy' ? 'detail-tab' : variant === 'mini' ? 'mini-tab' : 'cat-tab'

  return (
    <div className={wrapClass} role="tablist" aria-label={ariaLabel} ref={listRef} onKeyDown={onKeyDown}>
      {tabs.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={on}
            aria-controls={`panel-${t.key}`}
            tabIndex={on ? 0 : -1}
            className={`${tabClass}${on ? ' is-active' : ''}`}
            onClick={() => onChange(t.key)}
          >
            {t.icon}
            {t.label}
            {t.badge}
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- Breadcrumb ---------------- */
export interface Crumb {
  label: string
  to?: string
}

export function Breadcrumb({ items, onNavigate }: { items: Crumb[]; onNavigate?: (to: string) => void }) {
  if (!items.length) return null
  return (
    <nav className="breadcrumb" aria-label="面包屑导航">
      <Home size={12} aria-hidden />
      {items.map((c, i) => {
        const last = i === items.length - 1
        return (
          <span key={`${c.label}-${i}`} className="inline" style={{ gap: 6 }}>
            {i > 0 && (
              <span className="sep" aria-hidden>
                /
              </span>
            )}
            {c.to && !last ? (
              <button type="button" onClick={() => onNavigate?.(c.to!)}>
                {c.label}
              </button>
            ) : (
              <span aria-current={last ? 'page' : undefined}>{c.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

/* ---------------- PageHeader（返回 + 面包屑 + 标题 + 操作） ---------------- */
export function PageHeader({
  title,
  crumbs,
  onBack,
  onNavigate,
  actions,
  kicker,
}: {
  title: ReactNode
  crumbs?: Crumb[]
  /** 传入则显示返回按钮（返回上一层） */
  onBack?: () => void
  onNavigate?: (to: string) => void
  actions?: ReactNode
  kicker?: ReactNode
}) {
  return (
    <header style={{ marginBottom: 'var(--sp-4)' }}>
      {crumbs && crumbs.length > 0 && (
        <div style={{ marginBottom: 'var(--sp-2)' }}>
          <Breadcrumb items={crumbs} onNavigate={onNavigate} />
        </div>
      )}
      <div className="page-header">
        {onBack && (
          <button type="button" className="icon-btn" aria-label="返回上一页" title="返回" onClick={onBack}>
            <ChevronLeft size={18} />
          </button>
        )}
        <div className="page-header-main">
          {kicker && <div className="kicker">{kicker}</div>}
          <h1 className="page-header-title">{title}</h1>
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </header>
  )
}

/* ---------------- Pagination（页码 + 加载更多） ---------------- */
export function Pagination({
  page,
  pageCount,
  onChange,
  total,
  label = '分页',
}: {
  page: number
  pageCount: number
  onChange: (p: number) => void
  total?: number
  label?: string
}) {
  if (pageCount <= 1) return null
  const nums: number[] = []
  const from = Math.max(1, Math.min(page - 2, pageCount - 4))
  const to = Math.min(pageCount, from + 4)
  for (let i = from; i <= to; i++) nums.push(i)
  return (
    <nav className="pagination" aria-label={label}>
      <button className="page-btn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="上一页">
        <ChevronLeft size={15} />
      </button>
      {nums.map((n) => (
        <button
          key={n}
          className="page-btn"
          aria-current={n === page ? 'page' : undefined}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
      <button className="page-btn" disabled={page >= pageCount} onClick={() => onChange(page + 1)} aria-label="下一页">
        <ChevronRight size={15} />
      </button>
      {typeof total === 'number' && (
        <span className="row-meta" style={{ marginInlineStart: 'var(--sp-2)' }}>
          共 {total} 条
        </span>
      )}
    </nav>
  )
}

/** 加载更多（长列表增量渲染，配合虚拟滚动场景的轻量替代） */
export function LoadMore({ onClick, loading, remaining }: { onClick: () => void; loading?: boolean; remaining: number }) {
  if (remaining <= 0) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--sp-4)' }}>
      <button type="button" className="btn btn-outline btn-sm" onClick={onClick} disabled={loading} aria-busy={loading}>
        {loading ? '加载中…' : `加载更多（还有 ${remaining} 条）`}
      </button>
    </div>
  )
}
