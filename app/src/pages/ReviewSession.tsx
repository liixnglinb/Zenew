import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { getDb, loadQueue, nowIso, type QueueItem } from '../db'
import { schedule, R } from '../fsrs'

type Phase = 'front' | 'answered'

export default function ReviewSession() {
  const nav = useNavigate()
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [idx, setIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('front')
  const [picked, setPicked] = useState<number | null>(null)
  const [done, setDone] = useState<{ total: number; again: number; ms: number } | null>(null)
  const shownAt = useRef<number>(Date.now())
  const sessionStart = useRef<number>(Date.now())
  const againCount = useRef<number>(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const newLimit = Number(localStorage.getItem('zenew_new_limit') || '10') || 10
      const q = await loadQueue(nowIso(), newLimit)
      setQueue(q)
      setLoading(false)
      shownAt.current = Date.now()
    })()
  }, [])

  // 键盘流：空格显示答案，1-4 打分，1-4 也可选选项，回车下一张
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const item = queue[idx]
      if (!item || done) return
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

  if (loading) return <div className="muted">载入中…</div>

  if (done || queue.length === 0) {
    const s = done || { total: 0, again: 0, ms: 0 }
    return (
      <div className="review-stage">
        <div className="page-title" style={{ marginBottom: 16 }}>
          {queue.length === 0 && !done ? '没有待学习的卡片' : '本次学习完成'}
        </div>
        {done && (
          <div className="card">
            <div style={{ display: 'flex', gap: 28, alignItems: 'baseline' }}>
              <div>
                <div className="display-num" style={{ fontSize: 42 }}>{s.total}</div>
                <div className="muted">张完成</div>
              </div>
              <div style={{ width: 1, height: 40, background: 'var(--line)' }} />
              <div style={{ display: 'flex', gap: 20, color: 'var(--ink-2)', fontSize: 13 }}>
                <span>标记「忘了」 {s.again}</span>
                <span>用时 {Math.round(s.ms / 1000)} 秒</span>
              </div>
            </div>
            <div className="muted" style={{ marginTop: 14, fontSize: 12.5 }}>
              标记「忘了」不是失败——这正是调度器判断「什么时候该再见到你」的依据。
            </div>
          </div>
        )}
        {queue.length === 0 && !done && <div className="muted">先去课程页生成一些卡片吧。</div>}
        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => nav('/today')}>回到今日</button>
          <button className="btn" onClick={() => nav('/courses')}>继续生成卡片</button>
        </div>
      </div>
    )
  }

  const item = queue[idx]
  const choices: string[] | null = item.choices_json ? JSON.parse(item.choices_json) : null

  const commit = async (grade: number) => {
    const db = await getDb()
    const { next } = schedule(item.st, grade as 1 | 2 | 3 | 4)
    const row = { ...next, card_id: item.id }
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
  }

  const advance = () => {
    if (idx + 1 >= queue.length) {
      setDone({ total: queue.length, again: againCount.current, ms: Date.now() - sessionStart.current })
    } else {
      setIdx(idx + 1)
      setPhase('front')
      setPicked(null)
      shownAt.current = Date.now()
    }
  }

  const pickChoice = (i: number) => {
    if (phase === 'answered') return
    setPicked(i)
    setPhase('answered')
    void commit(i === (item.answer_index ?? 0) ? R.Good : R.Again)
    if (i !== (item.answer_index ?? 0)) againCount.current++
  }

  const selfGrade = (g: 1 | 2 | 3 | 4) => {
    void commit(g)
    if (g === R.Again) againCount.current++
    advance()
  }

  return (
    <div className="review-stage">
      <div className="review-top">
        <div className="review-progress">
          <span className="review-progress-num">{idx + 1} / {queue.length}</span>
          <div className="bar">
            <span className="seg-teal" style={{ width: `${((idx + 1) / queue.length) * 100}%` }} />
          </div>
        </div>
        <span className="review-loc">{item.course_name} · {item.topic_title}</span>
      </div>

      <div className="review-card">
        <div className="review-kind">
          <span className="tag tag-plain">
            {item.type === 'basic' ? '回忆' : item.type === 'why' ? '解释' : '选择'}
          </span>
        </div>

        <div className="review-front">{item.front}</div>

        {choices && (
          <div style={{ marginTop: 14 }}>
            {choices.map((c, i) => {
              const revealed = phase === 'answered'
              const isRight = i === (item.answer_index ?? 0)
              const cls = revealed ? (isRight ? 'right' : i === picked ? 'wrong' : 'dim') : ''
              return (
                <button
                  key={i}
                  className={`choice-btn ${cls}`}
                  onClick={() => !revealed && pickChoice(i)}
                >
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
            <div style={{ marginTop: 22 }}>
              <button className="btn btn-primary btn-lg" onClick={() => setPhase('answered')}>
                显示答案
              </button>
            </div>
            <div className="review-hint">
              先在脑子里回忆，再按 <kbd>空格</kbd> 核对
            </div>
          </>
        )}

        {phase === 'answered' && (
          <div>
            <div className="review-back">
              <span className="muted">答案</span>
              {item.back}
            </div>
            <div className="explain-box">
              <b>为什么</b>　{item.explanation}
            </div>
            {choices ? (
              <div style={{ marginTop: 16 }}>
                <button className="btn btn-primary" onClick={advance}>
                  {idx + 1 >= queue.length ? '完成' : '下一张'} <kbd style={{ background: '#fff', borderColor: 'var(--line)' }}>⏎</kbd>
                </button>
              </div>
            ) : (
              <div className="grade-row">
                <button className="btn g-again" onClick={() => selfGrade(1)}>
                  忘了<small><kbd>1</kbd></small>
                </button>
                <button className="btn g-hard" onClick={() => selfGrade(2)}>
                  想起来了<small><kbd>2</kbd></small>
                </button>
                <button className="btn g-good" onClick={() => selfGrade(3)}>
                  记得<small><kbd>3</kbd></small>
                </button>
                <button className="btn g-easy" onClick={() => selfGrade(4)}>
                  秒答<small><kbd>4</kbd></small>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
