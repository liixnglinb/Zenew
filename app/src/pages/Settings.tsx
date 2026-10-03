// 我的：个人资料 + 学习统计 + 分组设置（学习 / 外观与显示 / 音效 / 数据与账号）
// 说明：只保留学习与本地数据相关的能力。
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  BookOpen,
  CalendarDays,
  Database,
  GraduationCap,
  Languages,
  LogOut,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  Trophy,
  Zap,
} from 'lucide-react'
import { getServer, setServer, fetchMe, ApiError, type Me } from '../api'
import { checkUpdate, applyUpdate, type UpdateInfo } from '../updater'
import { getDb, isTauri, localDayKey } from '../db'
import { applySettings, getSettings, loadStreak, saveSettings, type LocalSettings } from '../study'
import { LANGS, setLang, useI18n } from '../lib/i18n'
import { formatNumber, maskEmail } from '../lib/format'
import {
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  Segmented,
  Switch,
  Tag,
  useSubmit,
  useToast,
  useTheme,
} from '../ui'

const DEFAULT_SERVER = 'https://zenew-api.lxlrwxs.top'

export default function SettingsPage() {
  const nav = useNavigate()
  const toast = useToast()
  const { mode, resolved, setMode } = useTheme()
  const { lang } = useI18n()
  const [busyUpdate, runUpdate] = useSubmit()
  const [busyLogout, runLogout] = useSubmit()

  const [server, setServerUrl] = useState(getServer())
  const [serverErr, setServerErr] = useState('')
  const [newLimit, setNewLimit] = useState(localStorage.getItem('zenew_new_limit') || '10')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [updateMsg, setUpdateMsg] = useState('')
  const [ver, setVer] = useState('')
  const [me, setMe] = useState<Me | null>(null)
  const [meErr, setMeErr] = useState('')
  const [st, setSt] = useState<LocalSettings>(getSettings())
  const [counts, setCounts] = useState<{ courses: number; topics: number; cards: number; logs: number } | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsErr, setStatsErr] = useState('')
  const [streak, setStreak] = useState(0)
  const [learned, setLearned] = useState(0)
  const [mastered, setMastered] = useState(0)
  const [confirmLogout, setConfirmLogout] = useState(false)

  const patch = (p: Partial<LocalSettings>) => {
    const next = saveSettings(p)
    setSt(next)
    applySettings(next)
    toast.success('设置已保存')
  }

  const loadLocalStats = async () => {
    setStatsLoading(true)
    setStatsErr('')
    try {
      const db = await getDb()
      const n = async (sql: string) => {
        const r = await db.select<{ n: number }[]>(sql)
        return Number(r[0]?.n || 0)
      }
      const [courses, topics, cards, logs, learnedN, masteredN, streakN] = await Promise.all([
        n('SELECT COUNT(*) AS n FROM course'),
        n('SELECT COUNT(*) AS n FROM topic WHERE parent_id IS NOT NULL'),
        n('SELECT COUNT(*) AS n FROM card'),
        n('SELECT COUNT(*) AS n FROM review_log'),
        n('SELECT COUNT(*) AS n FROM card_state WHERE state!=0'),
        n('SELECT COUNT(*) AS n FROM card_state WHERE state=2 AND stability>=21'),
        loadStreak(),
      ])
      setCounts({ courses, topics, cards, logs })
      setLearned(learnedN)
      setMastered(masteredN)
      setStreak(streakN)
    } catch (e) {
      setStatsErr(e instanceof Error ? e.message : '本地数据读取失败')
    } finally {
      setStatsLoading(false)
    }
  }

  useEffect(() => {
    if (isTauri()) getVersion().then((v) => setVer('v' + v)).catch(() => setVer('dev'))
    else setVer('dev')
    checkUpdate()
      .then((u) => {
        if (u) setUpdate({ version: u.version, notes: u.body ?? null })
      })
      .catch(() => {})
    fetchMe()
      .then((m) => {
        setMe(m)
        setMeErr('')
      })
      .catch((e) => setMeErr(e instanceof ApiError && e.status === 401 ? '登录已过期，请重新登录' : '账号信息暂时不可用'))
    void loadLocalStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doUpdate = () =>
    runUpdate(async () => {
      setProgress(0)
      try {
        const u = await checkUpdate()
        if (!u) {
          setProgress(null)
          setUpdateMsg('当前已是最新版本')
          toast.info('当前已是最新版本')
          return
        }
        await applyUpdate(u, (received, total) => {
          setProgress(total ? Math.round((received / total) * 100) : null)
        })
      } catch {
        setUpdateMsg('更新下载失败，请检查网络后重试')
        setProgress(null)
        toast.error('更新下载失败，请检查网络后重试')
      }
    })

  const saveServer = () => {
    const v = server.trim()
    if (!v) {
      setServerErr('服务地址不能为空')
      return
    }
    if (!/^https?:\/\/[^\s]+\./i.test(v)) {
      setServerErr('需要以 http(s):// 开头的完整地址')
      return
    }
    setServer(v)
    setServerUrl(getServer())
    setServerErr('')
    toast.success('服务地址已保存')
  }

  return (
    <div className="page-in">
      <PageHeader title="我的" kicker="PROFILE / SETTINGS" />

      {/* 个人资料 */}
      <Card className="fade-up">
        <div className="profile-head" style={{ marginBottom: 0 }}>
          <Avatar seed={me?.email || '知新'} size="lg" name="账号头像" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="profile-name truncate">{me?.email?.split('@')[0] || '知新用户'}</div>
            <div className="profile-id">
              <span title="邮箱已脱敏显示">{maskEmail(me?.email)}</span>
              <Tag tone={streak > 0 ? 'success' : 'neutral'} icon={<Zap size={11} />}>
                {streak > 0 ? `连续 ${streak} 天` : '今天还没学'}
              </Tag>
            </div>
          </div>
          <IconButton label="刷新本地统计" onClick={() => void loadLocalStats()}>
            <RefreshCw size={16} />
          </IconButton>
        </div>
      </Card>

      {/* 三卡统计 */}
      {statsLoading ? (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <LoadingState rows={2} title="正在统计学习数据" />
        </div>
      ) : statsErr ? (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <ErrorState title="本地统计读取失败" desc={statsErr} onRetry={() => void loadLocalStats()} />
        </div>
      ) : (
        <div className="stat-trio" style={{ marginTop: 'var(--sp-3)' }}>
          <div className="stat-card">
            <span className="stat-ico" aria-hidden style={{ color: 'var(--brand)' }}>
              <Zap size={22} />
            </span>
            <b className="tnum">
              {formatNumber(streak)}
              <small>天</small>
            </b>
            <span>连续学习</span>
          </div>
          <div className="stat-card">
            <span className="stat-ico" aria-hidden style={{ color: 'var(--success-500)' }}>
              <BookOpen size={22} />
            </span>
            <b className="tnum">{formatNumber(learned)}</b>
            <span>累计学习</span>
          </div>
          <div className="stat-card">
            <span className="stat-ico" aria-hidden style={{ color: 'var(--warning-500)' }}>
              <Trophy size={22} />
            </span>
            <b className="tnum">{formatNumber(mastered)}</b>
            <span>已熟识</span>
          </div>
        </div>
      )}

      {/* 更新提示 */}
      {(update || progress !== null || updateMsg) && (
        <div className="update-banner fade-up" style={{ marginTop: 'var(--sp-4)' }}>
          <div>
            <b>{progress !== null ? `正在下载更新 ${progress}%` : update ? `新版本 ${update.version} 可用` : updateMsg}</b>
            <span>{progress !== null ? '下载完成后自动重启，无需手动安装' : update ? '后台下载后自动替换重启' : '可以稍后再试'}</span>
          </div>
          {update && progress === null && (
            <Button variant="primary" size="sm" loading={busyUpdate} onClick={doUpdate}>
              立即更新
            </Button>
          )}
        </div>
      )}

      {/* 学习 */}
      <div className="section-label" style={{ marginTop: 'var(--sp-5)' }}>
        学习
      </div>
      <div className="group">
        <button className="group-row is-link" onClick={() => nav('/vocab')}>
          <BookOpen size={17} aria-hidden />
          <div className="group-row-main">
            <div className="group-row-title">我的词书</div>
            <div className="group-row-sub">四本内置词书与生词本，导入即学</div>
          </div>
          <span className="group-row-value">›</span>
        </button>
        <button className="group-row is-link" onClick={() => nav('/courses')}>
          <GraduationCap size={17} aria-hidden />
          <div className="group-row-main">
            <div className="group-row-title">我的课程</div>
            <div className="group-row-sub">
              {counts
                ? `${formatNumber(counts.courses)} 门课程 · ${formatNumber(counts.topics)} 个知识点 · ${formatNumber(counts.cards)} 张卡`
                : '教材导入 / 生成大纲'}
            </div>
          </div>
          <span className="group-row-value">›</span>
        </button>
        <button className="group-row is-link" onClick={() => nav('/exams')}>
          <CalendarDays size={17} aria-hidden />
          <div className="group-row-main">
            <div className="group-row-title">考试日历</div>
            <div className="group-row-sub">按考试日期倒推每日新学量</div>
          </div>
          <span className="group-row-value">›</span>
        </button>
        <div className="group-row">
          <div className="group-row-main">
            <div className="group-row-title">每日新学上限</div>
            <div className="group-row-sub">0 表示只复习旧卡；上限 200（词书内可在「调整计划」按组设置）</div>
          </div>
          <input
            className="input tnum"
            style={{ width: 84, textAlign: 'end' }}
            inputMode="numeric"
            aria-label="每日新学上限"
            value={newLimit}
            onChange={(e) => setNewLimit(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onBlur={() => {
              const n = Math.max(0, Math.min(200, Number(newLimit) || 0))
              setNewLimit(String(n))
              localStorage.setItem('zenew_new_limit', String(n))
              toast.success(`每日新学上限已设为 ${n} 张`)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </div>
      </div>

      {/* 外观与显示 */}
      <div className="section-label" style={{ marginTop: 'var(--sp-5)' }}>
        外观与显示
      </div>
      <div className="group">
        <div className="group-row">
          <Sun size={17} aria-hidden />
          <div className="group-row-main">
            <div className="group-row-title">主题</div>
            <div className="group-row-sub">当前：{resolved === 'dark' ? '深色' : '浅色'}（{mode === 'system' ? '跟随系统' : '手动指定'}）</div>
          </div>
          <Segmented
            ariaLabel="主题模式"
            value={mode}
            onChange={(v) => setMode(v)}
            options={[
              { value: 'system', label: '系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
          />
        </div>
        <div className="group-row">
          <div className="group-row-main">
            <div className="group-row-title">字号</div>
            <div className="group-row-sub">界面文字大小，放大后布局自动重排</div>
          </div>
          <Segmented
            ariaLabel="界面字号"
            value={String(st.scale)}
            onChange={(v) => patch({ scale: Number(v) })}
            options={[
              { value: '0.92', label: '小' },
              { value: '1', label: '标准' },
              { value: '1.08', label: '大' },
              { value: '1.16', label: '特大' },
            ]}
          />
        </div>
        <div className="group-row">
          <div className="group-row-main">
            <div className="group-row-title">长辈版</div>
            <div className="group-row-sub">更大字号与更宽松的排版</div>
          </div>
          <Switch checked={st.elder} onChange={(v) => patch({ elder: v })} label="长辈版" />
        </div>
        <div className="group-row">
          <Languages size={17} aria-hidden />
          <div className="group-row-main">
            <div className="group-row-title">界面语言</div>
            <div className="group-row-sub">当前：{LANGS.find((l) => l.value === lang)?.label || '简体中文'}</div>
          </div>
          <Segmented
            ariaLabel="界面语言"
            value={lang}
            onChange={(v) => {
              setLang(v)
              toast.success('界面语言已切换')
            }}
            options={LANGS.map((l) => ({ value: l.value, label: l.label }))}
          />
        </div>
      </div>

      {/* 音效与提醒 */}
      <div className="section-label" style={{ marginTop: 'var(--sp-5)' }}>
        音效与提醒
      </div>
      <div className="group">
        <div className="group-row">
          <div className="group-row-main">
            <div className="group-row-title">音效</div>
            <div className="group-row-sub">答对 / 答错 / 斩词的提示音</div>
          </div>
          <Switch checked={st.sound} onChange={(v) => patch({ sound: v })} label="音效" />
        </div>
        <div className="group-row">
          <div className="group-row-main">
            <div className="group-row-title">震动</div>
            <div className="group-row-sub">移动端作答反馈（桌面端无效果）</div>
          </div>
          <Switch checked={st.haptic} onChange={(v) => patch({ haptic: v })} label="震动" />
        </div>
        <div className="group-row">
          <div className="group-row-main">
            <div className="group-row-title">学习提醒</div>
            <div className="group-row-sub">开启后每天首次进入「单词」页会提示待复习数量</div>
          </div>
          <Switch
            checked={st.remind}
            onChange={(v) => {
              patch({ remind: v })
              if (v) {
                try {
                  void Notification?.requestPermission?.()
                } catch {
                  /* 系统不支持通知时忽略 */
                }
              }
            }}
            label="学习提醒"
          />
        </div>
      </div>

      {/* 数据与账号 */}
      <div className="section-label" style={{ marginTop: 'var(--sp-5)' }}>
        数据与账号
      </div>
      <div className="group">
        <div className="group-row">
          <Database size={17} aria-hidden />
          <div className="group-row-main">
            <div className="group-row-title">本地数据</div>
            <div className="group-row-sub">
              {counts
                ? `${formatNumber(counts.cards)} 张卡 · ${formatNumber(counts.logs)} 条复习记录 · 统计日期 ${localDayKey()}`
                : '本地 SQLite 存储，不联网也可学习'}
            </div>
          </div>
          <Tag tone="success" icon={<ShieldCheck size={11} />} mono>
            {ver || '…'}
          </Tag>
        </div>
        <div className="group-row">
          <div className="group-row-main">
            <div className="group-row-title">账号</div>
            <div className="group-row-sub" title="出于隐私保护，邮箱已脱敏">
              {maskEmail(me?.email)} <span className="text-3">（邮箱已脱敏）</span>
              {meErr && <span style={{ color: 'var(--danger-ink)' }}> · {meErr}</span>}
            </div>
          </div>
        </div>
        <div className="group-row">
          <Server size={17} aria-hidden />
          <div className="group-row-main">
            <div className="group-row-title">服务地址</div>
            <div className="group-row-sub">{serverErr || '生成类请求经此网关，客户端不保存任何密钥'}</div>
          </div>
          <input
            className="input"
            style={{ width: 200 }}
            aria-label="服务地址"
            aria-invalid={serverErr ? true : undefined}
            value={server}
            onChange={(e) => {
              setServerUrl(e.target.value)
              setServerErr('')
            }}
          />
          <Button size="sm" variant="outline" onClick={saveServer}>
            保存
          </Button>
          {server !== DEFAULT_SERVER && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setServer(DEFAULT_SERVER)
                setServerUrl(DEFAULT_SERVER)
                setServerErr('')
                toast.success('已恢复默认地址')
              }}
            >
              恢复默认
            </Button>
          )}
        </div>
        <button className="group-row is-link" onClick={doUpdate} disabled={busyUpdate}>
          <RefreshCw size={17} aria-hidden />
          <div className="group-row-main">
            <div className="group-row-title">检查更新</div>
            <div className="group-row-sub">{busyUpdate ? '正在检查…' : '自动检查新版本，安装后自动重启'}</div>
          </div>
          <span className="group-row-value">›</span>
        </button>
        <button
          className="group-row is-link"
          onClick={() => openUrl('https://lxlrwxs.top/zenew/terms/').catch(() => toast.error('打开链接失败'))}
        >
          <ShieldCheck size={17} aria-hidden />
          <div className="group-row-main">
            <div className="group-row-title">用户协议与安全声明</div>
            <div className="group-row-sub">含禁止反向工程与破解条款</div>
          </div>
          <span className="group-row-value">›</span>
        </button>
      </div>

      <div style={{ marginTop: 'var(--sp-5)' }}>
        <Button variant="danger" block icon={<LogOut size={15} />} onClick={() => setConfirmLogout(true)}>
          退出登录
        </Button>
      </div>

      <p className="today-hint fade-up">
        <span className="dot" aria-hidden />
        知新 Zenew · 把课程变成科学调度的练习系统（学习数据全部保存在本机）
      </p>

      <ConfirmDialog
        open={confirmLogout}
        danger
        title="退出登录？"
        description="退出后本地学习记录仍会保留，下次登录可继续；云端生成功能需要重新登录。"
        confirmText="确认退出"
        loading={busyLogout}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() =>
          runLogout(async () => {
            localStorage.removeItem('zenew_token')
            window.location.hash = '#/login'
            window.location.reload()
          })
        }
      />
    </div>
  )
}
