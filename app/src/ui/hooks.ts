// 通用 hooks：网络状态、异步三态、防重复提交、焦点陷阱、断点、防抖
import { useCallback, useEffect, useRef, useState } from 'react'

/** 在线状态（断网 / 重连） */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** 异步数据三态（加载 / 成功 / 失败 + 重试） */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let dead = false
    setLoading(true)
    setError(null)
    fnRef
      .current()
      .then((d) => {
        if (!dead) {
          setData(d)
          setLoading(false)
        }
      })
      .catch((e: unknown) => {
        if (!dead) {
          setError(e instanceof Error ? e.message : '加载失败，请重试')
          setLoading(false)
        }
      })
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, loading, error, reload }
}

/** 防重复提交：busy 期间按钮禁用，异常自动复位 */
export function useSubmit(): [boolean, (fn: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    if (lock.current) return // 并发点击直接忽略
    lock.current = true
    setBusy(true)
    try {
      await fn()
    } finally {
      lock.current = false
      setBusy(false)
    }
  }, [])
  return [busy, run]
}

/** 焦点陷阱（弹窗 / 抽屉） */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    if (!active || !ref.current) return
    const root = ref.current
    const prev = document.activeElement as HTMLElement | null
    const focusables = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null || el === document.activeElement)
    const first = focusables()[0]
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const list = focusables()
      if (!list.length) return
      const firstEl = list[0]
      const lastEl = list[list.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [active])
  return ref
}

/** Esc 关闭 */
export function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onEscape()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onEscape])
}

/** 媒体查询断点 */
export function useMediaQuery(query: string): boolean {
  const [hit, setHit] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches))
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setHit(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return hit
}

/** 防抖值（搜索输入等） */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
