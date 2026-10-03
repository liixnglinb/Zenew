// 数据展示：DataTable（高信息密度场景：列宽 / 排序 / 操作列 / 三态）
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Inbox } from 'lucide-react'
import { Skeleton } from './primitives'

export interface Column<T> {
  key: string
  header: ReactNode
  /** 列宽（px 或 CSS 长度） */
  width?: number | string
  align?: 'start' | 'end'
  sortable?: boolean
  /** 单元格渲染；缺省取 row[key] */
  render?: (row: T, index: number) => ReactNode
  /** 排序取值（数值或字符串） */
  sortValue?: (row: T) => number | string
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string | number
  caption?: string
  loading?: boolean
  /** 空态内容（默认带图标提示） */
  empty?: ReactNode
  /** 行点击（可选，键盘可达） */
  onRowClick?: (row: T) => void
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  empty,
  onRowClick,
  defaultSort,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const get = (r: T) => (col.sortValue ? col.sortValue(r) : (r[col.key] as number | string))
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'zh-Hans-CN') * dir
    })
  }, [rows, sort, columns])

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  if (loading) {
    return (
      <div className="card" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        <Skeleton height={16} width="30%" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={14} width={`${90 - i * 8}%`} />
        ))}
      </div>
    )
  }

  if (!sorted.length) {
    return (
      <div className="card">
        {empty || (
          <div className="state-view" role="status">
            <span className="state-art" aria-hidden>
              <Inbox size={28} />
            </span>
            <div className="state-title">暂无数据</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const isSorted = sort?.key === c.key
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: c.width, textAlign: c.align === 'end' ? 'end' : 'start' }}
                  aria-sort={isSorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}
                  onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                  onKeyDown={
                    c.sortable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleSort(c.key)
                          }
                        }
                      : undefined
                  }
                  tabIndex={c.sortable ? 0 : undefined}
                >
                  {c.header}
                  {c.sortable && isSorted && (
                    <span className="sort-mark" aria-hidden>
                      {sort!.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter') onRowClick(row)
                    }
                  : undefined
              }
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'end' ? 'is-num' : undefined}>
                  {c.render ? c.render(row, i) : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
