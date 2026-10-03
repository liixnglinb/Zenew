// 全局 Toast：成功/失败/提示/警告统一出口（aria-live 播报，可点击关闭）
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

interface ToastApi {
  show: (text: string, kind?: ToastKind, durationMs?: number) => void
  success: (text: string) => void
  error: (text: string) => void
  warning: (text: string) => void
  info: (text: string) => void
}

const Ctx = createContext<ToastApi>({
  show: () => {},
  success: () => {},
  error: () => {},
  warning: () => {},
  info: () => {},
})

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={16} />,
  error: <XCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (text: string, kind: ToastKind = 'info', durationMs?: number) => {
      const id = ++seq.current
      setItems((list) => [...list.slice(-2), { id, kind, text }])
      const ms = durationMs ?? (kind === 'error' ? 4200 : 2400)
      window.setTimeout(() => remove(id), ms)
    },
    [remove]
  )

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (t: string) => show(t, 'success'),
      error: (t: string) => show(t, 'error'),
      warning: (t: string) => show(t, 'warning'),
      info: (t: string) => show(t, 'info'),
    }),
    [show]
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-host" role="status" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.id} className={`toast is-${t.kind}`}>
            <span className="toast-ico">{ICONS[t.kind]}</span>
            <span className="toast-text">{t.text}</span>
            <button className="toast-x" aria-label="关闭提示" onClick={() => remove(t.id)}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
