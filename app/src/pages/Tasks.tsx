// 每日任务：完成任务得星星，集满 30 颗开「坚持者」徽章
// 全部由真实学习行为驱动（本地 review_log 统计），不涉及任何付费内容。
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Gift, Star, Target } from 'lucide-react'
import { dailyTasks, starBank, grantStars, openGift, giftCount, type Task } from '../study'
import { formatNumber } from '../lib/format'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Progress,
  Tag,
  useAsync,
  useToast,
} from '../ui'

interface TaskData {
  tasks: Task[]
  points: number
  grantedStars: number
}

export default function Tasks() {
  const nav = useNavigate()
  const toast = useToast()
  const [bank, setBank] = useState(starBank())
  const [gifts, setGifts] = useState(giftCount())

  const { data, loading, error, reload } = useAsync<TaskData>(async () => {
    const { tasks, activity } = await dailyTasks()
    const grantedStars = grantStars(tasks.filter((t) => t.done).map((t) => t.key))
    return { tasks, points: activity.points, grantedStars }
  }, [])

  useEffect(() => {
    if (data?.grantedStars) {
      setBank(starBank())
      toast.success(`完成任务，获得 ${data.grantedStars} 颗星`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.grantedStars])

  const inJar = bank % 30
  const displayStars = inJar === 0 && bank > 0 ? 30 : inJar
  const canOpen = bank >= 30
  const doneCount = data?.tasks.filter((t) => t.done).length ?? 0

  return (
    <div className="page-in">
      <PageHeader
        title="每日任务"
        kicker="DAILY / TASKS"
        onBack={() => nav('/today')}
        crumbs={[{ label: '单词', to: '/today' }, { label: '每日任务' }]}
        onNavigate={(to) => nav(to)}
        actions={
          <Tag tone="neutral" icon={<Gift size={11} />}>
            已开 {formatNumber(gifts)} 个
          </Tag>
        }
      />

      {loading && <LoadingState rows={3} title="正在统计今日学习" />}

      {!loading && error && (
        <ErrorState title="任务进度读取失败" desc={error} onRetry={reload} />
      )}

      {!loading && !error && data && (
        <>
          <Card className="fade-up">
            <div className="inline" style={{ gap: 'var(--sp-3)' }}>
              <Target size={17} aria-hidden style={{ color: 'var(--brand)' }} />
              <div className="spacer-flex">
                <div className="row-title">
                  今天已完成 {doneCount} / {data.tasks.length} 个任务
                </div>
                <div className="row-meta">
                  学习得分 {formatNumber(data.points)} · 星星罐 {displayStars}/30
                </div>
              </div>
            </div>
          </Card>

          {/* 星星罐 */}
          <div className="jar-wrap">
            <div
              className="jar"
              role="img"
              aria-label={`星星罐：${displayStars} / 30 颗`}
            >
              <div className="jar-num tnum">
                {displayStars}
                <small>/30</small>
              </div>
              {Array.from({ length: Math.min(6, Math.max(1, Math.round(displayStars / 5))) }).map((_, i) => (
                <span className="jar-star" key={i} style={{ animationDelay: `${i * 0.3}s`, color: 'var(--warning-500)' }} aria-hidden>
                  <Star size={22} fill="currentColor" />
                </span>
              ))}
            </div>
          </div>

          <div className="jar-card">
            <Gift size={24} aria-hidden style={{ color: 'var(--brand)' }} />
            <p>
              完成任务得星星，集齐 <b>30</b> 颗开「坚持者」徽章
            </p>
            <Button
              variant={canOpen ? 'primary' : 'secondary'}
              size="sm"
              disabled={!canOpen}
              onClick={() => {
                if (openGift()) {
                  setBank(starBank())
                  setGifts(giftCount())
                  toast.success('礼包已开启：获得「坚持者」徽章 ×1')
                }
              }}
            >
              <Gift size={13} /> {canOpen ? '开礼包' : '待解锁'}
            </Button>
          </div>

          <div className="section-label" style={{ marginTop: 'var(--sp-5)' }}>
            每日任务
          </div>
          <div className="task-list">
            {data.tasks.map((t) => (
              <div className="task-row" key={t.key}>
                <div className="task-coin" aria-hidden>
                  +{t.reward}
                  <small>星星</small>
                </div>
                <div className="task-main">
                  <div className="task-title">{t.title}</div>
                  <div className="task-sub">{t.sub}</div>
                  <div style={{ marginTop: 'var(--sp-2)' }}>
                    <Progress
                      value={Math.min(t.now, t.target)}
                      max={t.target}
                      label={`${t.title} 进度`}
                      tone={t.done ? 'mint' : 'brand'}
                    />
                  </div>
                </div>
                <Button
                  variant={t.done ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => nav(t.key === 'review1' ? '/review' : '/vocab')}
                >
                  {t.done ? (
                    <>
                      <Check size={12} /> 已完成
                    </>
                  ) : (
                    '去完成'
                  )}
                </Button>
              </div>
            ))}
          </div>

          {data.tasks.length === 0 && (
            <EmptyState
              title="今天还没有任务"
              desc="导入一本词书后，每日任务会自动出现。"
              action={
                <Button variant="primary" onClick={() => nav('/vocab')}>
                  去挑一本词书
                </Button>
              }
            />
          )}

          <p className="today-hint fade-up">
            <span className="dot" aria-hidden />
            进度由本地学习记录实时统计：每复习 1 张 +4 分，答对再 +2 分；徽章仅作纪念，不涉及任何付费内容。
          </p>
        </>
      )}
    </div>
  )
}
