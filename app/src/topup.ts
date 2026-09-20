// 充值到账监听：两条通道识别成功
//  A. 轮询兜底：付款确认后服务端加余额 → 客户端定时比对余额/订单状态
//  B. 深链直达：购买页付款成功 → zenew://paid?order=xxx 拉起并聚焦软件 → 立即对账
import { listen } from '@tauri-apps/api/event'
import { fetchMe, fetchMyOrders, type Me, type MyOrder } from './api'
import { isTauri } from './db'

const WATCH_KEY = 'zenew_topup_watch'
const POLL_MS = 8000
const MAX_WATCH_MS = 30 * 60 * 1000 // 最多盯 30 分钟

export interface TopupWatch {
  sid: string
  started_at: string
  baseline_balance: number
  email: string
  /** 用户开始付款后由深链或轮询标记 */
  claimed_order?: string
}

export interface TopupEvent {
  kind: 'paid' | 'timeout'
  added?: number
  balance?: number
  orderNo?: string
}

export function startWatch(email: string, baselineBalance: number): TopupWatch {
  const w: TopupWatch = {
    sid: Math.random().toString(36).slice(2, 10).toUpperCase(),
    started_at: new Date().toISOString(),
    baseline_balance: baselineBalance,
    email,
  }
  localStorage.setItem(WATCH_KEY, JSON.stringify(w))
  return w
}

export function readWatch(): TopupWatch | null {
  try {
    const raw = localStorage.getItem(WATCH_KEY)
    if (!raw) return null
    const w = JSON.parse(raw) as TopupWatch
    if (Date.now() - new Date(w.started_at).getTime() > MAX_WATCH_MS) {
      localStorage.removeItem(WATCH_KEY)
      return null
    }
    return w
  } catch {
    return null
  }
}

export function clearWatch(): void {
  localStorage.removeItem(WATCH_KEY)
}

export function markClaimed(orderNo: string): void {
  const w = readWatch()
  if (!w) return
  w.claimed_order = orderNo
  localStorage.setItem(WATCH_KEY, JSON.stringify(w))
}

/** 对账一次：余额增长优先，其次看是否有新的已支付订单 */
export async function reconcile(w: TopupWatch): Promise<TopupEvent | null> {
  try {
    const me: Me = await fetchMe()
    if ((me.balance_tokens || 0) > w.baseline_balance) {
      return { kind: 'paid', added: (me.balance_tokens || 0) - w.baseline_balance, balance: me.balance_tokens, orderNo: w.claimed_order }
    }
    const orders: MyOrder[] = await fetchMyOrders().catch(() => [])
    const startedAt = new Date(w.started_at).getTime() - 60_000 // 允许 1 分钟时钟偏差
    const paidNew = orders.find((o) => o.status === 'paid' && new Date(o.paid_at || o.created_at).getTime() >= startedAt)
    if (paidNew) {
      // 已支付但余额还没涨（例如订单没绑邮箱、发了兑换码）→ 交给 UI 提示用户去兑换
      return { kind: 'paid', added: paidNew.credited ? paidNew.tokens : 0, balance: me.balance_tokens, orderNo: paidNew.order_no }
    }
    return null
  } catch {
    return null
  }
}

/** 最近一次到账事件（供页面挂载时补显示） */
let lastEvent: TopupEvent | null = null
export function getLastTopupEvent(): TopupEvent | null {
  return lastEvent
}
export function clearLastTopupEvent(): void {
  lastEvent = null
}

/**
 * 挂载监听：轮询 + 深链。
 * onEvent 收到 paid 时 UI 弹横幅并刷新；收到 timeout 时提示仍可手动刷新。
 */
export function watchTopup(onEvent: (e: TopupEvent) => void): () => void {
  let stopped = false
  let timer: ReturnType<typeof setInterval> | null = null

  const tick = async () => {
    if (stopped) return
    const w = readWatch()
    if (!w) {
      if (timer) clearInterval(timer)
      return
    }
    const ev = await reconcile(w)
    if (ev) {
      clearWatch()
      if (timer) clearInterval(timer)
      lastEvent = ev
      onEvent(ev)
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('zenew:topup', { detail: ev }))
    }
  }

  const start = () => {
    if (timer) clearInterval(timer)
    timer = setInterval(() => void tick(), POLL_MS)
    void tick() // 立即对一次（深链场景常常已经到账）
  }

  start()

  // 窗口重新获得焦点 / 变为可见时立刻对账
  // （浏览器打开付款页后 WebView 会被后台节流，定时器可能被拉长到分钟级）
  const onWake = () => {
    if (document.visibilityState === 'visible') void tick()
  }
  window.addEventListener('focus', onWake)
  document.addEventListener('visibilitychange', onWake)

  // 深链（zenew://paid?order=XXX）→ 标记订单并立即对账
  let unlisten: (() => void) | undefined
  if (isTauri()) {
    void listen<string>('deep-link', (e) => {
      const url = e.payload || ''
      if (!url.startsWith('zenew://')) return
      try {
        const u = new URL(url)
        const order = u.searchParams.get('order')
        if (order) markClaimed(order)
      } catch {}
      start()
    })
      .then((f) => {
        unlisten = f as () => void
      })
      .catch(() => {})
  }

  return () => {
    stopped = true
    if (timer) clearInterval(timer)
    window.removeEventListener('focus', onWake)
    document.removeEventListener('visibilitychange', onWake)
    unlisten?.()
  }
}
