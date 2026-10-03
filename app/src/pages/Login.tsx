import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { ApiError, login, register, getServer, setServer } from '../api'
import { Button, Card, Field, Input, Segmented, useSubmit, useToast } from '../ui'

export default function Login({ onLogin }: { onLogin: (me: { email: string }) => void }) {
  const toast = useToast()
  const [busy, run] = useSubmit()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [server, setServerUrl] = useState(getServer())
  const [showServer, setShowServer] = useState(false)
  const [err, setErr] = useState('')

  const emailErr = email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? '邮箱格式看起来不太对，请检查后重试' : ''
  const pwdErr = password && mode === 'register' && password.length < 8 ? '密码至少 8 位' : ''
  const canSubmit = !!email.trim() && !!password && (mode === 'login' || !!invite.trim()) && !emailErr && !pwdErr

  const submit = () =>
    run(async () => {
      setErr('')
      try {
        setServer(server)
        const fn = mode === 'login' ? login : register
        const r = await fn(email.trim(), password, invite.trim())
        localStorage.setItem('zenew_token', r.token)
        toast.success(mode === 'login' ? '登录成功' : '注册成功，已登录')
        onLogin({ email: r.email })
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : '无法连接服务器，请检查网络或服务地址'
        setErr(msg)
        toast.error(msg)
      }
    })

  return (
    <div className="auth-wrap">
      <div data-tauri-drag-region className="auth-drag" />
      <div className="cloud" style={{ width: 520, height: 520, top: -160, right: -100 }} aria-hidden />
      <div className="cloud" style={{ width: 420, height: 420, bottom: -180, left: -120, animationDelay: '7s' }} aria-hidden />
      <div className="auth-box page-in">
        <div className="inline" style={{ gap: 'var(--sp-4)', marginBottom: 'var(--sp-3)' }}>
          <span
            aria-hidden
            style={{
              width: 54,
              height: 54,
              borderRadius: 'var(--r-card)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(140deg, var(--brand), var(--brand-300))',
              color: '#fff',
              fontSize: 'var(--fs-2xl)',
              fontWeight: 'var(--fw-black)',
              boxShadow: 'var(--shadow-brand)',
            }}
          >
            知
          </span>
          <div>
            <h1 className="auth-brand" style={{ fontSize: 'var(--fs-3xl)', marginBottom: 0 }}>
              知新<sup>®</sup>
            </h1>
            <div className="mono" style={{ fontSize: 'var(--fs-2xs)', color: 'var(--ink-3)', letterSpacing: 1 }}>
              ZENEW · SKY
            </div>
          </div>
        </div>
        <p className="auth-sub">
          <Sparkles size={12} aria-hidden /> 把课程变成科学调度的练习系统
        </p>

        <Card>
          <div className="kicker">{mode === 'login' ? 'SIGN IN' : 'REGISTER'}</div>

          <Segmented
            ariaLabel="登录或注册"
            value={mode}
            onChange={(v) => {
              setMode(v)
              setErr('')
            }}
            options={[
              { value: 'login', label: '登录' },
              { value: 'register', label: '注册' },
            ]}
          />

          <div className="stack" style={{ marginTop: 'var(--sp-4)' }}>
            <Input
              label="邮箱"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              error={emailErr}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="密码"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'register' ? '设置密码（至少 8 位）' : '输入密码'}
              value={password}
              error={pwdErr}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()}
            />
            {mode === 'register' && (
              <Input
                label="邀请码"
                hint="注册需要邀请码"
                placeholder="例如 ABCD-1234"
                value={invite}
                onChange={(e) => setInvite(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()}
              />
            )}
          </div>

          {err && (
            <p className="error-text" role="alert">
              {err}
            </p>
          )}

          <Button
            variant="primary"
            size="lg"
            block
            loading={busy}
            disabled={!canSubmit}
            style={{ marginTop: 'var(--sp-4)' }}
            onClick={submit}
          >
            {mode === 'login' ? '登录' : '注册并登录'}
          </Button>

          <div className="auth-alt">
            {mode === 'login' ? (
              <>
                没有账号？
                <button onClick={() => setMode('register')}>去注册</button>
              </>
            ) : (
              <>
                已有账号？
                <button onClick={() => setMode('login')}>去登录</button>
              </>
            )}
            <span style={{ margin: '0 var(--sp-2)', color: 'var(--ink-3)' }}>·</span>
            <button onClick={() => setShowServer(!showServer)} aria-expanded={showServer}>
              服务地址设置
            </button>
          </div>

          {showServer && (
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <Field label="服务地址" hint="生成类请求经此网关；客户端不保存任何密钥">
                <Input value={server} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://zenew-api.lxlrwxs.top" />
              </Field>
            </div>
          )}
        </Card>

        <p className="row-meta" style={{ marginTop: 'var(--sp-4)', textAlign: 'center' }}>
          学习数据全部保存在本机；登录仅用于云端生成功能。
        </p>
      </div>
    </div>
  )
}
