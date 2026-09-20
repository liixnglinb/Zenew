import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  width?: number | string
  title?: string
  disabled?: boolean
}

/** 胶囊下拉：自绘弹层（替代系统 select，保持黑白灰+金 的 Voyra 语言） */
export default function Select({ value, options, onChange, placeholder = '请选择', width = 220, title, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => Math.min(options.length - 1, a + 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => Math.max(0, a - 1))
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const opt = options[active]
        if (opt) {
          onChange(opt.value)
          setOpen(false)
        }
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, active, options, onChange])

  const openList = () => {
    if (disabled) return
    const idx = options.findIndex((o) => o.value === value)
    setActive(idx >= 0 ? idx : 0)
    setOpen((o) => !o)
  }

  return (
    <div className="sel" ref={boxRef} style={{ width }}>
      <button type="button" className={`sel-btn${open ? ' is-open' : ''}`} onClick={openList} title={title} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
        <span className={`sel-label${current ? '' : ' is-empty'}`}>{current ? current.label : placeholder}</span>
        <ChevronDown size={14} strokeWidth={2} className="sel-arrow" />
      </button>
      {open && (
        <div className="sel-pop fade-up" role="listbox">
          {options.map((o, i) => (
            <button
              type="button"
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`sel-opt${o.value === value ? ' is-sel' : ''}${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span className="sel-opt-label">{o.label}</span>
              {o.value === value && <Check size={13} strokeWidth={2.4} />}
            </button>
          ))}
          {options.length === 0 && <div className="sel-empty">无可选项</div>}
        </div>
      )}
    </div>
  )
}
