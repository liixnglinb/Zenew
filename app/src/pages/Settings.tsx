// 我的：学习统计 + 分组设置（学习 / 外观与显示 / 音效 / 数据与更新）
// 说明：纯本机应用，无账号、无云端生成；只保留学习与本地数据相关的能力。
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  BookOpen,
  Database,
  Languages,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trophy,
  Zap,
} from 'lucide-react'
import { checkUpdate, applyUpdate, type UpdateInfo } from '../updater'
import { getDb, isTauri, localDayKey } from '../db'
import { applySettings, getSettings, loadStreak, saveSettings, type LocalSettings } from '../study'
import { LANGS, setLang, useI18n } from '../lib/i18n'
import { formatNumber } from '../lib/format'
import {
  Avatar,
  Button,
  Card,
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

// 本地统计只算词书单词卡（co.kind='vocab' AND c.type='word'）
const WORD_JOIN = `JOIN card c ON c.id = cs.card_id
                   JOIN topic t ON t.id = c.topic_id
                   JOIN course co ON co.id = t.course_id`
const WORD_ONLY = `co.kind = 'vocab' AND c.type = 'word'`

export default function SettingsPage() {
  const nav = useNavigate()
  const toast = useToast()
  const { mode, resolved, setMode } = useTheme()
  const { lang } = useI18n()
  const [busyUpdate, runUpdate] = useSubmit()

  const [newLimit, setNewLimit] = useState(localStorage.getItem('zenew_new_limit') || '10')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [updateMsg, setUpdateMsg] = useState('')
  const [ver, setVer] = useState('')
  const [st, setSt] = useState<LocalSettings>(getSettings())
  const [counts, setCounts] = useState<{ cards: number; logs: number } | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsErr, setStatsErr] = useState('')
  const [streak, setStreak] = useState(0)
  const [learned, setLearned] = useState(0)
  const [mastered, setMastered] = useState(0)

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
      const [cards, logs, learnedN, masteredN, streakN] = await Promise.all([
        n(`SELECT COUNT(*) AS n FROM card c JOIN topic t ON t.id = c.topic_id JOIN course co ON co.id = t.course_id WHERE ${WORD_ONLY}`),
        n(`SELECT COUNT(*) AS n FROM review_log rl JOIN card c ON c.id = rl.card_id JOIN topic t ON t.id = c.topic_id JOIN course co ON co.id = t.course_id WHERE ${WORD_ONLY}`),
        n(`SELECT COUNT(*) AS n FROM card_state cs ${WORD_JOIN} WHERE ${WORD_ONLY} AND cs.state!=0`),
        n(`SELECT COUNT(*) AS n FROM card_state cs ${WORD_JOIN} WHERE ${WORD_ONLY} AND cs.state=2 AND cs.stability>=21`),
        loadStreak(),
      ])
      setCounts({ cards, logs })
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
        if (u) setUpdate({ version: u.version, notes: u.notes ?? null })
      })
      .catch(() => {})
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

  return (
    <div className="page-in">
      <PageHeader title="我的" kicker="PROFILE / SETTINGS" />

      {/* 本机概览 */}
      <Card className="fade-up">
        <div className="profile-head" style={{ marginBottom: 0 }}>
          <Avatar seed="知新" size="lg" name="本机" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="profile-name truncate">知新用户</div>
            <div className="profile-id">
              <span>学习数据全部保存在本机</span>
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
        数据与更新
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

      <p className="today-hint fade-up" style={{ marginTop: 'var(--sp-5)' }}>
        <span className="dot" aria-hidden />
        知新 Zenew · 把英语单词变成科学调度的练习系统（学习数据全部保存在本机）
      </p>
    </div>
  )
}
