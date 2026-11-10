import { Puzzle, PuzzleResult } from "@/types/training";
import { getFenKey } from "./puzzles";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Leitner box intervals, in days (box 0 = new) */
export const BOX_INTERVALS_DAYS = [0, 1, 3, 7, 14, 30, 60];
const MAX_BOX = BOX_INTERVALS_DAYS.length - 1;

/** Solved with hints: comes back tomorrow */
const HINTED_INTERVAL_DAYS = 1;
/** Failed: comes back "after a few days" */
const FAILED_INTERVAL_DAYS = 3;

/** New puzzles introduced per day */
export const DEFAULT_NEW_PER_DAY = 10;

/** Box and due date after an attempt */
export const schedulePuzzle = (
  box: number,
  result: PuzzleResult,
  now: number
): { box: number; dueAt: number } => {
  switch (result) {
    case "clean": {
      const next = Math.min(box + 1, MAX_BOX);
      return { box: next, dueAt: now + BOX_INTERVALS_DAYS[next] * DAY_MS };
    }
    case "hinted":
      return {
        box: Math.max(box, 1),
        dueAt: now + HINTED_INTERVAL_DAYS * DAY_MS,
      };
    case "failed":
      return { box: 1, dueAt: now + FAILED_INTERVAL_DAYS * DAY_MS };
  }
};

/** The puzzle after an attempt: new schedule plus attempt history */
export const applyPuzzleAttempt = (
  puzzle: Puzzle,
  result: PuzzleResult,
  now: number
): Puzzle => ({
  ...puzzle,
  ...schedulePuzzle(puzzle.box, result, now),
  attempts: puzzle.attempts + 1,
  firstAttemptAt: puzzle.firstAttemptAt ?? now,
  lastAttemptAt: now,
  lastResult: result,
});

export const startOfDay = (now: number) => {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export interface PuzzleQueue {
  /** Puzzles to solve now, in order: due reviews, then today's new puzzles */
  queue: Puzzle[];
  dueCount: number;
  /** New puzzles in the queue today */
  newCount: number;
  /** New puzzles not yet introduced (over today's cap, or duplicates) */
  newRemaining: number;
  /** Next review after the queue is done, if any */
  nextDueAt?: number;
}

const byNewestGame = (a: Puzzle, b: Puzzle) =>
  (b.endTime ?? 0) - (a.endTime ?? 0) || b.gameId - a.gameId || a.ply - b.ply;

/**
 * Due reviews (oldest due first), then new puzzles (newest game first) up to
 * the daily cap. A new puzzle whose position is already in the queue (the
 * same mistake in another game) waits for another day.
 */
export const buildPuzzleQueue = (
  puzzles: Puzzle[],
  now: number,
  newPerDay = DEFAULT_NEW_PER_DAY
): PuzzleQueue => {
  const due = puzzles
    .filter((p) => p.box > 0 && p.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);

  const today = startOfDay(now);
  const introducedToday = puzzles.filter(
    (p) => p.firstAttemptAt !== undefined && p.firstAttemptAt >= today
  ).length;
  const newSlots = Math.max(0, newPerDay - introducedToday);

  const seen = new Set(due.map((p) => getFenKey(p.fen)));
  const allNew = puzzles.filter((p) => p.box === 0).sort(byNewestGame);
  const fresh: Puzzle[] = [];
  for (const puzzle of allNew) {
    if (fresh.length >= newSlots) break;
    const key = getFenKey(puzzle.fen);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(puzzle);
  }

  const queuedIds = new Set([...due, ...fresh].map((p) => p.id));
  const later = puzzles
    .filter((p) => p.box > 0 && !queuedIds.has(p.id))
    .map((p) => p.dueAt);

  return {
    queue: [...due, ...fresh],
    dueCount: due.length,
    newCount: fresh.length,
    newRemaining: allNew.length - fresh.length,
    nextDueAt: later.length ? Math.min(...later) : undefined,
  };
};
