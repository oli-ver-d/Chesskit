import { describe, expect, it } from "vitest";
import { Color, MoveClassification } from "@/types/enums";
import {
  GameDigest,
  GamePhase,
  GameResultForMe,
  MoveDigest,
  Puzzle,
} from "@/types/training";
import { computeInsights, getFindingsKey, getOpeningFamily } from "./insights";

interface GameOptions {
  id: number;
  color?: Color;
  result?: GameResultForMe;
  opening?: string;
  timeClass?: string;
  accuracy?: number;
  /** Number of full moves; you play every other ply */
  length?: number;
  /** Per your move (by move number): overrides */
  move?: (moveNumber: number) => Partial<MoveDigest>;
}

const phaseOf = (moveNumber: number): GamePhase =>
  moveNumber <= 10 ? "opening" : moveNumber <= 35 ? "middlegame" : "endgame";

const game = ({
  id,
  color = Color.White,
  result = "win",
  opening = "Italian Game Two Knights Defense",
  timeClass = "blitz",
  accuracy = 80,
  length = 40,
  move,
}: GameOptions): GameDigest => {
  const moves: MoveDigest[] = [];
  for (let ply = 0; ply < length * 2; ply++) {
    const moveColor = ply % 2 === 0 ? Color.White : Color.Black;
    const moveNumber = Math.floor(ply / 2) + 1;
    const isMine = moveColor === color;
    moves.push({
      ply,
      moveNumber,
      color: moveColor,
      isMine,
      fenBefore: "8/8/8/8/8/8/8/8 w - - 0 1",
      uci: "a1a2",
      san: "Ra2",
      classification: MoveClassification.Best,
      winBefore: 50,
      winAfter: 49,
      phase: phaseOf(moveNumber),
      ...(isMine && move ? move(moveNumber) : {}),
    });
  }
  return {
    gameId: id,
    version: 3,
    myColor: color,
    evalDate: "2026-11-01",
    endTime: id * 1000,
    accuracy,
    result,
    openingName: opening,
    timeClass,
    moves,
  };
};

const blunder: Partial<MoveDigest> = {
  classification: MoveClassification.Blunder,
  winBefore: 60,
  winAfter: 20,
};

const games = (n: number, options: Omit<GameOptions, "id">, from = 1) =>
  Array.from({ length: n }, (_, i) => game({ id: from + i, ...options }));

const puzzle = (overrides: Partial<Puzzle>): Puzzle => ({
  id: "1:0",
  gameId: 1,
  ply: 0,
  fen: "8/8/8/8/8/8/8/8 w - - 0 1",
  myColor: Color.White,
  bestUci: "a1a3",
  acceptUci: ["a1a3"],
  playedUci: "a1a2",
  kind: "blunder",
  themes: ["middlegame"],
  winBefore: 60,
  winAfter: 20,
  box: 0,
  dueAt: 0,
  createdAt: 0,
  attempts: 0,
  ...overrides,
});

const ids = (insights: ReturnType<typeof computeInsights>) =>
  insights.findings.map((f) => f.id);

describe("getOpeningFamily", () => {
  it("groups variations under their family", () => {
    expect(getOpeningFamily("Sicilian Defense Old Sicilian")).toBe(
      "Sicilian Defense"
    );
    expect(getOpeningFamily("Queens Pawn Opening Accelerated London")).toBe(
      "Queens Pawn Opening"
    );
    expect(getOpeningFamily("Ruy Lopez: Berlin Defense")).toBe("Ruy Lopez");
    expect(getOpeningFamily("Kings Gambit Accepted")).toBe("Kings Gambit");
    expect(getOpeningFamily(undefined)).toBe("Unknown opening");
  });
});

describe("computeInsights", () => {
  it("handles no games", () => {
    const insights = computeInsights({ digests: [], puzzles: [] });
    expect(insights.games).toBe(0);
    expect(insights.findings).toEqual([]);
    expect(insights.byClock).toEqual([]);
  });

  it("splits your moves by phase and move number", () => {
    const insights = computeInsights({
      digests: games(2, { length: 40 }),
      puzzles: [],
    });
    expect(insights.moves).toBe(80);
    expect(insights.byPhase.map((p) => p.moves)).toEqual([20, 50, 10]);
    expect(insights.byMoveBucket.map((b) => b.moves)).toEqual([
      20, 20, 20, 20, 0,
    ]);
    expect(insights.byMoveBucket[0].avgLoss).toBe(1);
    expect(insights.overall.score).toBe(100);
  });

  it("skips forced moves and the opponent's moves", () => {
    const insights = computeInsights({
      digests: [
        game({
          id: 1,
          length: 10,
          move: (n) =>
            n === 5 ? { classification: MoveClassification.Forced } : {},
        }),
      ],
      puzzles: [],
    });
    expect(insights.moves).toBe(9);
  });

  it("finds the phase where you blunder most, with evidence and puzzles", () => {
    const digests = games(4, {
      move: (n) => (n === 15 || n === 20 ? blunder : {}),
    });
    const insights = computeInsights({
      digests,
      puzzles: [puzzle({ id: "1:28", gameId: 1, ply: 28 })],
    });

    const finding = insights.findings.find(
      (f) => f.id === "phaseBlunders:middlegame"
    );
    expect(finding).toMatchObject({
      title: "You blunder most in the middlegame",
      metric: 8,
      baseline: 0,
      unit: "per100",
      sample: 100,
      puzzleIds: ["1:28"],
    });
    expect(finding?.evidence).toHaveLength(8);
    expect(finding?.evidence[0]).toMatchObject({ loss: 40, san: "Ra2" });
  });

  it("doesn't report a phase with too few blunders or moves", () => {
    const insights = computeInsights({
      digests: games(1, { move: (n) => (n === 15 ? blunder : {}) }),
      puzzles: [],
    });
    expect(ids(insights)).not.toContain("phaseBlunders:middlegame");
  });

  it("finds a late-game drop", () => {
    const insights = computeInsights({
      digests: games(3, {
        length: 45,
        move: (n) => (n > 30 ? { winBefore: 60, winAfter: 55 } : {}),
      }),
      puzzles: [],
    });
    const finding = insights.findings.find((f) => f.id === "lateGameDrop");
    expect(finding).toMatchObject({ metric: 5, baseline: 1, unit: "loss" });
    expect(finding?.severity).toBe("high");
  });

  it("finds an opening you score badly in", () => {
    const digests = [
      ...games(6, { opening: "Sicilian Defense Najdorf", result: "loss" }),
      ...games(10, { opening: "Italian Game" }, 7),
    ];
    const insights = computeInsights({ digests, puzzles: [] });
    const finding = insights.findings.find(
      (f) => f.id === "openingScore:w:Sicilian Defense"
    );
    expect(finding).toMatchObject({
      title: "You struggle in the Sicilian Defense as White",
      metric: 0,
      baseline: 62.5,
      sample: 6,
    });
    expect(insights.byOpening[0]).toMatchObject({
      family: "Italian Game",
      games: 10,
      score: 100,
    });
  });

  it("compares accuracy by colour and time class", () => {
    const digests = [
      ...games(8, { color: Color.Black, accuracy: 70, timeClass: "bullet" }),
      ...games(8, { accuracy: 85, timeClass: "rapid" }, 9),
    ];
    const found = ids(computeInsights({ digests, puzzles: [] }));
    expect(found).toContain("segmentAccuracy:b");
    expect(found).toContain("segmentAccuracy:bullet");
    expect(found).not.toContain("segmentAccuracy:w");
  });

  it("finds winning positions you didn't convert", () => {
    const winning = (n: number) =>
      n === 20
        ? { winAfter: 90 }
        : n === 21
          ? { winBefore: 85, winAfter: 30 }
          : {};
    const digests = [
      ...games(4, { result: "loss", move: winning }),
      ...games(2, { result: "win", move: winning }, 5),
      ...games(4, { result: "loss" }, 7),
    ];
    const insights = computeInsights({ digests, puzzles: [] });
    expect(insights.conversion).toMatchObject({ games: 6, wins: 2 });
    const finding = insights.findings.find((f) => f.id === "conversion");
    expect(finding?.detail).toContain("won only 2");
    // Your worst move after reaching the winning position, in a lost game
    expect(finding?.evidence[0].moveNumber).toBe(21);
  });

  it("finds blunders in time trouble", () => {
    const digests = games(4, {
      length: 30,
      move: (n) =>
        n > 20
          ? { clockAfter: 20, ...(n % 2 ? blunder : {}) }
          : { clockAfter: 300 },
    });
    const insights = computeInsights({ digests, puzzles: [] });
    expect(insights.byClock.map((c) => c.moves)).toEqual([36, 0, 80]);
    const finding = insights.findings.find((f) => f.id === "timeTrouble");
    expect(finding?.detail).toContain("less than 30 seconds");

    const daily = computeInsights({
      digests: digests.map((d) => ({ ...d, timeClass: "daily" })),
      puzzles: [],
    });
    expect(daily.byClock).toEqual([]);
  });

  it("finds your most common puzzle theme and the ones you can't solve", () => {
    const digests = games(1, {});
    const puzzles = Array.from({ length: 6 }, (_, i) =>
      puzzle({
        id: `1:${i * 2}`,
        ply: i * 2,
        themes: i < 5 ? ["hung-piece", "opening"] : ["missed-mate", "opening"],
      })
    );
    const log = [
      ...Array.from({ length: 6 }, (_, i) => ({
        kind: "puzzle" as const,
        at: i,
        refId: "1:0",
        success: i === 0,
        data: { themes: ["hung-piece"] },
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        kind: "puzzle" as const,
        at: i,
        refId: "1:10",
        success: true,
      })),
    ];
    const insights = computeInsights({ digests, puzzles, log });

    expect(insights.themes[0]).toMatchObject({
      theme: "hung-piece",
      puzzles: 5,
      attempts: 6,
      solved: 1,
    });
    expect(insights.puzzleSolveRate).toBeCloseTo(58.3, 1);
    const found = insights.findings.map((f) => f.id);
    expect(found).toContain("theme:hung-piece");
    expect(found).toContain("themeSolve:hung-piece");
    expect(found).not.toContain("themeSolve:missed-mate");
  });

  it("ranks findings and keys them for the coach cache", () => {
    const digests = [
      ...games(6, { opening: "Sicilian Defense", result: "loss" }),
      ...games(10, { opening: "Italian Game" }, 7),
    ];
    const insights = computeInsights({ digests, puzzles: [] });
    const scores = insights.findings.map((f) => f.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(getFindingsKey(insights)).toBe(
      "16|openingScore:w:Sicilian Defense=0/62.5"
    );
  });
});
