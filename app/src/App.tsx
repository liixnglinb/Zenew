import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  Flame,
  Home,
  Info,
  Keyboard,
  Languages,
  ListChecks,
  Moon,
  Search,
  Settings,
  Sun,
  Swords,
  Trophy,
  User,
  Zap,
} from 'lucide-react'
import { ApiError, fetchMe, getToken, setToken, type Me } from './api'
import { isTauri, ensureSchema } from './db'
import { todayActivity, applySettings, getSettings, loadStreak } from './study'
import { LANGS, applyDirection, getLang, setLang } from './lib/i18n'
import { formatNumber } from './lib/format'
import {
  Button,
  Drawer,
  ErrorBoundary,
  IconButton,
  NetBanner,
  Segmented,
  ThemeProvider,
  ToastProvider,
  useOnline,
  useTheme,
} from './ui'
import TitleBar from './components/TitleBar'
import SideNav from './ui/sidebar'
import {
  ShortcutHelp,
  getLastRoute,
  loadNavCollapsed,
  saveNavCollapsed,
  useHotkeys,
  useLastRoute,
  useWindowState,
} from './ui/desktop'
import Login from './pages/Login'
import Today from './pages/Today'
import ReviewSession from './pages/ReviewSession'
import Stats from './pages/Stats'
import SettingsPage from './pages/Settings'
import Vocab from './pages/Vocab'
import VocabStudy from './pages/VocabStudy'
import Dict from './pages/Dict'
import Plan from './pages/Plan'
import Tasks from './pages/Tasks'
import Rank from './pages/Rank'

/** 一级导航已由左侧固定侧栏承担（见 ui/sidebar.tsx 的 NAV_ITEMS） */

/** 二级导航（抽屉）：功能入口的完整清单 */
const DRAWER_ITEMS = [
  { to: '/today', label: '单词（词云首页）', icon: Home },
  { to: '/vocab', label: '词库与词书', icon: BookOpen },
  { to: '/review', label: '训练场（开始复习）', icon: Swords },
  { to: '/dict', label: '查词（14,625 词）', icon: Search },
  { to: '/stats', label: '复习统计', icon: BarChart3 },
  { to: '/tasks', label: '每日任务', icon: ListChecks },
  { to: '/rank', label: '学习排行榜', icon: Trophy },
  { to: '/settings', label: '我的与设置', icon: Settings },
]

function Shell({ meEmail }: { meEmail: string }) {
  const nav = useNavigate()
  const location = useLocation()
  const { resolved, mode, setMode, toggle } = useTheme()
  const online = useOnline()
  const [drawer, setDrawer] = useState(false)
  const [streak, setStreak] = useState(0)
  const [points, setPoints] = useState(0)
  const [lang, setLangState] = useState(getLang())
  const [navCollapsed, setNavCollapsed] = useState(loadNavCollapsed())
  const [helpOpen, setHelpOpen] = useState(false)

  // 沉浸页（学习会话）隐藏顶栏与侧栏
  const immersive = location.pathname.startsWith('/review') || /^\/vocab\/[^/]+$/.test(location.pathname)

  // 桌面能力：窗口尺寸/位置/最大化记忆 + 记住上次停留页面
  useWindowState()
  useLastRoute()

  // 全键盘操作（桌面软件的基本素养）
  const hotkeys = useMemo(
    () => ({
      'ctrl+1': () => nav('/today'),
      'ctrl+2': () => nav('/review'),
      'ctrl+3': () => nav('/vocab'),
      'ctrl+4': () => nav('/dict'),
      'ctrl+5': () => nav('/stats'),
      'ctrl+6': () => nav('/tasks'),
      'ctrl+7': () => nav('/rank'),
      'ctrl+8': () => nav('/settings'),
      'ctrl+k': () => nav('/dict'),
      'ctrl+b': () =>
        setNavCollapsed((v) => {
          saveNavCollapsed(!v)
          return !v
        }),
      'ctrl+/': () => setHelpOpen((v) => !v),
      escape: () => {
        if (helpOpen) {
          setHelpOpen(false)
          return
        }
        if (window.history.length > 1) nav(-1)
      },
    }),
    [nav, helpOpen]
  )
  useHotkeys(hotkeys)

  const refreshBadges = useCallback(() => {
    loadStreak().then(setStreak).catch(() => {})
    todayActivity()
      .then((a) => setPoints(a.points))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (immersive) return
    refreshBadges()
    setDrawer(false)
  }, [immersive, location.pathname, refreshBadges])

  useEffect(() => {
    applyDirection(lang)
  }, [lang])

  return (
    <div className="app">
      <a className="sr-only" href="#main-content">
        跳到主要内容
      </a>
      <div className="cloud" style={{ width: 520, height: 520, top: -180, right: -120 }} aria-hidden />
      <div className="cloud" style={{ width: 420, height: 420, bottom: -160, left: -100, animationDelay: '8s' }} aria-hidden />
      <TitleBar />

      <div className={`shell${navCollapsed ? ' is-collapsed' : ''}${immersive ? ' is-immersive' : ''}`}>
        {!immersive && (
          <SideNav
            collapsed={navCollapsed}
            onToggleCollapse={() =>
              setNavCollapsed((v) => {
                saveNavCollapsed(!v)
                return !v
              })
            }
            streak={streak}
            points={points}
          />
        )}

        <div className="shell-main">
          {!immersive && (
            <header className="appbar">
              <div className="appbar-user">
                <button
                  className="avatar is-md"
                  style={{ background: 'linear-gradient(140deg, var(--brand), var(--brand-300))' }}
                  aria-label="打开导航菜单"
                  onClick={() => setDrawer(true)}
                >
                  {(meEmail[0] || '知').toUpperCase()}
                </button>
                <span className="pill pill-streak" data-tip={`连续学习 ${streak} 天`}>
                  <Flame size={14} aria-hidden /> {streak} 天
                </span>
                <button className="pill pill-points" data-tip="今日学习得分" onClick={() => nav('/tasks')}>
                  <Zap size={14} aria-hidden /> {formatNumber(points)}
                </button>
              </div>
              <div className="appbar-spacer" />
              <div className="appbar-icons">
                <IconButton label="查词（Ctrl+K）" onClick={() => nav('/dict')}>
                  <Search size={17} />
                </IconButton>
                <IconButton label="复习统计（Ctrl+5）" onClick={() => nav('/stats')}>
                  <BarChart3 size={17} />
                </IconButton>
                <IconButton label="每日任务（Ctrl+6）" onClick={() => nav('/tasks')}>
                  <ListChecks size={17} />
                </IconButton>
                <IconButton label="学习排行榜（Ctrl+7）" onClick={() => nav('/rank')}>
                  <Trophy size={17} />
                </IconButton>
                <span className="appbar-sep" aria-hidden />
                <IconButton label="键盘快捷键（Ctrl+/）" onClick={() => setHelpOpen(true)}>
                  <Keyboard size={17} />
                </IconButton>
                <IconButton label={resolved === 'dark' ? '切换到浅色主题' : '切换到深色主题'} onClick={toggle}>
                  {resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
                </IconButton>
                <IconButton label="设置（Ctrl+8）" onClick={() => nav('/settings')}>
                  <Settings size={17} />
                </IconButton>
              </div>
            </header>
          )}

          <main className="appbody" id="main-content" tabIndex={-1}>
            <div className={`appinner${immersive ? ' appinner-narrow' : ''}`}>
              {!immersive && <NetBanner online={online} onRetry={() => window.location.reload()} />}
              <ErrorBoundary onReset={() => nav('/today')}>
                <Routes>
                  <Route path="/" element={<Navigate to={getLastRoute() ?? '/today'} replace />} />
                  <Route path="/today" element={<Today />} />
                  <Route path="/vocab" element={<Vocab />} />
                  <Route path="/vocab/:key" element={<VocabStudy />} />
                  <Route path="/plan/:key" element={<Plan />} />
                  <Route path="/dict" element={<Dict />} />
                  <Route path="/review" element={<ReviewSession />} />
                  <Route path="/stats" element={<Stats />} />
                  <Route path="/tasks" element={<Tasks />} />
                  <Route path="/rank" element={<Rank />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/today" replace />} />
                </Routes>
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>

      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      <Drawer open={drawer} onClose={() => setDrawer(false)} side="left" title="知新 Zenew">
        <nav aria-label="功能导航" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          {DRAWER_ITEMS.map((it) => {
            const Icon = it.icon
            const active = location.pathname === it.to
            return (
              <button
                key={it.to}
                className="drawer-item"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  setDrawer(false)
                  nav(it.to)
                }}
              >
                <Icon size={17} aria-hidden />
                {it.label}
              </button>
            )
          })}
        </nav>
        <div className="drawer-divider" />
        <div className="drawer-item" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: 'var(--sp-2)' }}>
          <span className="inline text-2" style={{ fontSize: 'var(--fs-sm)' }}>
            <Moon size={14} aria-hidden /> 外观
          </span>
          <Segmented
            ariaLabel="主题模式"
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
          />
        </div>
        <div className="drawer-item" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: 'var(--sp-2)' }}>
          <span className="inline text-2" style={{ fontSize: 'var(--fs-sm)' }}>
            <Languages size={14} aria-hidden /> 语言
          </span>
          <Segmented
            ariaLabel="界面语言"
            value={lang}
            onChange={(v) => {
              setLang(v)
              setLangState(v)
            }}
            options={LANGS.map((l) => ({ value: l.value, label: l.label }))}
          />
        </div>
        <div className="drawer-divider" />
        <div className="drawer-item" style={{ cursor: 'default', gap: 'var(--sp-2)' }}>
          <Info size={15} aria-hidden />
          <span className="row-meta">本地优先 · 数据存在本机</span>
        </div>
        <div style={{ marginTop: 'auto', paddingTop: 'var(--sp-4)' }}>
          <Button variant="ghost" block icon={<User size={15} />} onClick={() => { setDrawer(false); nav('/settings') }}>
            我的与设置
          </Button>
        </div>
      </Drawer>
    </div>
  )
}

function AuthGate() {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    applySettings(getSettings())
    applyDirection(getLang())
  }, [])

  useEffect(() => {
    ;(async () => {
      if (isTauri()) {
        try {
          await ensureSchema()
        } catch (e) {
          console.error('数据库初始化失败', e)
        }
      }
      if (getToken()) {
        try {
          setMe(await fetchMe())
          setOffline(false)
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) setToken(null)
          else setOffline(true) // 服务器不可达：允许离线使用本地内容
        }
      }
      setReady(true)
    })()
    const onUnauthorized = () => setMe(null)
    window.addEventListener('zenew:unauthorized', onUnauthorized)
    return () => window.removeEventListener('zenew:unauthorized', onUnauthorized)
  }, [])

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <div className="state-view" role="status" aria-live="polite">
          <span className="state-art" aria-hidden>
            <Flame size={28} />
          </span>
          <div className="state-title">正在准备本地学习数据…</div>
          <div className="state-desc">首次启动会初始化词书与卡片的本地库</div>
        </div>
      </div>
    )
  }
  if (!me) return <Login onLogin={(m) => setMe({ email: m.email })} />
  void offline
  return <Shell meEmail={me.email} />
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <HashRouter>
          <AuthGate />
        </HashRouter>
      </ToastProvider>
    </ThemeProvider>
  )
}
