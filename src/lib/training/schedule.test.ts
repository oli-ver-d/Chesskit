import { describe, expect, it } from "vitest";
import { Color } from "@/types/enums";
import { Puzzle } from "@/types/training";
import {
  applyPuzzleAttempt,
  buildPuzzleQueue,
  DAY_MS,
  schedulePuzzle,
  startOfDay,
} from "./schedule";

const NOW = new Date(2026, 10, 10, 15).getTime();

const puzzle = (id: number, overrides: Partial<Puzzle> = {}): Puzzle => ({
  id: `${id}:1`,
  gameId: id,
  ply: 1,
  fen: `fen-${id} w - - 0 1`,
  myColor: Color.White,
  bestUci: "e2e4",
  acceptUci: ["e2e4"],
  playedUci: "d2d4",
  kind: "blunder",
  themes: [],
  winBefore: 60,
  winAfter: 20,
  endTime: id * 1000,
  box: 0,
  dueAt: 0,
  createdAt: 0,
  attempts: 0,
  ...overrides,
});

describe("schedulePuzzle", () => {
  it("moves a clean solve up one box", () => {
    expect(schedulePuzzle(0, "clean", NOW)).toEqual({
      box: 1,
      dueAt: NOW + DAY_MS,
    });
    expect(schedulePuzzle(3, "clean", NOW)).toEqual({
      box: 4,
      dueAt: NOW + 14 * DAY_MS,
    });
    expect(schedulePuzzle(6, "clean", NOW).box).toBe(6);
  });

  it("keeps the box after hints and brings it back tomorrow", () => {
    expect(schedulePuzzle(4, "hinted", NOW)).toEqual({
      box: 4,
      dueAt: NOW + DAY_MS,
    });
    expect(schedulePuzzle(0, "hinted", NOW).box).toBe(1);
  });

  it("drops a failed puzzle to box 1 for three days", () => {
    expect(schedulePuzzle(5, "failed", NOW)).toEqual({
      box: 1,
      dueAt: NOW + 3 * DAY_MS,
    });
  });
});

describe("applyPuzzleAttempt", () => {
  it("records the attempt history", () => {
    const first = applyPuzzleAttempt(puzzle(1), "failed", NOW);
    expect(first).toMatchObject({
      attempts: 1,
      firstAttemptAt: NOW,
      lastAttemptAt: NOW,
      lastResult: "failed",
    });
    const second = applyPuzzleAttempt(first, "clean", NOW + DAY_MS);
    expect(second).toMatchObject({
      box: 2,
      attempts: 2,
      firstAttemptAt: NOW,
      lastAttemptAt: NOW + DAY_MS,
    });
  });
});

describe("buildPuzzleQueue", () => {
  it("puts due reviews first, then new puzzles from the newest games", () => {
    const { queue, dueCount, newCount, nextDueAt } = buildPuzzleQueue(
      [
        puzzle(1),
        puzzle(2, { box: 2, dueAt: NOW - 10 }),
        puzzle(3),
        puzzle(4, { box: 1, dueAt: NOW - 1000 }),
        puzzle(5, { box: 1, dueAt: NOW + 50 }),
      ],
      NOW
    );
    expect(queue.map((p) => p.gameId)).toEqual([4, 2, 3, 1]);
    expect(dueCount).toBe(2);
    expect(newCount).toBe(2);
    expect(nextDueAt).toBe(NOW + 50);
  });

  it("caps new puzzles per day, counting ones started today", () => {
    const today = startOfDay(NOW);
    const puzzles = [
      ...[1, 2, 3, 4].map((id) => puzzle(id)),
      puzzle(9, { box: 1, dueAt: NOW + DAY_MS, firstAttemptAt: today + 1 }),
      puzzle(10, { box: 1, dueAt: NOW + DAY_MS, firstAttemptAt: today - 1 }),
    ];
    const { queue, newRemaining } = buildPuzzleQueue(puzzles, NOW, 3);
    expect(queue.map((p) => p.gameId)).toEqual([4, 3]);
    expect(newRemaining).toBe(2);
  });

  it("holds back a new puzzle whose position is already queued", () => {
    const { queue } = buildPuzzleQueue(
      [
        puzzle(1, { fen: "same w - - 0 9" }),
        puzzle(2, { fen: "same w - - 0 12", box: 1, dueAt: NOW }),
      ],
      NOW
    );
    expect(queue.map((p) => p.gameId)).toEqual([2]);
  });
});
