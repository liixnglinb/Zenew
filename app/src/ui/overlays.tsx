// 浮层组件：Modal / ConfirmDialog / Drawer / BottomSheet
// 统一：焦点陷阱、Esc 关闭、遮罩点击关闭、aria-modal、危险操作二次确认
import { useCallback, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useEscape, useFocusTrap } from './hooks'
import { Button } from './primitives'

export function Modal({
  open,
  onClose,
  title,
  children,
  actions,
  labelledBy,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  actions?: ReactNode
  labelledBy?: string
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(open)
  useEscape(open, onClose)
  if (!open) return null
  const titleId = labelledBy || 'modal-title'
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={trapRef}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
          <h2 className="modal-title" id={titleId} style={{ flex: 1 }}>
            {title}
          </h2>
          <button type="button" className="icon-btn" aria-label="关闭对话框" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

/** 危险 / 重要操作二次确认 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const handleCancel = useCallback(() => {
    if (!loading) onCancel()
  }, [loading, onCancel])
  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title={title}
      actions={
        <>
          <Button variant="ghost" onClick={handleCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </>
      }
    >
      {description}
    </Modal>
  )
}

export function Drawer({
  open,
  onClose,
  side = 'left',
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  side?: 'left' | 'right'
  title: ReactNode
  children: ReactNode
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(open)
  useEscape(open, onClose)
  if (!open) return null
  return (
    <>
      <div className="drawer-mask" onMouseDown={onClose} />
      <aside
        className={`drawer is-${side}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : '导航抽屉'}
        ref={trapRef}
        style={{ ['--drawer-from' as string]: side === 'left' ? '-100%' : '100%' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <h2 className="drawer-title" style={{ flex: 1, marginBottom: 0 }}>
            {title}
          </h2>
          <button type="button" className="icon-btn" aria-label="关闭抽屉" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="drawer-divider" />
        {children}
      </aside>
    </>
  )
}

/** 底部动作面板（移动端习惯） */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
}) {
  const trapRef = useFocusTrap<HTMLDivElement>(open)
  useEscape(open, onClose)
  if (!open) return null
  return (
    <>
      <div className="sheet-mask" onMouseDown={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : '操作面板'} ref={trapRef}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <h2 className="sheet-title" style={{ flex: 1, marginBottom: 0 }}>
            {title}
          </h2>
          <button type="button" className="icon-btn" aria-label="关闭面板" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </>
  )
}
