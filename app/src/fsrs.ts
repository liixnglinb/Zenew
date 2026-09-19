// FSRS 调度封装：ts-fsrs 官方实现（Anki 同款算法）
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs'
import type { StateRow } from './db'

const params = generatorParameters({ enable_fuzz: true })
const scheduler = fsrs(params)

export const R = Rating
export { State }

export function newCard(): Card {
  return createEmptyCard(new Date())
}

export function rowToCard(row: StateRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
    learning_steps: 0,
  }
}

export function cardToRow(cardId: number, card: Card): StateRow {
  return {
    card_id: cardId,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as number,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  }
}

export function schedule(row: StateRow | null, grade: Grade): { next: StateRow; logDue: string } {
  const card = row ? rowToCard(row) : newCard()
  const now = new Date()
  const result = scheduler.repeat(card, now)[grade]
  return { next: cardToRow(row ? row.card_id : 0, result.card), logDue: result.log.due.toISOString() }
}

export function isMastered(row: StateRow | null): boolean {
  // 掌握：进入 Review 态且稳定性 >= 21 天（约 3 周保持）
  return !!row && row.state === State.Review && row.stability >= 21
}

export function isLearning(row: StateRow | null): boolean {
  return !!row && !isMastered(row)
}
