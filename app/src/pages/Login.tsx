import { useState } from 'react'
import { ApiError, login, register, getServer, setServer } from '../api'

export default function Login({ onLogin }: { onLogin: (me: { email: string }) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [server, setServerUrl] = useState(getServer())
  const [showServer, setShowServer] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setErr('')
    setBusy(true)
    try {
      setServer(server)
      const fn = mode === 'login' ? login : register
      const r = await fn(email.trim(), password)
      localStorage.setItem('zenew_token', r.token)
      onLogin({ email: r.email })
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : '无法连接服务器，请检查设置中的服务地址')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-box">
        <div className="auth-brand">知新</div>
        <div className="auth-sub">温故而知新。把课程变成科学的练习系统。</div>
        <div className="card">
          <div style={{ marginBottom: 12 }}>
            <input className="input" placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <input
              className="input"
              type="password"
              placeholder={mode === 'register' ? '设置密码（至少 8 位）' : '密码'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          {err && <div className="error-text">{err}</div>}
          <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 14 }} disabled={busy || !email || !password} onClick={submit}>
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
          <div className="auth-alt">
            {mode === 'login' ? (
              <>没有账号？<button onClick={() => setMode('register')}>注册</button></>
            ) : (
              <>已有账号？<button onClick={() => setMode('login')}>登录</button></>
            )}
            <span style={{ margin: '0 6px', color: 'var(--ink-3)' }}>·</span>
            <button onClick={() => setShowServer(!showServer)}>服务设置</button>
          </div>
          {showServer && (
            <div style={{ marginTop: 12 }}>
              <input className="input" value={server} onChange={(e) => setServerUrl(e.target.value)} placeholder="http://127.0.0.1:8765" />
              <div className="muted" style={{ marginTop: 5 }}>学习数据保存在本机；生成服务经云端网关。</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
