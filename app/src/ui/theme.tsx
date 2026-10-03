// 主题：跟随系统 / 手动浅色 / 手动深色（写入 html[data-theme]）
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'zenew_theme'

interface ThemeCtx {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (m: ThemeMode) => void
  /** 浅↔深 快速切换（写为手动模式） */
  toggle: () => void
}

const Ctx = createContext<ThemeCtx>({ mode: 'system', resolved: 'light', setMode: () => {}, toggle: () => {} })

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode
}

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* 隐私模式 */
  }
  return 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readMode)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readMode()))

  useEffect(() => {
    const apply = () => {
      const r = resolveTheme(mode)
      setResolved(r)
      document.documentElement.setAttribute('data-theme', r)
      // 让原生滚动条 / 表单控件跟随主题
      document.documentElement.style.colorScheme = r
    }
    apply()
    if (mode !== 'system' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [mode])

  const setMode = useCallback((m: ThemeMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, m)
    } catch {
      /* ignore */
    }
    setModeState(m)
  }, [])

  const toggle = useCallback(() => {
    setMode(resolveTheme(readMode()) === 'dark' ? 'light' : 'dark')
  }, [setMode])

  const value = useMemo(() => ({ mode, resolved, setMode, toggle }), [mode, resolved, setMode, toggle])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
