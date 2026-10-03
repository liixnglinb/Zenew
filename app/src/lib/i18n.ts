// 轻量 i18n 骨架：为多语言与 RTL（从右到左）预留能力
// 目前内置 zh-CN（默认）与 en-US 两份词条，覆盖导航 / 通用操作 / 状态文案；
// 业务文案仍可直接写中文字面量，等接入翻译流程时再逐步迁移到 t()。
import { useCallback, useEffect, useState } from 'react'

export type Lang = 'zh-CN' | 'en-US'

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
]

const RTL_LANGS: Lang[] = []

const DICT: Record<string, { 'zh-CN': string; 'en-US': string }> = {
  'nav.home': { 'zh-CN': '单词', 'en-US': 'Words' },
  'nav.study': { 'zh-CN': '学习', 'en-US': 'Study' },
  'nav.train': { 'zh-CN': '训练场', 'en-US': 'Practice' },
  'nav.social': { 'zh-CN': '一起背', 'en-US': 'Together' },
  'nav.me': { 'zh-CN': '我的', 'en-US': 'Me' },
  'action.save': { 'zh-CN': '保存', 'en-US': 'Save' },
  'action.cancel': { 'zh-CN': '取消', 'en-US': 'Cancel' },
  'action.retry': { 'zh-CN': '重试', 'en-US': 'Retry' },
  'action.delete': { 'zh-CN': '删除', 'en-US': 'Delete' },
  'action.start': { 'zh-CN': '开始学习', 'en-US': 'Start learning' },
  'state.loading': { 'zh-CN': '加载中…', 'en-US': 'Loading…' },
  'state.empty': { 'zh-CN': '暂无内容', 'en-US': 'Nothing here yet' },
  'state.error': { 'zh-CN': '加载失败', 'en-US': 'Failed to load' },
  'state.offline': { 'zh-CN': '当前处于离线状态', 'en-US': 'You are offline' },
}

const STORAGE_KEY = 'zenew_lang'

let current: Lang = readLang()
const listeners = new Set<(l: Lang) => void>()

function readLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'zh-CN' || v === 'en-US') return v
  } catch {
    /* ignore */
  }
  return 'zh-CN'
}

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  current = lang
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* ignore */
  }
  applyDirection(lang)
  listeners.forEach((fn) => fn(lang))
}

export function isRTL(lang: Lang = current): boolean {
  return RTL_LANGS.includes(lang)
}

/** 把书写方向写到 <html dir>（RTL 语言预留；我们的关键布局已用逻辑属性） */
export function applyDirection(lang: Lang = current): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('lang', lang)
  document.documentElement.setAttribute('dir', isRTL(lang) ? 'rtl' : 'ltr')
}

/** 取词条：t('nav.home')；缺失时回退到 key，便于发现未翻译项 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = DICT[key]
  let text = entry ? entry[current] : key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
  }
  return text
}

/** React 侧使用：语言变化会自动重渲染 */
export function useI18n(): { lang: Lang; setLang: (l: Lang) => void; t: typeof t; rtl: boolean } {
  const [lang, setLangState] = useState<Lang>(current)

  useEffect(() => {
    const fn = (l: Lang) => setLangState(l)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])

  useEffect(() => {
    applyDirection(current)
  }, [])

  const change = useCallback((l: Lang) => setLang(l), [])
  return { lang, setLang: change, t, rtl: isRTL(lang) }
}
