// 词条详情面板：单词列表页的右栏（宽窗口）与单栏详情视图共用。
// 数据来自 card.front/back（back 为 vocab.ts 的 squeeze JSON：{ m:[{p,t}], s:[{e,c}], uk, us }）。
import { useMemo, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, CalendarClock, Scissors, Star, Volume2 } from 'lucide-react'
import { IconButton, Tag } from '../ui'
import type { BookWordRow } from '../db'
import { wordVisual } from '../study'

/** 单词卡 back JSON 结构（与 ReviewSession 保持一致的读法） */
export interface WordBack {
  m?: { p: string; t: string }[]
  s?: { e: string; c: string }[]
  uk?: string
  us?: string
}

export function parseWordBack(back: string): WordBack | null {
  try {
    const o = JSON.parse(back) as WordBack
    if (o && (o.m || o.s || o.uk || o.us)) return o
    return null
  } catch {
    return null
  }
}

/** 记忆状态 → 级别名（与列表行、详情一致） */
export const STATE_LABELS = ['未学习', '初识', '巩固中', '熟悉', '已掌握'] as const

/** 记忆状态 → 着色（浅深色都用令牌，不写死颜色） */
export function stateColor(state: number): string {
  if (state <= 0) return 'var(--ink-3)'
  if (state === 1) return 'var(--coral)'
  if (state === 2) return 'var(--amber)'
  if (state === 3) return 'var(--brand)'
  return 'var(--mint)'
}

export const DAY_MS = 86400000

/**
 * 日期 → 天序号（本地零点）。
 * 到期时间、逾期天数、筛选口径全部按「天」比较：今晚 23:00 到期算「今天」，
 * 不会因为还差几小时就显示成已逾期，列表文案与筛选结果因此始终一致。
 */
export function dayIndex(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / DAY_MS)
}

/** `下次复习：18天后` / `已逾期 3 天` / `未学习`（today 由页面统一传入，避免每行取一次时间） */
export function dueText(due: string | null, today: number): { text: string; tone: 'due' | 'over' | 'none' } {
  if (!due) return { text: '未学习', tone: 'none' }
  const t = new Date(due).getTime()
  if (!Number.isFinite(t)) return { text: '未学习', tone: 'none' }
  const diff = dayIndex(t) - dayIndex(today)
  if (diff < 0) return { text: `已逾期 ${-diff} 天`, tone: 'over' }
  if (diff === 0) return { text: '今天到期', tone: 'due' }
  return { text: `下次复习：${diff} 天后`, tone: 'due' }
}

/** 例句里高亮目标词（含词形变化，与 ReviewSession 的读法一致） */
export function highlightWord(sentence: string, word: string): ReactNode {
  let re: RegExp
  try {
    re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)`, 'gi')
  } catch {
    return sentence
  }
  return sentence.split(re).map((p, i) =>
    p.toLowerCase().startsWith(word.toLowerCase()) ? <em key={i}>{p}</em> : <span key={i}>{p}</span>
  )
}

/** 朗读：美音 / 英音分别用 en-US / en-GB；无语音引擎时静默 */
export function speak(text: string, lang: 'en-US' | 'en-GB' = 'en-US'): void {
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = 0.92
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {
    /* 无语音引擎时忽略 */
  }
}

export interface WordDetailPanelProps {
  /** 当前词（列表页选出的一行） */
  row: BookWordRow
  /** 星标收藏态由父级持有，切换后即时生效 */
  starred: boolean
  onToggleStar: () => void
  /** 斩：移出计划（父级负责写库、toast 与刷新） */
  onCut: () => void
  cutBusy?: boolean
  /** 词表内移动（父级按当前筛选后的顺序处理，越界时忽略） */
  onPrev: () => void
  onNext: () => void
  hasPrev: boolean
  hasNext: boolean
  /** 记忆状态条下方的进度条百分比（由父级按同一口径算） */
  progress: number
  /** 用于相对日期比较的时间戳 */
  today: number
  /** 窄窗口单栏视图顶部的返回按钮 */
  onClose?: () => void
}

export default function WordDetailPanel({
  row,
  starred,
  onToggleStar,
  onCut,
  cutBusy = false,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  progress,
  today,
  onClose,
}: WordDetailPanelProps) {
  const back = useMemo(() => parseWordBack(row.back), [row.back])
  const visual = useMemo(() => wordVisual(row.front), [row.front])
  const senses = back?.m ?? []
  const sentences = back?.s ?? []
  const due = dueText(row.due, today)
  const state = Math.max(0, Math.min(4, row.state || 0))
  const color = stateColor(state)
  const us = back?.us || (back?.uk ? back.uk : '')
  const uk = back?.uk || ''

  return (
    <section className="wl-detail card" aria-label={`词条详情：${row.front}`}>
      {onClose && (
        <button type="button" className="wl-detail-back" onClick={onClose}>
          <ArrowLeft size={15} aria-hidden /> 返回列表
        </button>
      )}

      {/* 头部：单词 + 音标 + 朗读 + 星标 */}
      <div className="wl-detail-head">
        <div className="wl-detail-main">
          <h2 className="wl-detail-word" title={row.front}>
            {row.front}
          </h2>
          <div className="wl-phones">
            {us && (
              <button type="button" className="wl-phone" title="朗读美音" onClick={() => speak(row.front, 'en-US')}>
                <Volume2 size={12} aria-hidden />
                <span className="wl-phone-tag">美</span>/{us}/
              </button>
            )}
            {uk && (
              <button type="button" className="wl-phone" title="朗读英音" onClick={() => speak(row.front, 'en-GB')}>
                <Volume2 size={12} aria-hidden />
                <span className="wl-phone-tag is-uk">英</span>/{uk}/
              </button>
            )}
            {!us && !uk && (
              <button type="button" className="wl-phone" title="朗读单词" onClick={() => speak(row.front, 'en-US')}>
                <Volume2 size={12} aria-hidden /> 朗读
              </button>
            )}
          </div>
        </div>
        <div className="wl-detail-ops">
          <IconButton
            label={starred ? `取消收藏 ${row.front}` : `收藏 ${row.front} 到生词本标记`}
            onClick={onToggleStar}
            aria-pressed={starred}
            className={starred ? 'is-starred' : ''}
          >
            <Star size={17} fill={starred ? 'currentColor' : 'none'} />
          </IconButton>
          {row.suspended ? (
            <Tag tone="neutral" icon={<Scissors size={11} aria-hidden />}>
              已斩
            </Tag>
          ) : (
            <button type="button" className="btn btn-sm is-danger" disabled={cutBusy} onClick={onCut} title="斩：认识，移出复习计划">
              <Scissors size={14} aria-hidden /> 斩
            </button>
          )}
        </div>
      </div>

      {/* 记忆概览：状态 + 到期 + 记忆图卡 */}
      <div className="wl-detail-meta">
        <div className="wl-meta-facts">
          <div className="wl-fact">
            <span className="wl-fact-k">记忆状态</span>
            <b style={{ color }}>{STATE_LABELS[state]}</b>
          </div>
          <div className="wl-fact">
            <span className="wl-fact-k">复习安排</span>
            <b className={`wl-due is-${due.tone}`} style={{ color: due.tone === 'over' ? 'var(--coral)' : undefined }}>
              <CalendarClock size={12} aria-hidden /> {due.text}
            </b>
          </div>
          <div className="wl-fact">
            <span className="wl-fact-k">复习次数</span>
            <b className="tnum">
              {row.reps} 次{row.lapses > 0 ? ` · 忘 ${row.lapses}` : ''}
            </b>
          </div>
        </div>
        {/* 字形记忆卡：由词形决定的确定性渐变色 + 首字母，不伪造照片 */}
        <div
          className="wl-visual"
          style={{ background: `linear-gradient(150deg, ${visual.from}, ${visual.to})` }}
          role="img"
          aria-label={`${row.front} 的字形记忆卡`}
        >
          <span className="wl-visual-glyph" aria-hidden>
            {visual.glyph}
          </span>
          <span className="wl-visual-caption">{row.front}</span>
        </div>
        <div className="wl-statebar" aria-hidden>
          {[1, 2, 3, 4].map((i) => (
            <i key={i} className={i <= state ? 'is-on' : ''} style={i <= state ? { background: color } : undefined} />
          ))}
        </div>
        <div className="wl-mastery">
          <div className="wl-mastery-line">
            <span>掌握度</span>
            <b className="tnum">{state}/4</b>
          </div>
          <div className="wl-track">
            <i style={{ width: `${progress}%`, background: color }} />
          </div>
        </div>
      </div>

      {/* 释义 */}
      <div className="wl-block">
        <div className="wl-block-title">释义</div>
        {senses.length > 0 ? (
          <ol className="wl-senses">
            {senses.map((m, i) => (
              <li key={i}>
                {m.p && <i className="wl-pos">{m.p}.</i>}
                <span>{m.t}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">该词条没有结构化释义，原始内容：{row.back.slice(0, 120)}</p>
        )}
      </div>

      {/* 例句 */}
      <div className="wl-block">
        <div className="wl-block-title">例句</div>
        {sentences.length > 0 ? (
          <ul className="wl-sentences">
            {sentences.map((s, i) => (
              <li key={i}>
                <p className="wl-sent-en">{highlightWord(s.e, row.front)}</p>
                {s.c && <p className="wl-sent-cn">{s.c}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">该词暂无例句数据。</p>
        )}
      </div>

      {/* 词表内移动 */}
      <div className="wl-nav">
        <button type="button" className="btn btn-sm" disabled={!hasPrev} onClick={onPrev}>
          <ArrowLeft size={14} aria-hidden /> 上一词
        </button>
        <button type="button" className="btn btn-sm" disabled={!hasNext} onClick={onNext}>
          下一词 <ArrowRight size={14} aria-hidden />
        </button>
      </div>
    </section>
  )
}
