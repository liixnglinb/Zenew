// 表单组件：Input / Textarea / SearchInput / Field / Switch / Checkbox / Radio / Segmented
// 每个控件都覆盖：默认 / 悬停 / 聚焦 / 错误 / 禁用 五态，并提供 aria 语义
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { AlertCircle, Check, Search } from 'lucide-react'

/* ---------------- Field 包装（标签 / 说明 / 错误） ---------------- */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  required,
}: {
  label?: string
  hint?: string
  error?: string
  htmlFor?: string
  children: ReactNode
  required?: boolean
}) {
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && <span aria-hidden> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className="field-error" role="alert">
          <AlertCircle size={12} /> {error}
        </span>
      ) : (
        hint && <span className="field-hint">{hint}</span>
      )}
    </div>
  )
}

/* ---------------- Input ---------------- */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label?: string
  hint?: string
  error?: string
  className?: string
  wrapClassName?: string
}

export function Input({ label, hint, error, className = '', wrapClassName = '', id, required, ...rest }: InputProps) {
  const autoId = useId()
  const inputId = id || autoId
  const descId = `${inputId}-desc`
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} required={required}>
      <input
        id={inputId}
        className={`input ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? descId : undefined}
        required={required}
        {...rest}
        style={wrapClassName ? undefined : rest.style}
      />
    </Field>
  )
}

/* ---------------- Textarea ---------------- */
export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  label?: string
  hint?: string
  error?: string
  className?: string
}

export function Textarea({ label, hint, error, className = '', id, ...rest }: TextareaProps) {
  const autoId = useId()
  const areaId = id || autoId
  return (
    <Field label={label} hint={hint} error={error} htmlFor={areaId}>
      <textarea id={areaId} className={`textarea ${className}`} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  )
}

/* ---------------- SearchInput ---------------- */
export function SearchInput({
  value,
  onChange,
  placeholder = '搜索',
  label = '搜索',
  className = '',
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label?: string
  className?: string
  autoFocus?: boolean
}) {
  return (
    <div className={`dict-search-wrap ${className}`} role="search">
      <Search size={16} aria-hidden />
      <input
        className="input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/* ---------------- Switch（role=switch） ---------------- */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** 无障碍名称；行内使用时可由左侧文字承担，仍建议传入 */
  label: string
  disabled?: boolean
  id?: string
}) {
  const autoId = useId()
  const sid = id || autoId
  return (
    <>
      <button
        id={sid}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`switch${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
      />
      <span className="sr-only" aria-live="polite">
        {label}：{checked ? '已开启' : '已关闭'}
      </span>
    </>
  )
}

/* ---------------- Checkbox / Radio ---------------- */
export interface ChoiceProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
  disabled?: boolean
  name?: string
  value?: string
}

export function Checkbox({ checked, onChange, label, disabled, name, value }: ChoiceProps) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="box" aria-hidden>
        <Check size={13} strokeWidth={3} />
      </span>
      <span>{label}</span>
    </label>
  )
}

export function Radio({ checked, onChange, label, disabled, name, value }: ChoiceProps) {
  return (
    <label className="check">
      <input
        type="radio"
        checked={checked}
        disabled={disabled}
        name={name}
        value={value}
        onChange={() => onChange(true)}
      />
      <span className="box is-round" aria-hidden>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: 'currentColor' }} />
      </span>
      <span>{label}</span>
    </label>
  )
}

/* ---------------- Segmented（同级少量互斥选项） ---------------- */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  ariaLabel: string
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
