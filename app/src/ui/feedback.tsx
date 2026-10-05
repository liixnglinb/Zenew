// 反馈与状态组件：三态视图（加载/空/错误）、断网横幅、全局错误边界
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Compass, Inbox, RefreshCw, WifiOff } from 'lucide-react'
import { Button } from './primitives'
import { Skeleton } from './primitives'

/* ---------------- 空态 ---------------- */
export function EmptyState({
  title = '这里还没有内容',
  desc,
  action,
  art,
}: {
  title?: string
  desc?: ReactNode
  action?: ReactNode
  art?: ReactNode
}) {
  return (
    <div className="state-view" role="status">
      <span className="state-art" aria-hidden>
        {art || <Inbox size={30} />}
      </span>
      <div className="state-title">{title}</div>
      {desc && <p className="state-desc">{desc}</p>}
      {action && <div className="state-actions">{action}</div>}
    </div>
  )
}

/* ---------------- 错误态（带重试） ---------------- */
export function ErrorState({
  title = '加载失败',
  desc,
  onRetry,
  retryText = '重试',
  extra,
}: {
  title?: string
  desc?: ReactNode
  onRetry?: () => void
  retryText?: string
  extra?: ReactNode
}) {
  return (
    <div className="state-view" role="alert">
      <span className="state-art is-danger" aria-hidden>
        <AlertTriangle size={28} />
      </span>
      <div className="state-title">{title}</div>
      {desc && <p className="state-desc">{desc}</p>}
      <div className="state-actions">
        {onRetry && (
          <Button variant="primary" size="sm" icon={<RefreshCw size={14} />} onClick={onRetry}>
            {retryText}
          </Button>
        )}
        {extra}
      </div>
    </div>
  )
}

/* ---------------- 加载态（骨架屏，固定高度避免布局抖动） ---------------- */
export function LoadingState({ rows = 3, title }: { rows?: number; title?: string }) {
  return (
    <div className="card" aria-busy="true" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      {title && <span className="sr-only">{title}</span>}
      <Skeleton height={20} width="42%" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={14} width={i % 2 ? '72%' : '88%'} />
      ))}
      <div className="skeleton skeleton-block" style={{ height: 96 }} />
    </div>
  )
}

/* ---------------- 断网 / 弱网横幅 ---------------- */
export function NetBanner({ online, onRetry }: { online: boolean; onRetry?: () => void }) {
  if (online) return null
  return (
    <div className="net-banner is-offline" role="status" aria-live="polite">
      <WifiOff size={16} aria-hidden />
      <span style={{ flex: 1 }}>
        当前离线：学习、复习、查词与统计全部照常可用（词库已内置），只有检查更新需要联网。
      </span>
      {onRetry && (
        <Button variant="outline" size="xs" icon={<RefreshCw size={12} />} onClick={onRetry}>
          重新连接
        </Button>
      )}
    </div>
  )
}

/* ---------------- 全局错误边界 ---------------- */
interface EBState {
  error: Error | null
}
export class ErrorBoundary extends Component<{ children: ReactNode; onReset?: () => void }, EBState> {
  state: EBState = { error: null }

  static getDerivedStateFromError(error: Error): EBState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('界面渲染异常：', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ margin: 'var(--sp-6) auto', maxWidth: 520 }}>
          <ErrorState
            title="这个页面出了点问题"
            desc={
              <>
                已经记录到控制台，其他页面不受影响。
                <br />
                <span className="row-meta">{this.state.error.message}</span>
              </>
            }
            onRetry={() => {
              this.setState({ error: null })
              this.props.onReset?.()
            }}
            retryText="重新加载本页"
            extra={
              <Button variant="ghost" size="sm" icon={<Compass size={14} />} onClick={() => { window.location.hash = '#/today' }}>
                回到首页
              </Button>
            }
          />
        </div>
      )
    }
    return this.props.children
  }
}
