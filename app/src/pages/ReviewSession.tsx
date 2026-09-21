import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Check, X, Volume2 } from 'lucide-react'
import { getDb, loadQueue, loadSession, loadQueueByIds, saveSession, clearSession, nowIso, isTauri, type QueueItem } from '../db'
import { schedule, R } from '../fsrs'

type Phase = 'front' | 'answered'

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
/** Tauri WebView2 内置 SpeechSynthesis 朗读单词 */
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

export default function ReviewSession({ initialQueue }: { initialQueue?: QueueItem[] }) {
  const nav = useNavigate()
  const [queue, setQueue] = useState<QueueItem[]>(initialQueue ?? [])
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('front')
  const [picked, setPicked] = useState<number | null>(null)
  const [done, setDone] = useState<{ total: number; again: number; ms: number } | null>(null)
  const shownAt = useRef<number>(Date.now())
  const sessionStart = useRef<number>(Date.now())
  const againCount = useRef<number>(0)
  const doneCount = useRef<number>(0)
  const [loading, setLoading] = useState(true)
  const [fs, setFs] = useState(false)
  const [resumed, setResumed] = useState(false)
  // 提交中标记 / 提交错误（必须在所有条件 return 之前声明——React hooks 数量每帧必须一致）
  const committing = useRef(false)
  const [commitErr, setCommitErr] = useState('')
  /** 全屏开关：开始学习 → 窗口全屏（自绘标题栏自动隐藏）；退出/完成 → 恢复 */
  const enterFs = () => {
    if (isTauri()) getCurrentWindow().setFullscreen(true).catch(() => {})
  }
  const exitFs = () => {
    if (isTauri()) getCurrentWindow().setFullscreen(false).catch(() => {})
  }
  useEffect(() => {
    enterFs()
    if (isTauri()) {
      const win = getCurrentWindow()
      const p = win.onResized(async () => {
        try { setFs(await win.isFullscreen()) } catch {}
      })
      return () => {
        exitFs()
        p.then((f) => f()).catch(() => {})
      }
    }
    return () => exitFs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        // 外部队列（词书专学）：直接使用，不走快照恢复
        if (initialQueue && initialQueue.length) {
          await saveSession(initialQueue.map((x) => x.id), 0).catch(() => {})
          shownAt.current = Date.now()
          setLoading(false)
          return
        }
        // 断点续学：有上次中断的会话就按快照恢复（否则正常组队）
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        exitFs()
        nav('/today')
        return
      }
      const item = queue[idx]
      if (!item || done || committingRef.current) return
      const hasChoices = !!item.choices_json
      if (phase === 'front' && e.code === 'Space') {
        e.preventDefault()
        if (hasChoices) return
        setPhase('answered')
        return
      }
      if (phase === 'answered' && !hasChoices && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        selfGrade(Number(e.key) as 1 | 2 | 3 | 4)
        return
      }
      // 单词卡：S 朗读（正面/背面均可）
      if (item.type === 'word' && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        try {
          const u = new SpeechSynthesisUtterance(item.front)
          u.lang = 'en-US'
          u.rate = 0.92
          speechSynthesis.cancel()
          speechSynthesis.speak(u)
        } catch {
          /* ignore */
        }
        return
      }
      if (phase === 'front' && hasChoices && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        pickChoice(Number(e.key) - 1)
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
  }, [queue, idx, phase, done])

  if (loading) return <div className="muted">···</div>

  if (done || queue.length === 0) {
    const s = done || { total: 0, again: 0, ms: 0 }
    return (
      <div className="review-stage page-in">
        <div className="kicker">SESSION / DONE</div>
        <div className="page-title" style={{ marginBottom: 20 }}>
          {queue.length === 0 && !done ? '没有待学习的卡片' : '完成'}
        </div>
        {done && (
          <div className="card" style={{ display: 'flex', gap: 26, alignItems: 'baseline', padding: '26px 30px' }}>
            <div>
              <div className="display-num" style={{ fontSize: 44 }}>{s.total}</div>
              <div className="muted" style={{ fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: 1 }}>张完成</div>
            </div>
            <div style={{ width: 1, height: 42, background: 'var(--line)' }} />
            <span className="tag">{s.again} 次忘了</span>
            <span className="tag">{Math.round(s.ms / 1000)}s</span>
          </div>
        )}
        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => { exitFs(); nav('/today') }}>回到今日</button>
          {fs && (
            <button className="btn" onClick={exitFs}>
              退出全屏
            </button>
          )}
          {queue.length === 0 && !done && (
            <button className="btn" onClick={() => { exitFs(); nav('/courses') }}>去生成卡片</button>
          )}
        </div>
        {done && (
          <div className="today-hint fade-up" style={{ marginTop: 16 }}>
            <span className="dot" />
            学习记录已保存，下次打开软件接着安排
          </div>
        )}
      </div>
    )
  }

  const item = queue[idx]
  const choices: string[] | null = (() => {
    if (!item.choices_json) return null
    try {
      const arr = JSON.parse(item.choices_json)
      return Array.isArray(arr) && arr.length >= 2 ? arr : null
    } catch {
      return null // 脏数据降级为普通回忆卡
    }
  })()

  // 提交中标记已在组件顶部声明（hooks 规则：不能在条件 return 之后声明）
  const committingRef = committing

  const commit = async (grade: number): Promise<boolean> => {
    const db = await getDb()
    const { next } = schedule(item.st, grade as 1 | 2 | 3 | 4)
    const row = { ...next, card_id: item.id }
    await db.execute('BEGIN')
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
      ])
      await db.execute('COMMIT')
      return true
    } catch (e) {
      await db.execute('ROLLBACK').catch(() => {})
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

  const pickChoice = (i: number) => {
    if (phase === 'answered' || committing.current) return
    committing.current = true
    setPicked(i)
    setPhase('answered')
    const g = i === (item.answer_index ?? 0) ? R.Good : R.Again
    void (async () => {
      const ok = await commit(g)
      if (!ok) {
        committing.current = false
        return
      }
      if (i !== (item.answer_index ?? 0)) againCount.current++
      doneCount.current++
      // 提交即推进快照位置，杜绝「已评分未前进」窗口内关软件导致的重复评分
      await saveSession(queue.map((x) => x.id), Math.min(idx + 1, queue.length), doneCount.current, againCount.current).catch(() => {})
      committing.current = false
    })()
  }

  const selfGrade = (g: 1 | 2 | 3 | 4) => {
    if (committing.current) return
    committing.current = true
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

  const isWord = item.type === 'word'
  const wordBack = isWord ? parseWordBack(item.back) : null

  return (
    <div className={`review-stage${fs ? ' review-fs' : ''}`}>
      <div className="review-top">
        <div className="review-progress">
          <span className="review-progress-num">{String(idx + 1).padStart(2, '0')} / {String(queue.length).padStart(2, '0')}</span>
          <div className="bar">
            <span className="seg-gold" style={{ width: `${((idx + 1) / queue.length) * 100}%` }} />
          </div>
        </div>
        <span className="review-loc">{item.course_name} · {item.topic_title}</span>
        {resumed && (
          <span className="tag tag-mono" style={{ marginRight: 8 }} title="从中断处继续">已续</span>
        )}
        <button className="review-exit" title="退出学习（Esc）" onClick={() => { exitFs(); nav('/today') }}>
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      <div className="review-card" key={`${item.id}-${idx}`}>
        <div className="review-kind">
          <span className="tag tag-mono">
            {isWord ? 'WORD' : item.type === 'basic' ? 'RECALL' : item.type === 'why' ? 'WHY' : 'CHOICE'}
          </span>
        </div>

        {isWord ? (
          <div className="word-front">
            <div className="word-term">{item.front}</div>
            <div className="word-phones">
              {wordBack?.uk && <span className="word-phone">UK /{wordBack.uk}/</span>}
              {wordBack?.us && <span className="word-phone">US /{wordBack.us}/</span>}
              <button className="word-speak" title="朗读 (S)" onClick={() => speak(item.front)}>
                <Volume2 size={14} strokeWidth={1.8} />
              </button>
            </div>
          </div>
        ) : (
          <div className="review-front">{item.front}</div>
        )}

        {isWord && phase === 'front' && (
          <div className="review-hint">
            先回忆词义 · <kbd>空格</kbd> 翻面 · <kbd>S</kbd> 朗读
          </div>
        )}

        {choices && (
          <div style={{ marginTop: 16 }}>
            {choices.map((c, i) => {
              const revealed = phase === 'answered'
              const isRight = i === (item.answer_index ?? 0)
              const cls = revealed ? (isRight ? 'right' : i === picked ? 'wrong' : 'dim') : ''
              return (
                <button key={i} className={`choice-btn ${cls}`} onClick={() => !revealed && pickChoice(i)}>
                  <span className="choice-key">{i + 1}</span>
                  <span style={{ flex: 1 }}>{c}</span>
                  {revealed && isRight && <Check size={15} style={{ color: 'var(--green)' }} />}
                  {revealed && i === picked && !isRight && <X size={15} style={{ color: 'var(--red)' }} />}
                </button>
              )
            })}
          </div>
        )}

        {choices && phase === 'front' && (
          <div className="review-hint">点击选项，或按 <kbd>1</kbd>-<kbd>4</kbd> 作答</div>
        )}

        {!choices && phase === 'front' && (
          <>
            <div style={{ marginTop: 24 }}>
              <button className="btn btn-primary btn-lg" onClick={() => setPhase('answered')}>
                显示答案
              </button>
            </div>
            <div className="review-hint">
              先回忆 · <kbd>空格</kbd> 翻面
            </div>
          </>
        )}

        {phase === 'answered' && (
          <div>
            {isWord && wordBack ? (
              <div className="word-back">
                <div className="word-senses">
                  {wordBack.m?.map((m, i) => (
                    <div className="word-sense" key={i}>
                      {m.p && <i className="word-pos">{m.p}.</i>}
                      <span>{m.t}</span>
                    </div>
                  ))}
                </div>
                {wordBack.s && wordBack.s.length > 0 && (
                  <div className="word-sents">
                    {wordBack.s.map((s, i) => (
                      <div className="word-sent" key={i}>
                        <div className="word-sent-e">{s.e}</div>
                        <div className="word-sent-c">{s.c}</div>
                      </div>
                    ))}
                  </div>
                )}
                <button className="word-speak word-speak-lg" title="朗读 (S)" onClick={() => speak(item.front)}>
                  <Volume2 size={15} strokeWidth={1.8} /> 再听一次
                </button>
              </div>
            ) : (
              <div className="review-back">
                <span className="muted">Answer</span>
                {item.back}
              </div>
            )}
            {!isWord && (
              <div className="explain-box">
                <b>Why</b>
                {item.explanation}
              </div>
            )}
            {commitErr && <div className="error-text" style={{ marginTop: 10 }}>{commitErr}</div>}
            {choices ? (
              <div style={{ marginTop: 18 }}>
                <button className="btn btn-primary" onClick={advance}>
                  {idx + 1 >= queue.length ? '完成' : '下一张'} <kbd className="kbd-in-gold">⏎</kbd>
                </button>
              </div>
            ) : (
              <div className="grade-row">
                <button className="btn g-again" disabled={committing.current} onClick={() => selfGrade(1)}>忘了<small>1</small></button>
                <button className="btn g-hard" disabled={committing.current} onClick={() => selfGrade(2)}>想起<small>2</small></button>
                <button className="btn g-good" disabled={committing.current} onClick={() => selfGrade(3)}>记得<small>3</small></button>
                <button className="btn g-easy" disabled={committing.current} onClick={() => selfGrade(4)}>秒答<small>4</small></button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
