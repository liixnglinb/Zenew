// 云端 API 客户端：所有 LLM 生成请求都经服务端网关，客户端不接触任何 key
// 默认走公网网关（Cloudflare Workers）；本地开发可在设置页改回 http://127.0.0.1:8765
const DEFAULT_SERVER = 'https://zenew-api.lxlrwxs.top'
export function getServer(): string {
  return localStorage.getItem('zenew_server') || DEFAULT_SERVER
}
export function setServer(url: string) {
  localStorage.setItem('zenew_server', sanitizeServer(url))
}
/** 规范化服务地址：trim、补协议、去尾斜杠；非法返回空串 */
function sanitizeServer(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  try {
    const parsed = new URL(u)
    return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''))
  } catch {
    return ''
  }
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

export async function api(path: string, opts: { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.auth !== false && getToken()) headers['Authorization'] = `Bearer ${getToken()}`
  // 超时：默认 20s；生成类请求由调用方放宽（LLM 响应 5-40s）
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000)
  let resp: Response
  try {
    resp = await fetch(`${getServer()}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (ctrl.signal.aborted) throw new ApiError(0, '网络超时，请检查连接')
    throw new ApiError(0, '网络错误，请检查连接')
  }
  clearTimeout(timer)
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    // 401：token 失效 → 清凭证并广播，App 收到后回登录页（统一处理，避免各页僵尸态）
    if (resp.status === 401 && opts.auth !== false) {
      setToken(null)
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('zenew:unauthorized'))
    }
    throw new ApiError(resp.status, detailText(data.detail) || `请求失败 (${resp.status})`)
  }
  return data
}

/** FastAPI 422 的 detail 是数组/对象 → 归一为人话 */
function detailText(d: unknown): string {
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map((x) => (typeof x === 'object' && x !== null ? String((x as any).msg ?? '') : String(x))).filter(Boolean).join('；')
  if (typeof d === 'object' && d !== null) {
    const m = (d as any).msg
    return m ? String(m) : ''
  }
  return ''
}

export interface Me { email: string; used_tokens: number; quota_tokens: number; balance_tokens?: number }
export interface ChapterDef { title: string; topics: string[] }
export interface CourseDef { id: string; name: string; chapters: ChapterDef[] }

export const fetchCourses = (): Promise<{ version: number; courses: CourseDef[] }> =>
  api('/courses', { auth: false })

export const fetchMe = (): Promise<Me> => api('/me')

export const login = (email: string, password: string) =>
  api('/auth/login', { method: 'POST', body: { email, password }, auth: false })

export const register = (email: string, password: string, inviteCode: string) =>
  api('/auth/register', { method: 'POST', body: { email, password, invite_code: inviteCode }, auth: false })

export interface GenCard {
  type: 'basic' | 'why' | 'choice'
  front: string
  back: string
  explanation: string
  choices?: string[]
  answer_index?: number
}

export const genOutline = (title: string, num_chapters = 5) =>
  api('/gen/outline', { method: 'POST', body: { title, num_chapters }, timeoutMs: 120000 })

export const genCards = (
  topic_title: string,
  context: string | null,
  n = 5,
  types: string[] = ['basic', 'why', 'choice'],
  extra: { course?: string; chapter?: string; avoid?: string[] } = {}
) => api('/gen/cards', { method: 'POST', body: { topic_title, context, n, types, ...extra }, timeoutMs: 120000 })

/** 收款：网页下单（无需登录） */
export const createOrder = (tier: number, email?: string): Promise<{ order_no: string; tier: number; price_cny: number; tokens: number; status: string }> =>
  api('/billing/order', { method: 'POST', body: { tier, email }, auth: false })

/** 充值：卡密兑换（额度进入余额，不随月份清零） */
export const redeemCode = (code: string): Promise<{ ok: boolean; tier: number; price_cny: number; added_tokens: number; balance_tokens: number }> =>
  api('/billing/redeem', { method: 'POST', body: { code } })
