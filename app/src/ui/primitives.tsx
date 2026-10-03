// 基础展示组件：Button / IconButton / Tag / Badge / Avatar / Progress / Spinner / Skeleton / Card / Divider
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { avatarVisual } from '../study'

/* ---------------- Button ---------------- */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'text' | 'danger' | 'mint'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 加载中：禁用交互并显示 spinner */
  loading?: boolean
  block?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
  className?: string
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: '',
  outline: 'btn-outline',
  ghost: 'btn-ghost',
  text: 'is-text',
  danger: 'is-danger',
  mint: 'btn-mint',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  block = false,
  icon,
  iconRight,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    VARIANT_CLASS[variant],
    size === 'lg' ? 'btn-lg' : size === 'sm' ? 'btn-sm' : size === 'xs' ? 'btn-xs' : '',
    block ? 'btn-block' : '',
    loading ? 'is-loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 size={15} className="spin-ico" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  )
}

/* ---------------- IconButton（必须有可读标签） ---------------- */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  /** 无障碍名称（必填，同时作为 tooltip） */
  label: string
  children: ReactNode
  className?: string
  tone?: 'default' | 'danger'
}

export function IconButton({ label, children, className = '', tone = 'default', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={`icon-btn${tone === 'danger' ? ' is-danger' : ''} ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ---------------- Tag / Badge ---------------- */
export type TagTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral'
export interface TagProps {
  tone?: TagTone
  icon?: ReactNode
  mono?: boolean
  children: ReactNode
  title?: string
  className?: string
}

const TAG_TONE: Record<TagTone, string> = {
  brand: '',
  success: 'tag-ok',
  warning: 'tag-gold',
  danger: 'is-danger',
  neutral: 'is-neutral',
}

/** 状态标签：图标 + 文字，避免只用颜色区分（色盲友好） */
export function Tag({ tone = 'brand', icon, mono, children, title, className = '' }: TagProps) {
  return (
    <span className={`tag ${TAG_TONE[tone]}${mono ? ' tag-mono' : ''} ${className}`} title={title}>
      {icon}
      {children}
    </span>
  )
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`badge ${className}`}>{children}</span>
}

/* ---------------- Avatar ---------------- */
export function Avatar({
  seed,
  name,
  size = 'md',
  className = '',
}: {
  seed: string
  /** 无障碍名称，默认用 seed */
  name?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const av = avatarVisual(seed || '知新')
  return (
    <span
      className={`avatar is-${size} ${className}`}
      style={{ background: `linear-gradient(140deg, ${av.from}, ${av.to})` }}
      role="img"
      aria-label={name || seed}
    >
      {av.initial}
    </span>
  )
}

/* ---------------- Progress ---------------- */
export function Progress({
  value,
  max = 100,
  tone = 'brand',
  label,
  style,
}: {
  value: number
  max?: number
  tone?: 'brand' | 'mint'
  /** 无障碍标签（读屏播报用） */
  label?: string
  style?: CSSProperties
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div
      className={`progress-line${tone === 'mint' ? ' is-mint' : ''}`}
      style={style}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <i style={{ width: `${pct}%` }} />
    </div>
  )
}

/* ---------------- Spinner / Skeleton ---------------- */
export function Spinner({ size = 18, label = '加载中' }: { size?: number; label?: string }) {
  return <Loader2 size={size} className="spin-ico" role="status" aria-label={label} />
}

export function Skeleton({ height = 14, width = '100%', radius = 999, className = '' }: { height?: number | string; width?: number | string; radius?: number; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height, width, borderRadius: radius }} aria-hidden />
}

/* ---------------- Card ---------------- */
export function Card({
  children,
  variant = 'solid',
  className = '',
  as: Tag_ = 'div',
  onClick,
  style,
}: {
  children: ReactNode
  variant?: 'solid' | 'glass' | 'flat'
  className?: string
  as?: 'div' | 'section' | 'article'
  onClick?: () => void
  style?: CSSProperties
}) {
  const cls = `card${variant === 'glass' ? ' card-glass' : ''} ${className}`
  if (onClick) {
    return (
      <Tag_ className={cls} style={style} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
        {children}
      </Tag_>
    )
  }
  return (
    <Tag_ className={cls} style={style}>
      {children}
    </Tag_>
  )
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`hr ${className}`} role="separator" />
}
