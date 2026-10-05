// 格式化工具：数字 / 百分比 / 日期时间 / 时长 / 敏感信息脱敏 / 长文本截断
// 全站统一出口，避免各页面各写一套

/** 千分位数字（本地化） */
export function formatNumber(n: number | null | undefined, fallback = '—'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return fallback
  return n.toLocaleString('zh-CN')
}

/** 紧凑数字：12345 → 1.2万（用于徽章等窄空间） */
export function formatCompact(n: number): string {
  if (Math.abs(n) < 10000) return formatNumber(n)
  return `${(n / 10000).toFixed(1)}万`
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** 日期：2026-10-05 / 2026年10月5日 */
export function formatDate(d: Date | string | number, style: 'iso' | 'cn' | 'short' = 'cn'): string {
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  const y = dt.getFullYear()
  const m = dt.getMonth() + 1
  const day = dt.getDate()
  if (style === 'iso') return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (style === 'short') return `${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return `${y}年${m}月${day}日`
}

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 昨天 / 10-05 */
export function formatRelative(d: Date | string | number): string {
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  const diff = Date.now() - dt.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  return formatDate(dt, 'short')
}

/** 时长：42 秒 / 3 分 20 秒 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total} 秒`
  const m = Math.floor(total / 60)
  const s = total % 60
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`
}

/** 倒计时：还有 2 天 03 小时 04 分 05 秒 */
export function formatCountdown(ms: number): string {
  const t = Math.max(0, ms)
  const d = Math.floor(t / 86400000)
  const h = Math.floor((t % 86400000) / 3600000)
  const m = Math.floor((t % 3600000) / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d)} 天 ${pad(h)} 小时 ${pad(m)} 分 ${pad(s)} 秒`
}


/** 长文本截断（含省略号），用于标题 / 列表项 */
export function truncate(text: string, max = 42): string {
  const t = (text || '').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** 安全数值：超大数字也不会撑破布局 */
export function safeNumber(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}
