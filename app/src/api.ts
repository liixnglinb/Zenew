// 云端 API 客户端：所有 LLM 生成请求都经服务端网关，客户端不接触任何 key
// 默认走公网网关（Cloudflare Workers）；本地开发可在设置页改回 http://127.0.0.1:8765
const DEFAULT_SERVER = 'https://zenew-api.lxlrwxs.top'
export function getServer(): string {
  return localStorage.getItem('zenew_server') || DEFAULT_SERVER
}
export function setServer(url: string) {
  localStorage.setItem('zenew_server', url.replace(/\/+$/, ''))
}
export function getToken(): string | null {
  return localStorage.getItem('zenew_token')
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem('zenew_token', t)
  else localStorage.removeItem('zenew_token')
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api(path: string, opts: { method?: string; body?: unknown; auth?: boolean } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.auth !== false && getToken()) headers['Authorization'] = `Bearer ${getToken()}`
  const resp = await fetch(`${getServer()}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new ApiError(resp.status, data.detail || `请求失败 (${resp.status})`)
  return data
}

export interface Me { email: string; used_tokens: number; quota_tokens: number }
export interface ChapterDef { title: string; topics: string[] }
export interface CourseDef { id: string; name: string; chapters: ChapterDef[] }

export const fetchCourses = (): Promise<{ version: number; courses: CourseDef[] }> =>
  api('/courses', { auth: false })

export const fetchMe = (): Promise<Me> => api('/me')

export const login = (email: string, password: string) =>
  api('/auth/login', { method: 'POST', body: { email, password }, auth: false })

export const register = (email: string, password: string) =>
  api('/auth/register', { method: 'POST', body: { email, password }, auth: false })

export interface GenCard {
  type: 'basic' | 'why' | 'choice'
  front: string
  back: string
  explanation: string
  choices?: string[]
  answer_index?: number
}

export const genOutline = (title: string, num_chapters = 5) =>
  api('/gen/outline', { method: 'POST', body: { title, num_chapters } })

export const genCards = (topic_title: string, context: string | null, n = 5, types: string[] = ['basic', 'why', 'choice']) =>
  api('/gen/cards', { method: 'POST', body: { topic_title, context, n, types } })
