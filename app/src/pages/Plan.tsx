// 调整计划：每日组数 ↔ 完成天数 ↔ 预计完成时间 / 每日用时 实时联动
// 界面全部来自 src/ui 组件库（PageHeader / Card / DataTable / Button / Tag / Progress / ConfirmDialog / useToast）
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CalendarClock, Check, Clock, ListChecks, RotateCcw } from 'lucide-react'
import { getDb } from '../db'
import { WORD_BOOKS, vocabCourseStats } from '../vocab'
import { getPlan, savePlan, WORDS_PER_GROUP, estimateMinutes } from '../study'
import { formatDate, formatNumber } from '../lib/format'
import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  Progress,
  Tag,
  type Column,
  useAsync,
  useSubmit,
  useToast,
} from '../ui'

const BOOK_TOTALS: Record<string, number> = { cet4: 4544, cet6: 3991, freq: 4544, basic: 3911 }
const COVERS: Record<string, string> = {
  cet4: 'linear-gradient(140deg, #2FC08A, #12885F)',
  cet6: 'linear-gradient(140deg, #F2705F, #C93A34)',
  freq: 'linear-gradient(140deg, #4C7DF7, #1B47C4)',
  basic: 'linear-gradient(140deg, #FFB020, #E07B39)',
}

interface PlanRow extends Record<string, unknown> {
  groups: number
  perDay: number
  days: number
  recommended: boolean
}

export default function Plan() {
  const { key = 'cet4' } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [saving, runSave] = useSubmit()
  const [confirmReset, setConfirmReset] = useState(false)

  const book = WORD_BOOKS.find((b) => b.key === key) || WORD_BOOKS[0]
  const [groups, setGroups] = useState(getPlan(key).groups)

  /** 词书学习进度（用于推算每日组数 → 完成天数） */
  const { data, loading, error, reload } = useAsync<{ stats: { cards: number; learned: number } }>(
    async () => {
      const s = await vocabCourseStats(book.name, async (sql, args) => {
        const d = await getDb()
        return d.select<Record<string, unknown>[]>(sql, args as never[])
      })
      return { stats: { cards: s.cards, learned: s.learned } }
    },
    [book.name]
  )

  useEffect(() => {
    setGroups(getPlan(key).groups)
  }, [key])

  const stats = data?.stats ?? null

  const totalWords = BOOK_TOTALS[book.key] ?? stats?.cards ?? 0
  const learned = stats?.learned ?? 0
  const remaining = Math.max(0, totalWords - learned)
  const rows = useMemo(
    () =>
      [1, 2, 3, 4, 5].map((g) => {
        const perDay = g * WORDS_PER_GROUP
        const days = remaining > 0 ? Math.ceil(remaining / perDay) : 0
        return { groups: g, perDay, days, recommended: false }
      }),
    [remaining]
  )
  const recommended = rows.find((r) => r.days > 0)?.groups ?? groups
  const tableRows: PlanRow[] = rows.map((r) => ({ ...r, recommended: r.groups === recommended }))
  const current = rows.find((r) => r.groups === groups) || rows[0]
  const finish = new Date(Date.now() + Math.max(0, current.days) * 86400000)

  const columns: Column<PlanRow>[] = [
    {
      key: 'groups',
      header: `每日组数（每组 ${WORDS_PER_GROUP} 词）`,
      width: '38%',
      render: (r) => (
        <Button
          size="xs"
          variant={r.groups === groups ? 'primary' : 'outline'}
          aria-pressed={r.groups === groups}
          title={`每日 ${formatNumber(r.perDay)} 词`}
          onClick={() => setGroups(r.groups)}
        >
          <span className="inline gap-2">
            {r.groups === groups && <Check size={12} aria-hidden />}
            {formatNumber(r.groups)} 组
          </span>
        </Button>
      ),
    },
    {
      key: 'perDay',
      header: '每日词量',
      align: 'end',
      render: (r) => <span className="tnum">{formatNumber(r.perDay)} 词</span>,
    },
    {
      key: 'days',
      header: '完成天数',
      align: 'end',
      render: (r) =>
        r.days > 0 ? (
          <span className="tnum">{formatNumber(r.days)} 天</span>
        ) : (
          <span className="tnum">已学完</span>
        ),
    },
    {
      key: 'minutes',
      header: '每日用时',
      align: 'end',
      render: (r) => <span className="tnum">约 {formatNumber(estimateMinutes(r.perDay))} 分钟</span>,
    },
    {
      key: 'state',
      header: '状态',
      align: 'end',
      render: (r) => (
        <span className="inline gap-2" style={{ justifyContent: 'flex-end' }}>
          {r.days > 0 ? <Tag tone="neutral">可选</Tag> : <Tag tone="success" icon={<Check size={11} aria-hidden />}>已学完</Tag>}
          {r.recommended && r.days > 0 && (
            <Tag tone="brand" icon={<CalendarClock size={11} aria-hidden />}>
              推荐
            </Tag>
          )}
        </span>
      ),
    },
  ]

  const pct = totalWords ? Math.round((learned / totalWords) * 100) : 0

  return (
    <div className="page-in">
      <PageHeader
        title="调整计划"
        kicker="PLAN / DAILY GOAL"
        onBack={() => nav(-1)}
        crumbs={[{ label: '词库', to: '/vocab' }, { label: book.name }, { label: '调整计划' }]}
        onNavigate={(to) => nav(to)}
        actions={
          <IconButton label="重置为默认 3 组" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={16} />
          </IconButton>
        }
      />

      {loading && <LoadingState rows={3} title="正在读取词书进度" />}

      {!loading && error && (
        <ErrorState
          title="词书信息读取失败"
          desc={error}
          onRetry={reload}
          extra={
            <Button variant="ghost" size="sm" onClick={() => nav('/vocab')}>
              回到词库
            </Button>
          }
        />
      )}

      {!loading && !error && stats && (
        <>
          <Card>
            <div className="inline" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 'var(--sp-3)' }}>
              <div className="book-cover" style={{ background: COVERS[book.key] || COVERS.cet4 }} aria-hidden>
                <b>{(book.key || 'BOOK').toUpperCase()}</b>
                <span>{book.name.slice(-2)}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="inline" style={{ flexWrap: 'nowrap', justifyContent: 'space-between' }}>
                  <span className="row-title truncate" title={book.name}>
                    {book.name}
                  </span>
                  <span className="book-pct tnum">
                    每日 {formatNumber(current.perDay)} 词，还需 {formatNumber(current.days)} 天
                  </span>
                </div>
                <div className="row-meta">
                  {book.desc} · 共 {formatNumber(totalWords)} 词
                </div>
                <div style={{ marginTop: 'var(--sp-2)' }}>
                  <Progress
                    value={pct}
                    label={`${book.name} 学习进度 ${pct}%，已学 ${formatNumber(learned)} / ${formatNumber(totalWords)} 词`}
                  />
                </div>
                <div className="inline gap-2" style={{ marginTop: 'var(--sp-2)' }}>
                  <span className="row-meta">
                    已学 {formatNumber(learned)} / {formatNumber(totalWords)} 词 · 剩余 {formatNumber(remaining)} 词
                  </span>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="inline gap-2" style={{ justifyContent: 'space-between' }}>
              <span className="section-label" style={{ margin: 0 }}>
                每日组数 / 完成天数联动
              </span>
              <span className="row-meta">点「n 组」即切换，无需额外确认</span>
            </div>
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <DataTable
                caption="不同每日组数对应的完成天数与每日用时"
                rows={tableRows}
                rowKey={(r) => r.groups}
                columns={columns}
                empty={<span className="muted">暂无可选档位。</span>}
              />
            </div>
          </Card>

          <Card>
            <div className="section-label">预计完成情况</div>
            <div className="inline" style={{ gap: 'var(--sp-5)' }}>
              <span className="inline gap-2">
                <CalendarClock size={15} aria-hidden style={{ color: 'var(--brand)' }} />
                <span className="row-meta">预计完成时间</span>
                <b className="tnum" style={{ fontSize: 'var(--fs-lg)' }}>
                  {current.days > 0 ? formatDate(finish) : '已学完'}
                </b>
              </span>
              <span className="inline gap-2">
                <Clock size={15} aria-hidden style={{ color: 'var(--brand)' }} />
                <span className="row-meta">预计每日用时</span>
                <b className="tnum" style={{ fontSize: 'var(--fs-lg)' }}>
                  {formatNumber(estimateMinutes(current.perDay))} 分钟
                </b>
              </span>
            </div>
            <div className="inline gap-2" style={{ marginTop: 'var(--sp-3)' }}>
              {current.days === 0 ? (
                <Tag tone="success" icon={<Check size={11} aria-hidden />}>
                  这本词书已经学完了
                </Tag>
              ) : (
                <Tag tone="success" icon={<Check size={11} aria-hidden />}>
                  按这个节奏 {formatNumber(current.days)} 天学完
                </Tag>
              )}
              <span className="row-meta">
                每日 {formatNumber(current.perDay)} 词 · 每组 {WORDS_PER_GROUP} 词、每题约 25 秒估算
                {current.days > 0 ? ` · 建议 ${formatNumber(recommended)} 组` : ''}
              </span>
            </div>
          </Card>

          <div className="inline gap-2" style={{ marginTop: 'var(--sp-4)' }}>
            <Button
              variant="primary"
              size="lg"
              icon={<ListChecks size={15} aria-hidden />}
              loading={saving}
              onClick={() =>
                runSave(async () => {
                  savePlan(key, { groups })
                  try {
                    localStorage.setItem('zenew_new_limit', String(groups * WORDS_PER_GROUP))
                  } catch {
                    /* 忽略本地存储不可用的情况 */
                  }
                  toast.success(`计划已保存：每日 ${groups} 组（${groups * WORDS_PER_GROUP} 词）`)
                  window.setTimeout(() => nav(-1), 500)
                })
              }
            >
              保存计划
            </Button>
            <Button variant="ghost" size="lg" onClick={() => nav('/vocab')}>
              返回词库
            </Button>
          </div>

          <div className="today-hint fade-up" style={{ marginTop: 'var(--sp-5)' }}>
            <span className="dot" aria-hidden />
            每日组数同时决定「新学」上限：{groups} 组 = 每天最多引入 {groups * WORDS_PER_GROUP} 个新词
          </div>

          <div className="inline gap-2" style={{ marginTop: 'var(--sp-3)' }}>
            <Tag tone="neutral" icon={<Clock size={11} aria-hidden />}>
              计划保存在本机
            </Tag>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="重置为默认 3 组？"
        description={
          <>
            当前选择是 <b>{groups}</b> 组（每日 {formatNumber(groups * WORDS_PER_GROUP)} 词）。重置只改这里的选项，点「保存计划」后才会生效。
          </>
        }
        confirmText="重置为 3 组"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setGroups(3)
          setConfirmReset(false)
          toast.info('已重置为默认 3 组，点「保存计划」后生效')
        }}
      />
    </div>
  )
}
