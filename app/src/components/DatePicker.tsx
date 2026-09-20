import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  value: string // YYYY-MM-DD
  onChange: (value: string) => void
  placeholder?: string
  width?: number | string
  /** 允许选择的最早日期（YYYY-MM-DD），默认今天 */
  min?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

/** 胶囊日期选择器：自绘日历弹层（替代系统 date input） */
export default function DatePicker({ value, onChange, placeholder = '选择日期', width = 180, min }: Props) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(() => (value ? new Date(value + 'T00:00:00') : new Date()))
  const boxRef = useRef<HTMLDivElement>(null)
  const todayKey = fmt(new Date())
  const minKey = min || todayKey

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 一/二/三…日为表头 → 计算当月首格偏移（周一为第 0 列）
  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const first = new Date(y, m, 1)
  const offset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const cells: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${y}-${pad(m + 1)}-${pad(i + 1)}`),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const shift = (delta: number) => setCursor(new Date(y, m + delta, 1))
  const label = `${y} 年 ${m + 1} 月`

  return (
    <div className="sel" ref={boxRef} style={{ width }}>
      <button type="button" className={`sel-btn${open ? ' is-open' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}>
        <CalendarDays size={13} strokeWidth={2} className="sel-leading" />
        <span className={`sel-label${value ? '' : ' is-empty'}`}>{value || placeholder}</span>
      </button>
      {open && (
        <div className="dp-pop fade-up" role="dialog">
          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={() => shift(-1)} aria-label="上个月">
              <ChevronLeft size={15} />
            </button>
            <span className="dp-title">{label}</span>
            <button type="button" className="dp-nav" onClick={() => shift(1)} aria-label="下个月">
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="dp-week">
            {WEEK.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="dp-grid">
            {cells.map((key, i) =>
              key === null ? (
                <span key={`e${i}`} className="dp-cell is-empty" />
              ) : (
                <button
                  type="button"
                  key={key}
                  className={`dp-cell${key === value ? ' is-sel' : ''}${key === todayKey ? ' is-today' : ''}`}
                  disabled={key < minKey}
                  onClick={() => {
                    onChange(key)
                    setOpen(false)
                  }}
                >
                  {Number(key.slice(8, 10))}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
