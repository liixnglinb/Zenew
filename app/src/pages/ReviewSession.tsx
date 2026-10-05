import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ArrowLeft, ArrowRight, Brain, CalendarClock, Check, Flame, Inbox, Lightbulb, Maximize2, Minimize2, PartyPopper, RotateCcw, Scissors, Sparkles, Volume2, X } from 'lucide-react'
import { getDb, loadQueue, loadSession, loadQueueByIds, saveSession, clearSession, nowIso, isTauri, type QueueItem } from '../db'
import { schedule, R } from '../fsrs'
import { buildWordChoices, morphology, similarWords, tone, buzz, getSettings, loadStreak, type ChoiceSet } from '../study'
import { emblemOf } from '../emblem'
import { Progress, useToast } from '../ui'
import { useHotkeys } from '../ui/desktop'
import '../polish.css'

type Phase = 'front' | 'answered'
type DetailTab = 'sense' | 'sent' | 'morph' | 'similar'

/** 单词卡 back 结构（vocab.ts squeeze 输出） */
interface WordBack {
  m?: { p: string; t: string }[]
  s?: { e: string; c: string }[]
  uk?: string
  us?: string
}
function parseWordBack(back: string): WordBack | null {
  try {
    const o = JSON.parse(back)
    if (o && (o.m || o.s || o.uk || o.us)) return o as WordBack
    return null
  } catch {
    return null
  }
}

/** Tauri WebView2 内置 SpeechSynthesis 朗读 */
function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    u.rate = 0.92
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {
    /* 无语音引擎时静默 */
  }
}

/* ---------------- 可解释记忆面板（为什么现在复习） ----------------
 * FSRS-4.5 可提取性幂函数：R = (1 + FACTOR · elapsed / stability)^DECAY
 * FACTOR = 19/81、DECAY = -0.5 为 FSRS-4.5 标准常数（ts-fsrs 的 SRS 默认衰减曲线）。
 * src/fsrs.ts 未导出内部常数，这里按同口径本地实现，仅用于展示，不参与调度。
 */
const RETENTION_FACTOR = 19 / 81
const RETENTION_DECAY = -0.5

interface WhyInfo {
  /** 距上次学习的人类可读天数 */
  days: string
  /** 可提取性（记忆强度，0..1） */
  r: number
  /** 一句白话（≤20 字） */
  line: string
}

function explainMemory(st: QueueItem['st']): WhyInfo | null {
  if (!st || st.state === 0 || !st.last_review || !(st.stability > 0)) return null
  const last = new Date(st.last_review).getTime()
  if (!Number.isFinite(last)) return null
  const elapsed = Math.max(0, (Date.now() - last) / 86400000)
  const r = Math.min(1, Math.max(0.01, Math.pow(1 + RETENTION_FACTOR * (elapsed / st.stability), RETENTION_DECAY)))
  const days = elapsed < 1 ? '不足 1 天' : `${Math.floor(elapsed)} 天`
  const line =
    r >= 0.9
      ? '记得很牢，趁热巩固一遍'
      : r >= 0.75
        ? '记忆开始变淡，正是复习时机'
        : r >= 0.5
          ? '快到遗忘临界点，现在复习收益最高'
          : '已到遗忘边缘，现在回忆最有效'
  return { days, r, line }
}

interface Confetti {
  left: number
  dx: number
  rot: number
  color: string
  delay: number
}

// v6 品牌色系（--mint-hi / --brand / --amber-hi / --amber / --brand-hi），保持庆祝多色效果
const CONFETTI_COLORS = ['#2ED0B4', '#3A63E0', '#FFBB55', '#FF9F1C', '#476FD8', '#FFFFFF']

export default function ReviewSession({ initialQueue }: { initialQueue?: QueueItem[] }) {
  const nav = useNavigate()
  const toast = useToast()
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue ?? [])
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('front')
  const [picked, setPicked] = useState<number | null>(null)
  const [choices, setChoices] = useState<ChoiceSet | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('sense')
  const [showDetail, setShowDetail] = useState(false)
  const [similar, setSimilar] = useState<{ w: string; t: string }[] | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [confetti, setConfetti] = useState<Confetti[]>([])
  const [prevCard, setPrevCard] = useState<{ w: string; m: string } | null>(null)
  const [done, setDone] = useState<{ total: number; again: number; ms: number } | null>(null)
  /** 完成页附加数据：明日到期预告 + 连续天数（进入完成态后异步查询） */
  const [doneExtra, setDoneExtra] = useState<{ tomorrow: number; streak: number } | null>(null)
  const shownAt = useRef<number>(Date.now())
  const sessionStart = useRef<number>(Date.now())
  const againCount = useRef<number>(0)
  const doneCount = useRef<number>(0)
  const [loading, setLoading] = useState(true)
  const [fs, setFs] = useState(false)
  const [resumed, setResumed] = useState(false)
  const committing = useRef(false)
  const [commitErr, setCommitErr] = useState('')
  /** 桌面右键菜单（朗读 / 复制 / 词根 / 斩） */
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [ctx])

  const enterFs = () => {
    if (isTauri()) getCurrentWindow().setFullscreen(true).catch(() => {})
    try { localStorage.setItem('zenew_review_fs', '1') } catch {}
  }
  const exitFs = () => {
    if (isTauri()) getCurrentWindow().setFullscreen(false).catch(() => {})
    try { localStorage.setItem('zenew_review_fs', '0') } catch {}
  }

  useEffect(() => {
    if (isTauri()) {
      const win = getCurrentWindow()
      const p = win.onResized(async () => {
        try { setFs(await win.isFullscreen()) } catch {}
      })
      return () => {
        p.then((f) => f()).catch(() => {})
      }
    }
    return () => {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        if (initialQueue && initialQueue.length) {
          await saveSession(initialQueue.map((x) => x.id), 0).catch(() => {})
          shownAt.current = Date.now()
          setLoading(false)
          return
        }
        const saved = await loadSession()
        if (saved) {
          const q = await loadQueueByIds(saved.card_ids)
          if (q.length && saved.idx < q.length) {
            setQueue(q)
            setIdx(saved.idx)
            doneCount.current = saved.done_count || 0
            againCount.current = saved.again_count || 0
            setResumed(true)
            setLoading(false)
            shownAt.current = Date.now()
            return
          }
        }
        await clearSession()
      } catch (e) {
        console.error('恢复会话失败', e)
      }
      const rawLimit = Number(localStorage.getItem('zenew_new_limit'))
      const newLimit = Number.isFinite(rawLimit) && rawLimit >= 0 ? rawLimit : 10
      const q = await loadQueue(nowIso(), newLimit)
      setQueue(q)
      await saveSession(q.map((x) => x.id), 0).catch(() => {})
      setLoading(false)
      shownAt.current = Date.now()
    })()
  }, [])

  /* ---- 完成态附加统计：明日到期预告 + 连续天数（口径与 loadQueue 一致：词书单词卡） ---- */
  useEffect(() => {
    if (!done) {
      setDoneExtra(null)
      return
    }
    let alive = true
    void (async () => {
      try {
        const db = await getDb()
        const base = new Date()
        base.setHours(0, 0, 0, 0)
        const t1 = new Date(base.getTime() + 86400000)
        const t2 = new Date(base.getTime() + 2 * 86400000)
        const rows = await db.select<{ n: number }[]>(
          `SELECT COUNT(*) AS n FROM card_state cs
           JOIN card c ON c.id = cs.card_id
           JOIN topic t ON t.id = c.topic_id
           JOIN course co ON co.id = t.course_id
           WHERE co.kind = 'vocab' AND c.type = 'word' AND c.suspended = 0 AND cs.state != 0
             AND cs.due >= ? AND cs.due < ?`,
          [t1.toISOString(), t2.toISOString()]
        )
        const streak = await loadStreak().catch(() => 0)
        if (alive) setDoneExtra({ tomorrow: Number(rows[0]?.n || 0), streak })
      } catch (e) {
        console.error('完成页统计失败', e)
        if (alive) setDoneExtra({ tomorrow: 0, streak: 0 })
      }
    })()
    return () => {
      alive = false
    }
  }, [done])

  /** 「再学一组」：清零计数器，重新拉队列进入学习 */
  const studyAnother = () => {
    void (async () => {
      const rawLimit = Number(localStorage.getItem('zenew_new_limit'))
      const newLimit = Number.isFinite(rawLimit) && rawLimit >= 0 ? rawLimit : 10
      const q = await loadQueue(nowIso(), newLimit)
      if (!q.length) {
        toast.info('暂时没有更多待学的卡片，先去词书导入吧')
        return
      }
      doneCount.current = 0
      againCount.current = 0
      sessionStart.current = Date.now()
      shownAt.current = Date.now()
      setQueue(q)
      setIdx(0)
      setPhase('front')
      setPicked(null)
      setDone(null)
      setResumed(false)
      setDoneExtra(null)
      // 重置单卡 UI 态（新队首可能与上一队尾同 id，item 变更 effect 不会触发）
      setShowDetail(false)
      setShowHint(false)
      setSimilar(null)
      setDetailTab('sense')
      setConfetti([])
      setCommitErr('')
      await saveSession(q.map((x) => x.id), 0).catch(() => {})
    })()
  }

  const item = queue[idx]
  const wordBack = useMemo(() => (item ? parseWordBack(item.back) : null), [item])
  const morph = useMemo(() => (item ? morphology(item.front) : null), [item])
  const emb = useMemo(() => emblemOf(item?.front || 'A'), [item])
  const why = useMemo(() => explainMemory(item?.st ?? null), [item?.st])
  const firstSense = wordBack?.m?.[0]

  /* ---- 换卡：重置阶段态，生成四选一，自动朗读 ---- */
  useEffect(() => {
    if (!item) return
    setPhase('front')
    setPicked(null)
    setShowDetail(false)
    setShowHint(false)
    setConfetti([])
    setSimilar(null)
    setDetailTab('sense')
    setCommitErr('')
    shownAt.current = Date.now()
    const back = parseWordBack(item.back)
    const sense = back?.m?.[0]
    if (sense?.t) {
      buildWordChoices(item.id, item.course_name, sense).then(setChoices).catch(() => setChoices(null))
    } else {
      setChoices(null)
    }
    if (getSettings().sound) setTimeout(() => speak(item.front), 220)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  /* ---- 答对后异步取形近词（用于「和 xxx 搞混了？」辨析） ---- */
  useEffect(() => {
    if (phase !== 'answered' || !item) return
    similarWords(item.front).then(setSimilar).catch(() => setSimilar([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, item?.id])

  const commit = async (grade: number): Promise<boolean> => {
    if (!item) return false
    const db = await getDb()
    const { next } = schedule(item.st, grade as 1 | 2 | 3 | 4)
    const row = { ...next, card_id: item.id }
    try {
      await db.execute(
        `INSERT INTO card_state(card_id,due,stability,difficulty,elapsed_days,scheduled_days,reps,lapses,state,last_review)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(card_id) DO UPDATE SET due=excluded.due, stability=excluded.stability, difficulty=excluded.difficulty,
           elapsed_days=excluded.elapsed_days, scheduled_days=excluded.scheduled_days, reps=excluded.reps,
           lapses=excluded.lapses, state=excluded.state, last_review=excluded.last_review`,
        [row.card_id, row.due, row.stability, row.difficulty, row.elapsed_days, row.scheduled_days, row.reps, row.lapses, row.state, row.last_review]
      )
      await db.execute('INSERT INTO review_log(card_id,rating,reviewed_at,duration_ms) VALUES(?,?,?,?)', [
        item.id,
        grade,
        nowIso(),
        Date.now() - shownAt.current,
      ]).catch(() => {})
      return true
    } catch (e) {
      console.error('commit 失败', e)
      setCommitErr('保存失败，请重试')
      return false
    }
  }

  const advance = () => {
    if (idx + 1 >= queue.length) {
      void clearSession().catch(() => {})
      setDone({ total: doneCount.current + 1, again: againCount.current, ms: Date.now() - sessionStart.current })
    } else {
      const nextIdx = idx + 1
      setIdx(nextIdx)
      setPhase('front')
      setPicked(null)
      shownAt.current = Date.now()
      void saveSession(queue.map((x) => x.id), nextIdx, doneCount.current, againCount.current).catch(() => {})
    }
  }

  /** 作答（四选一） */
  const pickChoice = (i: number) => {
    if (phase === 'answered' || committing.current || !item) return
    committing.current = true
    const right = i === (choices?.answerIndex ?? 0)
    setPicked(i)
    setPhase('answered')
    if (right) {
      tone('ok')
      buzz(18)
      setConfetti(
        Array.from({ length: 22 }, (_, k) => ({
          left: 4 + ((k * 37) % 92),
          dx: ((k * 53) % 60) - 30,
          rot: 180 + ((k * 71) % 360),
          color: CONFETTI_COLORS[k % CONFETTI_COLORS.length],
          delay: (k % 6) * 0.045,
        }))
      )
    } else {
      tone('no')
      buzz(40)
    }
    void (async () => {
      const ok = await commit(right ? R.Good : R.Again)
      if (!ok) {
        committing.current = false
        return
      }
      if (!right) againCount.current++
      doneCount.current++
      await saveSession(queue.map((x) => x.id), Math.min(idx + 1, queue.length), doneCount.current, againCount.current).catch(() => {})
      committing.current = false
    })()
  }

  /** 自评分（回忆卡） */
  const selfGrade = (g: 1 | 2 | 3 | 4) => {
    if (committing.current || !item) return
    committing.current = true
    tone(g === R.Again ? 'no' : 'ok')
    buzz(g === R.Again ? 30 : 12)
    void (async () => {
      const ok = await commit(g)
      if (!ok) {
        committing.current = false
        return
      }
      if (g === R.Again) againCount.current++
      doneCount.current++
      await saveSession(queue.map((x) => x.id), idx + 1, doneCount.current, againCount.current).catch(() => {})
      committing.current = false
      advance()
    })()
  }

  /** 斩：认识，直接移出计划（暂停该卡 + 按 Easy 记录），立即下一张 */
  const cutCard = () => {
    if (!item || committing.current) return
    committing.current = true
    tone('cut')
    toast.success('已斩 · 不再出现在计划里')
    void (async () => {
      try {
        const db = await getDb()
        await db.execute('UPDATE card SET suspended=1 WHERE id=?', [item.id])
      } catch (e) {
        console.error(e)
      }
      const ok = await commit(R.Easy)
      committing.current = false
      if (!ok) return
      doneCount.current++
      await saveSession(queue.map((x) => x.id), idx + 1, doneCount.current, againCount.current).catch(() => {})
      advance()
    })()
  }

  /**
   * 桌面键盘操作（学习页全键盘可用）：
   * 1-4 选答案 / 空格 翻面或继续 / Enter 继续 / ← 回看上一词 / → 继续 / S 斩 / P 朗读
   * Esc 由外壳统一处理（返回上一页），此处不重复绑定。
   */
  const hasChoices = !!choices && choices.choices.length > 0
  useHotkeys(
    useMemo(
      () => ({
        '1': () => {
          if (hasChoices && phase === 'front') pickChoice(0)
        },
        '2': () => {
          if (hasChoices && phase === 'front') pickChoice(1)
        },
        '3': () => {
          if (hasChoices && phase === 'front') pickChoice(2)
        },
        '4': () => {
          if (hasChoices && phase === 'front') pickChoice(3)
        },
        space: () => {
          if (phase === 'front') {
            setPhase('answered')
            return
          }
          if (hasChoices) advance()
        },
        enter: () => {
          if (phase === 'front') {
            setPhase('answered')
            return
          }
          if (hasChoices) advance()
        },
        arrowleft: () => {
          if (prevCard) toast.info(`${prevCard.w}：${prevCard.m}`)
        },
        arrowright: () => {
          if (phase !== 'front' && hasChoices) advance()
        },
        s: () => cutCard(),
        p: () => {
          if (item) speak(item.front)
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [hasChoices, phase, prevCard, item]
    )
  )

  /** 记录「上一词」条 */
  useEffect(() => {
    if (phase !== 'answered' || !item) return
    const sense = parseWordBack(item.back)?.m?.[0]
    if (sense?.t) setPrevCard({ w: item.front, m: `${sense.p ? sense.p + '. ' : ''}${sense.t}` })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, item?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        exitFs()
        nav('/today')
        return
      }
      if (!item || done || committing.current) return
      const hasChoices = !!choices
      if (phase === 'front' && e.code === 'Space') {
        e.preventDefault()
        if (hasChoices) return
        setPhase('answered')
        return
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        speak(item.front)
        return
      }
      if (phase === 'front' && hasChoices && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        pickChoice(Number(e.key) - 1)
        return
      }
      if (phase === 'answered' && !hasChoices && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        selfGrade(Number(e.key) as 1 | 2 | 3 | 4)
        return
      }
      if (phase === 'answered' && hasChoices && (e.key === 'Enter' || e.code === 'Space')) {
        e.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, idx, phase, done, choices])

  /* ---------------- 渲染 ---------------- */

  if (loading) {
    return (
      <div className="study" style={{ padding: '40px 22px' }}>
        <div className="skeleton sk-line" style={{ width: 140, height: 22 }} />
        <div className="skeleton" style={{ height: 220, borderRadius: 'var(--r-lg)', marginTop: 14 }} />
        <div className="skeleton sk-line" style={{ width: 200, height: 30, marginTop: 18 }} />
      </div>
    )
  }

  if (done || queue.length === 0) {
    const s = done || { total: 0, again: 0, ms: 0 }
    const acc = s.total > 0 ? Math.round(((s.total - s.again) / s.total) * 100) : null
    const isEmpty = queue.length === 0 && !done
    return (
      <div className="study" style={{ padding: '8vh 22px 40px' }}>
        <div className="page-in" style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
          <div className={`done-hero${isEmpty ? ' done-hero--empty' : ''}`} aria-hidden>
            {isEmpty ? <Inbox size={32} /> : <PartyPopper size={32} />}
          </div>
          <div className="page-title" style={{ marginTop: 12 }}>
            {isEmpty ? '暂时没有待学的卡片' : '今日训练完成'}
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            {isEmpty ? '去词书挑一本开始学习，或到查词页收藏生词' : '学习记录已保存，下次打开接着安排'}
          </div>
          {done && (
            <div className="card done-card" role="group" aria-label="本组学习小结">
              <div className="done-stats">
                <div className="done-stat">
                  <b className="tnum">{s.total}</b>
                  <span>张完成</span>
                </div>
                <div className="done-stat">
                  <b className="tnum">{acc === null ? '—' : `${acc}%`}</b>
                  <span>正确率</span>
                </div>
                <div className="done-stat">
                  <b className="tnum">{s.again}</b>
                  <span>次忘了</span>
                </div>
                <div className="done-stat">
                  <b className="tnum">{Math.round(s.ms / 1000)}</b>
                  <span>秒用时</span>
                </div>
              </div>
              {doneExtra && (
                <div className="done-extra">
                  <div className="done-extra-row">
                    <CalendarClock size={14} aria-hidden />
                    <span>明天还有 {doneExtra.tomorrow} 词待复习</span>
                  </div>
                  <div className="done-extra-row is-streak">
                    <Flame size={14} aria-hidden />
                    <span>{doneExtra.streak > 0 ? `已连续学习 ${doneExtra.streak} 天，火候正好` : '今天开了个好头，明天再来续上火'}</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <div style={{ marginTop: 20, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {!isEmpty && (
              <button className="btn btn-primary" onClick={studyAnother}>
                <RotateCcw size={15} aria-hidden /> 再学一组
              </button>
            )}
            <button className="btn btn-outline" onClick={() => { exitFs(); nav('/today') }}>
              回到今日
            </button>
            <button className="btn btn-outline" onClick={() => { exitFs(); nav('/stats') }}>
              看看统计
            </button>
            {fs && (
              <button className="btn btn-ghost" onClick={exitFs}>
                退出全屏
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const right = choices?.answerIndex ?? 0
  const isRight = picked === right

  return (
    <div
      className={`study${fs ? ' review-fs' : ''}`}
      onContextMenu={(e) => {
        if (!item) return
        e.preventDefault()
        setCtx({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 220) })
      }}
    >
      {ctx && item && (
        <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }} role="menu" aria-label="单词操作">
          <div className="ctx-title">{item.front}</div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              speak(item.front)
              setCtx(null)
            }}
          >
            <Volume2 size={15} aria-hidden /> 朗读单词（P）
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard?.writeText(item.front).catch(() => {})
              toast.success('已复制单词')
              setCtx(null)
            }}
          >
            <Check size={15} aria-hidden /> 复制单词
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setShowDetail(true)
              setCtx(null)
            }}
          >
            <Sparkles size={15} aria-hidden /> 词根词缀与形近词
          </button>
          <div className="ctx-sep" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setCtx(null)
              cutCard()
            }}
          >
            <Scissors size={15} aria-hidden /> 斩掉这个词（S）
          </button>
        </div>
      )}
      {/* 顶部：返回 + 上一词 + 进度 + 贴纸 */}
      <div className="study-top">
        <button className="icon-btn" title="退出学习（Esc）" onClick={() => { exitFs(); nav('/today') }}>
          <ArrowLeft size={17} />
        </button>
        <span className="study-top-mid">
          {prevCard ? `${prevCard.w}: ${prevCard.m}` : '暂无上一词'}
        </span>
        {resumed && (
          <span className="tag tag-glass" style={{ marginRight: 8 }} title="从中断处继续">
            已续
          </span>
        )}
        <button className="review-exit" title={fs ? '退出全屏' : '进入全屏'} onClick={() => (fs ? exitFs() : enterFs())} style={{ marginLeft: 0 }}>
          {fs ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
      <div style={{ padding: '0 var(--sp-6) var(--sp-2)' }}>
        <Progress value={idx + 1} max={queue.length} label={`学习进度：第 ${idx + 1} / ${queue.length} 张`} />
      </div>
      <div className="study-badge">连对保护</div>

      <div style={{ padding: '0 22px', maxWidth: 560, margin: '0 auto', position: 'relative' }}>
        {/* 答对纸屑 */}
        {confetti.length > 0 && (
          <div className="celebrate">
            {confetti.map((c, i) => (
              <span
                key={i}
                className="confetti"
                style={
                  {
                    left: `${c.left}%`,
                    background: c.color,
                    animationDelay: `${c.delay}s`,
                    '--dx': `${c.dx}px`,
                    '--rot': `${c.rot}deg`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}

        {/* 媒体记忆卡：程序化形义徽标（纹样平铺 + 渐变 + 中央大字形 + 细微光晕，同词永远同图） */}
        <div className="media-card media-card--emblem" style={{ background: `linear-gradient(150deg, ${emb.from}, ${emb.to})` }}>
          <span
            className="emblem-pattern"
            aria-hidden
            style={{ backgroundImage: `url("${emb.pattern}")`, transform: `rotate(${emb.angle}deg)` }}
          />
          <span className="emblem-halo" aria-hidden />
          <span className="media-letter">{emb.glyph}</span>
          <span className="media-tag">WORD</span>
          <span className="media-caption">
            {item.course_name} · {item.topic_title}
          </span>
          {picked !== null && isRight && (
            <div className="answer-bubble">
              <b>{item.front}</b>
              <span>{firstSense ? `${firstSense.p ? firstSense.p + '. ' : ''}${firstSense.t}` : '已掌握'}</span>
            </div>
          )}
        </div>

        {/* 单词 */}
        <div className="study-word">
          <div className="study-word-text">{item.front}</div>
          <div className="study-phones">
            {wordBack?.uk && <span className="study-phone">美 /{wordBack.us || wordBack.uk}/</span>}
            {wordBack?.uk && wordBack?.us && wordBack.uk !== wordBack.us && <span className="study-phone">英 /{wordBack.uk}/</span>}
            <button className="word-speak" title="朗读 (S)" onClick={() => speak(item.front)}>
              <Volume2 size={15} />
            </button>
          </div>
        </div>

        {/* 例句 */}
        {wordBack?.s?.[0] && (
          <p className="study-sentence">
            {highlightWord(wordBack.s[0].e, item.front)}
            {showHint && wordBack.s[0].c && <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: '.82rem', marginTop: 4 }}>{wordBack.s[0].c}</span>}
          </p>
        )}

        {/* 四选一 */}
        {choices && (
          <>
            <div className="choice-grid" role="group" aria-label="选择这个单词的正确释义">
              {choices.choices.map((c, i) => {
                const revealed = phase === 'answered'
                const isAnswer = i === right
                const cls = revealed ? (isAnswer ? ' is-right' : i === picked ? ' is-wrong' : ' is-dim') : ''
                return (
                  <button key={i} className={`choice-cell${cls}`} disabled={revealed} onClick={() => pickChoice(i)}>
                    <span className="choice-pos">{c.replace(/\..*$/, '.')}</span>
                    {c.replace(/^[a-z]+\.\s*/i, '')}
                    {revealed && isAnswer && (
                      <span className="choice-tick">
                        <Check size={15} strokeWidth={3} />
                      </span>
                    )}
                    {revealed && i === picked && !isAnswer && (
                      <span className="choice-tick" style={{ background: 'var(--red)' }}>
                        <X size={15} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {phase === 'front' && (
              <div className="review-hint">
                点击选项作答，或按 <kbd>1</kbd>-<kbd>4</kbd>
              </div>
            )}
          </>
        )}

        {/* 回忆卡：先想再看答案 */}
        {!choices && phase === 'front' && (
          <>
            <div className="reveal-row">
              <button className="btn btn-primary btn-lg" onClick={() => setPhase('answered')}>
                显示答案
              </button>
            </div>
            <div className="review-hint">
              先回忆 · <kbd>空格</kbd> 翻面
            </div>
          </>
        )}

        {/* 作答后的详情 */}
        {phase === 'answered' && (
          <div className="fade-up" style={{ marginTop: 18 }}>
            {/* 可解释记忆面板：为什么现在复习（数据来自 card_state，不足时不渲染假数据） */}
            {why ? (
              <div className="why-row" role="note" aria-label="为什么现在复习">
                <Brain size={14} aria-hidden />
                <span className="why-title">为什么现在复习</span>
                <span className="why-facts">
                  距上次学习 {why.days} · 记忆强度 {Math.round(why.r * 100)}% · 预计遗忘概率 {Math.round((1 - why.r) * 100)}%
                </span>
                <span className="why-line">{why.line}</span>
              </div>
            ) : (
              <div className="why-row why-row--first" role="note" aria-label="为什么现在复习">
                <Brain size={14} aria-hidden />
                <span className="why-title">为什么现在复习</span>
                <span className="why-line">首学：建立记忆轨迹</span>
              </div>
            )}

            {/* 易混词辨析气泡（离线编辑距离，非 AI） */}
            {similar && similar.length > 0 && (
              <button
                className="ai-bubble"
                style={{ marginBottom: 12 }}
                onClick={() => {
                  setDetailTab('similar')
                  setShowDetail(true)
                }}
              >
                <span className="ai-mark">辨析</span>
                和 {similar[0].w} 搞混了？帮你辨析
                <span className="spacer" />
                <ArrowRight size={15} style={{ color: 'var(--ink-3)' }} />
              </button>
            )}

            {wordBack && !showDetail && (
              <div className="detail-card">
                <div className="detail-tabs">
                  {(
                    [
                      ['sense', '释义'],
                      ['sent', '例句'],
                      ['morph', '词根词缀'],
                      ['similar', '形近词'],
                    ] as [DetailTab, string][]
                  ).map(([k, label]) => (
                    <button key={k} className={`detail-tab${detailTab === k ? ' is-active' : ''}`} onClick={() => setDetailTab(k)}>
                      {label}
                    </button>
                  ))}
                </div>
                <WordDetail tab={detailTab} word={item.front} back={wordBack} morph={morph} similar={similar} />
              </div>
            )}

            {/* 兼容 back 不是词条 JSON 的极端情况：直接原样展示 */}
            {!wordBack && (
              <div className="review-back">
                <span className="muted">Answer</span>
                {item.back}
              </div>
            )}

            {commitErr && <div className="error-text" style={{ marginTop: 10 }}>{commitErr}</div>}

            {!choices && (
              <div className="grade-row">
                <button className="btn g-again" disabled={committing.current} onClick={() => selfGrade(1)}>
                  忘了<small>1</small>
                </button>
                <button className="btn g-hard" disabled={committing.current} onClick={() => selfGrade(2)}>
                  想起<small>2</small>
                </button>
                <button className="btn g-good" disabled={committing.current} onClick={() => selfGrade(3)}>
                  记得<small>3</small>
                </button>
                <button className="btn g-easy" disabled={committing.current} onClick={() => selfGrade(4)}>
                  秒答<small>4</small>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="action-bar">
        <button className="act" disabled={phase === 'front'} title="上一个（本版仅支持继续）">
          <ArrowLeft size={17} />
          上一词
        </button>
        <button className="act" title="斩：认识，移出计划" onClick={cutCard}>
          <Scissors size={17} />
          斩
        </button>
        <button
          className="act is-mid"
          title="查看词根词缀 / 形近词"
          onClick={() => {
            if (phase === 'front') return
            setShowDetail((v) => !v)
          }}
          disabled={phase === 'front'}
        >
          <Sparkles size={17} />
          辨析
        </button>
        <button className="act" title="提示中文" onClick={() => setShowHint((v) => !v)}>
          <Lightbulb size={17} />
          提示
        </button>
        <button className="act" title="朗读 (S)" onClick={() => speak(item.front)}>
          <Volume2 size={17} />
          朗读
        </button>
        {choices ? (
          <button className="act is-primary" disabled={phase === 'front'} onClick={advance} title="继续 (⏎)">
            继续
            <ArrowRight size={15} />
          </button>
        ) : (
          <button className="act is-primary" disabled={phase === 'front'} onClick={() => selfGrade(3)} title="记得并继续">
            继续
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

/** 例句里高亮目标词 */
function highlightWord(sentence: string, word: string) {
  const parts = sentence.split(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)`, 'gi'))
  return parts.map((p, i) =>
    p.toLowerCase().startsWith(word.toLowerCase()) ? <em key={i}>{p}</em> : <span key={i}>{p}</span>
  )
}

/** 详情面板：释义 / 例句 / 词根词缀 / 形近词 */
function WordDetail({
  tab,
  word,
  back,
  morph,
  similar,
}: {
  tab: DetailTab
  word: string
  back: WordBack
  morph: { parts: { text: string; label: string; kind: string }[]; note: string } | null
  similar: { w: string; t: string }[] | null
}) {
  const [sentTab, setSentTab] = useState<'sent' | 'form' | 'more'>('sent')

  if (tab === 'sense') {
    return (
      <div className="detail-panel">
        {(back.m || []).map((m, i) => (
          <div className="sense-row" key={i} style={{ marginTop: i ? 8 : 0 }}>
            {m.p && <i className="sense-pos">{m.p}.</i>}
            <span>{m.t}</span>
          </div>
        ))}
        {!back.m?.length && <div className="muted">暂无释义</div>}
        {back.s?.[0] && (
          <div className="sent-row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div className="sent-en">{highlightWord(back.s[0].e, word)}</div>
            <div className="sent-cn">{back.s[0].c}</div>
          </div>
        )}
      </div>
    )
  }

  if (tab === 'sent') {
    return (
      <div className="detail-panel">
        <div className="mini-tabs">
          {(
            [
              ['sent', '例句'],
              ['form', '变形·派生'],
              ['more', '延展'],
            ] as ['sent' | 'form' | 'more', string][]
          ).map(([k, label]) => (
            <button key={k} className={`mini-tab${sentTab === k ? ' is-active' : ''}`} onClick={() => setSentTab(k)}>
              {label}
            </button>
          ))}
        </div>
        {sentTab === 'sent' &&
          (back.s?.length ? (
            back.s.map((s, i) => (
              <div className="sent-row" key={i}>
                <div className="sent-en">{highlightWord(s.e, word)}</div>
                <div className="sent-cn">{s.c}</div>
              </div>
            ))
          ) : (
            <div className="muted">该词暂无例句数据</div>
          ))}
        {sentTab === 'form' && (
          <div>
            <div className="muted">由词根词缀推导的常见变形（离线推导，供参考）：</div>
            <div className="chip-row">
              {deriveForms(word).map((f) => (
                <span className="chip" key={f}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
        {sentTab === 'more' && (
          <div>
            <div className="muted">搭配与用法提示：</div>
            <div className="chip-row">
              <span className="chip">in {word}</span>
              <span className="chip">{word} of</span>
              <span className="chip">be {word} to</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (tab === 'morph') {
    return (
      <div className="detail-panel">
        {morph ? (
          <>
            <div className="morph-line">
              {morph.parts.map((p, i) => (
                <span key={i} className={`morph-part${p.kind === 'root' ? ' is-root' : p.kind === 'suffix' ? ' is-suffix' : ''}`}>
                  <b>{p.text}</b>
                  <small>{p.label}</small>
                </span>
              ))}
            </div>
            <div className="morph-note">{morph.note}</div>
          </>
        ) : (
          <div className="muted">这个单词没有匹配到离线词根词缀数据。可以试着按音节拆开读几遍，或加入生词本反复见它。</div>
        )}
      </div>
    )
  }

  return (
    <div className="detail-panel">
      {similar === null ? (
        <div className="muted">正在从 14,625 词索引里找形近词…</div>
      ) : similar.length === 0 ? (
        <div className="muted">索引里没有找到编辑距离 ≤2 的形近词，说明这个词拼写比较独特。</div>
      ) : (
        <>
          <div className="muted" style={{ marginBottom: 8 }}>拼写相近，容易看错（编辑距离 ≤ 2）：</div>
          {similar.map((s) => (
            <div className="sense-row" key={s.w} style={{ marginTop: 7 }}>
              <b style={{ minWidth: 92 }}>{s.w}</b>
              <span style={{ color: 'var(--ink-2)' }}>{s.t || '—'}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/** 由词形推导常见变形（离线启发式，供「变形·派生」tab 展示） */
function deriveForms(word: string): string[] {
  const w = word.toLowerCase()
  const out = new Set<string>()
  if (w.endsWith('e')) {
    out.add(w + 'd')
    out.add(w.slice(0, -1) + 'ing')
  } else if (/[^aeiou][aeiou][^aeiouy]$/.test(w)) {
    out.add(w + w.slice(-1) + 'ed')
    out.add(w + w.slice(-1) + 'ing')
  } else {
    out.add(w + 'ed')
    out.add(w + 'ing')
  }
  out.add(w + 's')
  if (w.endsWith('y')) out.add(w.slice(0, -1) + 'ies')
  if (w.endsWith('e')) out.add(w.slice(0, -1) + 'er')
  else out.add(w + 'er')
  return [...out].filter((x) => x !== w).slice(0, 8)
}
