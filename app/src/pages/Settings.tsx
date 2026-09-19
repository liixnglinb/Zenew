import { useState, useEffect } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { getServer, setServer, fetchMe, redeemCode, ApiError, type Me } from '../api'
import { checkUpdate, applyUpdate, type UpdateInfo } from '../updater'
import { isTauri } from '../db'

export default function SettingsPage() {
  const [server, setServerUrl] = useState(getServer())
  const [saved, setSaved] = useState(false)
  const [newLimit, setNewLimit] = useState(localStorage.getItem('zenew_new_limit') || '10')
  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const [ver, setVer] = useState('')
  const [me, setMe] = useState<Me | null>(null)
  const [code, setCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [redeemMsg, setRedeemMsg] = useState('')
  const [redeemOk, setRedeemOk] = useState(false)

  // 启动即静默检查一次 + 读取真实版本号（更新后能反映新二进制）+ 拉取额度
  useEffect(() => {
    if (isTauri()) getVersion().then((v) => setVer('v' + v)).catch(() => setVer('dev'))
    else setVer('dev')
    checkUpdate().then((u) => {
      if (u) setUpdate({ version: u.version, notes: u.body ?? null })
    })
    fetchMe().then(setMe).catch(() => {})
  }, [])

  const runCheck = async () => {
    setChecking(true)
    setMsg('')
    const u = await checkUpdate()
    setUpdate(u ? { version: u.version, notes: u.body ?? null } : null)
    setMsg(u ? '' : '已是最新版本')
    setChecking(false)
  }

  const doUpdate = async () => {
    const u = await checkUpdate()
    if (!u) return
    setProgress(0)
    try {
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
    const c = code.trim().toUpperCase()
    if (!c) return
    setRedeeming(true)
    setRedeemMsg('')
    setRedeemOk(false)
    try {
      const r = await redeemCode(c)
      setRedeemOk(true)
      setRedeemMsg(`已到账 ${(r.added_tokens / 10000).toFixed(0)} 万 tokens（${r.tier} 档 ¥${r.price_cny}），当前余额 ${(r.balance_tokens / 10000).toFixed(0)} 万`)
      setCode('')
      fetchMe().then(setMe).catch(() => {})
    } catch (e) {
      setRedeemMsg(e instanceof ApiError ? e.message : '兑换失败，请检查网络')
    } finally {
      setRedeeming(false)
    }
  }

  const free = me ? Math.max(0, me.quota_tokens - me.used_tokens) : 0
  const freePct = me ? Math.min(100, (me.used_tokens / me.quota_tokens) * 100) : 0

  return (
    <div className="page-in">
      <div className="kicker">SETTINGS</div>
      <div className="page-title">设置</div>

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
              充值余额 {me ? `${(me.balance_tokens || 0).toLocaleString()} tokens` : '…'}
            </div>
            <div className="bar" style={{ width: 180, marginTop: 7 }}>
              <span className="seg-gold" style={{ width: `${me && me.balance_tokens ? Math.min(100, (me.balance_tokens / 3_700_000) * 100) : 0}%` }} />
            </div>
          </div>
          <span className="tag tag-mono">{me ? `免费剩 ${(free / 10000).toFixed(1)} 万` : '—'}</span>
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
            onChange={(e) => setCode(e.target.value.toUpperCase())}
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
          </div>
          <input className="input" style={{ width: 230 }} value={server} onChange={(e) => setServerUrl(e.target.value)} />
          <button
            className="btn btn-sm"
            onClick={() => {
              setServer(server)
              setSaved(true)
              setTimeout(() => setSaved(false), 1500)
            }}
          >
            {saved ? '已保存' : '保存'}
          </button>
        </div>
        <div className="section-label" style={{ marginTop: 18 }}>SCHEDULING</div>
        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <div className="row-title" style={{ fontWeight: 500, fontSize: 13.5 }}>每日新学上限</div>
          </div>
          <input
            className="input"
            style={{ width: 80, textAlign: 'right' }}
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value.replace(/\D/g, ''))}
            onBlur={() => localStorage.setItem('zenew_new_limit', newLimit || '10')}
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
      </div>
    </div>
  )
}
