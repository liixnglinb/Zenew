import { useState, useEffect } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getServer, setServer, fetchMe, redeemCode, ApiError, type Me } from '../api'
import { checkUpdate, applyUpdate, type UpdateInfo } from '../updater'
import { isTauri } from '../db'
import { startWatch, readWatch, clearWatch, getLastTopupEvent, type TopupWatch, type TopupEvent } from '../topup'

const DEFAULT_SERVER = 'https://zenew-api.lxlrwxs.top'
const CODE_RE = /^ZC-[A-Z0-9]{4}-[A-Z0-9]{4}$/

export default function SettingsPage() {
  const [server, setServerUrl] = useState(getServer())
  const [saved, setSaved] = useState(false)
  const [serverErr, setServerErr] = useState('')
  const [newLimit, setNewLimit] = useState(localStorage.getItem('zenew_new_limit') || '10')
  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [ver, setVer] = useState('')
  const [me, setMe] = useState<Me | null>(null)
  const [meErr, setMeErr] = useState('')
  const [code, setCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState('')
  const [redeemOk, setRedeemOk] = useState(false)
  const [watch, setWatch] = useState<TopupWatch | null>(null)
  const [topupMsg, setTopupMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)

  const loadMe = () => {
    fetchMe()
      .then((m) => {
        setMe(m)
        setMeErr('')
      })
      .catch((e) => setMeErr(e instanceof ApiError && e.status === 401 ? '登录已过期，请重新登录' : '获取余额失败'))
  }

  /** 开始充值：带 sid 打开购买页 → 本地挂监听（轮询 + 深链） */
  const goBuy = async () => {
    let baseline = me?.balance_tokens || 0
    try {
      const fresh = await fetchMe()
      setMe(fresh)
      baseline = fresh.balance_tokens || 0
    } catch {}
    const url = `https://lxlrwxs.top/zenew/buy/?sid=watch${me?.email ? `&email=${encodeURIComponent(me.email)}` : ''}`
    const w = startWatch(me?.email || '', baseline)
    setWatch(w)
    setTopupMsg(null)
    try {
      await openUrl(url)
    } catch {
      setTopupMsg({ kind: 'warn', text: '打开浏览器失败，请手动访问 lxlrwxs.top/zenew/buy/' })
    }
  }

  // 启动即静默检查一次 + 读取真实版本号（更新后能反映新二进制）+ 拉取额度
  useEffect(() => {
    if (isTauri()) getVersion().then((v) => setVer('v' + v)).catch(() => setVer('dev'))
    else setVer('dev')
    checkUpdate()
      .then((u) => {
        if (u) setUpdate({ version: u.version, notes: u.body ?? null })
      })
      .catch(() => {})
    loadMe()
    setWatch(readWatch())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 充值到账提示：订阅全局事件（监听器常驻在 App，切页也不会漏）
  useEffect(() => {
    const show = (e: TopupEvent) => {
      setWatch(null)
      if (e.kind === 'paid') {
        if (e.added && e.added > 0) {
          const wan = (e.added / 10000).toFixed(0)
          setTopupMsg({ kind: 'ok', text: `充值到账 +${wan} 万 tokens${e.balance !== undefined ? `（余额 ${(e.balance / 10000).toFixed(0)} 万）` : ''}` })
        } else {
          setTopupMsg({ kind: 'warn', text: '订单已支付，但未绑定账号额度：请到购买页领取卡密后在下方兑换' })
        }
        loadMe()
      }
    }
    const onEv = (ev: Event) => show((ev as CustomEvent<TopupEvent>).detail)
    window.addEventListener('zenew:topup', onEv)
    const pending = getLastTopupEvent()
    if (pending) show(pending)
    return () => window.removeEventListener('zenew:topup', onEv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runCheck = async () => {
    setChecking(true)
    setMsg('')
    try {
      const u = await checkUpdate()
      setUpdate(u ? { version: u.version, notes: u.body ?? null } : null)
      setMsg(u ? '' : '已是最新版本')
    } catch {
      setUpdate(null)
      setMsg('检查失败，请检查网络后重试')
    }
    setChecking(false)
  }

  const doUpdate = async () => {
    setProgress(0)
    try {
      const u = await checkUpdate()
      if (!u) {
        setProgress(null)
        setMsg('已是最新版本')
        return
      }
      await applyUpdate(u, (received, total) => {
        setProgress(total ? Math.round((received / total) * 100) : null)
      })
    } catch (e) {
      console.error(e)
      setMsg('更新下载失败，请稍后再试')
      setProgress(null)
    }
  }

  const doRedeem = async () => {
    if (redeeming) return
    const c = code.trim().toUpperCase()
    if (!c) return
    if (!CODE_RE.test(c)) {
      setRedeemOk(false)
      setRedeemMsg('卡密格式应为 ZC-XXXX-XXXX')
      return
    }
    setRedeeming(true)
    setRedeemMsg('')
    setRedeemOk(false)
    try {
      const r = await redeemCode(c)
      setRedeemOk(true)
      setRedeemMsg(`已到账 ${(r.added_tokens / 10000).toFixed(0)} 万 tokens（${r.tier} 档 ¥${r.price_cny}），当前余额 ${(r.balance_tokens / 10000).toFixed(0)} 万`)
      setCode('')
      loadMe()
    } catch (e) {
      setRedeemMsg(e instanceof ApiError ? e.message : '兑换失败，请检查网络')
    } finally {
      setRedeeming(false)
    }
  }

  const free = me ? Math.max(0, me.quota_tokens - me.used_tokens) : 0
  const freePct = me && me.quota_tokens > 0 ? Math.min(100, (me.used_tokens / me.quota_tokens) * 100) : 0
  const balance = me?.balance_tokens || 0
  const balancePct = Math.min(100, (balance / 7_800_000) * 100) // 满刻度=第 4 档 780 万

  return (
    <div className="page-in">
      <div className="kicker">SETTINGS</div>
      <div className="page-title">设置</div>

      {topupMsg && (
        <div className={`update-banner fade-up${topupMsg.kind === 'ok' ? '' : ' is-err'}`} style={{ marginTop: 22 }}>
          <div>
            <b>{topupMsg.text}</b>
            <span>{topupMsg.kind === 'ok' ? '余额已更新，无需手动刷新' : '按提示处理即可'}</span>
          </div>
          <button className="btn btn-sm" onClick={() => setTopupMsg(null)}>
            知道了
          </button>
        </div>
      )}

      {watch && !topupMsg && (
        <div className="update-banner fade-up" style={{ marginTop: 22, background: 'var(--paper-2)', borderColor: 'var(--line)' }}>
          <div>
            <b>等待付款确认…</b>
            <span>付款后由站长核对；到账后软件会自动提示（也可以点右侧按钮立即检查）</span>
          </div>
          <button className="btn btn-sm" onClick={loadMe} title="立即向服务器核对余额">
            我已支付
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              clearWatch()
              setWatch(null)
            }}
          >
            取消
          </button>
        </div>
      )}

      {update && !progress && (
        <div className="update-banner fade-up" style={{ marginTop: 22 }}>
          <div>
            <b>新版本 {update.version} 可用</b>
            <span>免安装更新：后台下载后自动替换重启</span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={doUpdate}>立即更新</button>
        </div>
      )}
      {progress !== null && (
        <div className="update-banner fade-up" style={{ marginTop: 22 }}>
          <div>
            <b>正在下载更新{progress !== null ? ` · ${progress}%` : '…'}</b>
            <span>完成后自动重启</span>
          </div>
          <div className="bar" style={{ width: 140 }}><span className="seg-gold" style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      <div style={{ marginTop: 26 }}>
        <div className="section-label">余额 / BALANCE</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>
              充值余额 {me ? `${balance.toLocaleString()} tokens` : meErr || '…'}
            </div>
            <div className="bar" style={{ width: 180, marginTop: 7 }}>
              {balance > 0 && <span className="seg-gold" style={{ width: `${balancePct}%` }} />}
            </div>
          </div>
          <span className="tag tag-mono">{me ? `免费剩 ${(free / 10000).toFixed(1)} 万` : '—'}</span>
        </div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>购买额度</div>
            <div className="row-meta" style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>
              网页支付后自动到账，或领取卡密在此兑换
            </div>
          </div>
          <button className="btn btn-sm" onClick={loadMe} title="刷新余额">
            刷新
          </button>
          <button className="btn btn-primary btn-sm" onClick={goBuy}>
            去购买
          </button>
        </div>

        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>兑换充值码</div>
            <div className="row-meta" style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>
              {redeemMsg || '输入卡密即时到账，额度不随月份清零'}
            </div>
          </div>
          <input
            className="input"
            style={{ width: 190, fontFamily: 'var(--mono)', textTransform: 'uppercase' }}
            placeholder="ZC-XXXX-XXXX"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              if (redeemOk) setRedeemOk(false) // 开始输入新码就复位「已到账」
            }}
            onKeyDown={(e) => e.key === 'Enter' && doRedeem()}
          />
          <button className="btn btn-primary btn-sm" disabled={redeeming || !code.trim()} onClick={doRedeem} style={redeemOk ? { background: 'var(--green)', borderColor: 'var(--green)' } : undefined}>
            {redeeming ? '···' : redeemOk ? '已到账' : '兑换'}
          </button>
        </div>
        <div className="row-meta" style={{ marginTop: 8, fontSize: 11 }}>
          免费额度：本月剩余 {(free / 10000).toFixed(1)} 万 / 共 {(me ? me.quota_tokens / 10000 : 20).toFixed(0)} 万（已用 {freePct.toFixed(1)}%）；用完自动走余额。
        </div>

        <div className="section-label" style={{ marginTop: 22 }}>SERVER</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>服务地址</div>
            {serverErr && <div className="row-meta" style={{ fontSize: 10.5, color: 'var(--red)' }}>{serverErr}</div>}
          </div>
          <input className="input" style={{ width: 230 }} value={server} onChange={(e) => { setServerUrl(e.target.value); setServerErr('') }} />
          <button
            className="btn btn-sm"
            onClick={() => {
              const v = server.trim()
              if (!v) {
                setServerErr('地址不能为空')
                return
              }
              if (!/^https?:\/\/[^\s]+\./i.test(v)) {
                setServerErr('需为 http(s):// 开头的完整地址')
                return
              }
              setServer(v)
              setServerUrl(getServer())
              setSaved(true)
              setServerErr('')
              setTimeout(() => setSaved(false), 1500)
              loadMe()
            }}
          >
            {saved ? '已保存' : '保存'}
          </button>
          {server !== DEFAULT_SERVER && (
            <button
              className="btn btn-sm"
              title="恢复官方网关地址"
              onClick={() => {
                setServer(DEFAULT_SERVER)
                setServerUrl(DEFAULT_SERVER)
                setServerErr('')
                setSaved(true)
                setTimeout(() => setSaved(false), 1500)
                loadMe()
              }}
            >
              恢复默认
            </button>
          )}
        </div>
        <div className="section-label" style={{ marginTop: 18 }}>SCHEDULING</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>每日新学上限</div>
            <div className="row-meta" style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>0 表示只复习旧卡，不引入新卡（上限 200）</div>
          </div>
          <input
            className="input"
            style={{ width: 80, textAlign: 'right' }}
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onBlur={() => {
              const n = Math.max(0, Math.min(200, Number(newLimit) || 0))
              setNewLimit(String(n))
              localStorage.setItem('zenew_new_limit', String(n))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </div>
        <div className="section-label" style={{ marginTop: 18 }}>UPDATES</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>检查更新</div>
            <div className="row-meta" style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>{msg || '自动检查 GitHub Releases'}</div>
          </div>
          <button className="btn btn-sm" disabled={checking || progress !== null} onClick={runCheck}>
            {checking ? '检查中…' : '检查'}
          </button>
        </div>
        <div className="section-label" style={{ marginTop: 18 }}>ABOUT</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>知新 Zenew</div>
          </div>
          <span className="tag tag-mono">{ver || '…'} · FSRS</span>
        </div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>用户协议与安全声明</div>
            <div className="row-meta" style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>
              含禁止反向工程与 AI 破解条款
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => openUrl('https://lxlrwxs.top/zenew/terms/').catch(() => {})}>
            查看
          </button>
        </div>
      </div>
    </div>
  )
}
