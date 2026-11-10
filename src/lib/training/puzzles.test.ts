import { describe, expect, it } from "vitest";
import { Color, MoveClassification } from "@/types/enums";
import { GameDigest, MoveDigest } from "@/types/training";
import { extractPuzzles, getPuzzleId, mergeGamePuzzles } from "./puzzles";

// 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6: White mates with Qxf7#
const MATE_FEN =
  "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
// White's rook can take an undefended knight
const FREE_KNIGHT_FEN = "4k3/8/8/4n3/8/8/8/4R1K1 w - - 0 1";

const move = (overrides: Partial<MoveDigest>): MoveDigest => ({
  ply: 6,
  moveNumber: 4,
  color: Color.White,
  isMine: true,
  fenBefore: MATE_FEN,
  uci: "h5e5",
  san: "Qxe5+",
  classification: MoveClassification.Blunder,
  winBefore: 100,
  winAfter: 3,
  bestUci: "h5f7",
  secondBestGap: 30,
  phase: "opening",
  ...overrides,
});

const digest = (moves: MoveDigest[]): GameDigest => ({
  gameId: 7,
  version: 3,
  myColor: Color.White,
  evalDate: "2026-11-10",
  endTime: 1_000,
  moves,
});

describe("extractPuzzles", () => {
  it("turns a missed mate into a puzzle with themes", () => {
    const [puzzle, ...rest] = extractPuzzles(
      digest([move({ missedMate: true, hungPiece: "queen on e5" })]),
      50
    );

    expect(rest).toHaveLength(0);
    expect(puzzle).toMatchObject({
      id: "7:6",
      gameId: 7,
      ply: 6,
      fen: MATE_FEN,
      myColor: Color.White,
      bestUci: "h5f7",
      acceptUci: ["h5f7"],
      playedUci: "h5e5",
      kind: "blunder",
      box: 0,
      attempts: 0,
      createdAt: 50,
      endTime: 1_000,
    });
    expect(puzzle.themes).toEqual(["missed-mate", "hung-piece", "opening"]);
  });

  it("tags a missed capture and calls it a missed chance when you stayed fine", () => {
    const [puzzle] = extractPuzzles(
      digest([
        move({
          fenBefore: FREE_KNIGHT_FEN,
          uci: "g1f2",
          san: "Kf2",
          bestUci: "e1e5",
          winBefore: 95,
          winAfter: 60,
          classification: MoveClassification.Mistake,
          opponentErredPrev: true,
          phase: "endgame",
        }),
      ]),
      0
    );

    expect(puzzle.kind).toBe("missed-chance");
    expect(puzzle.themes).toEqual([
      "missed-capture",
      "missed-punish",
      "endgame",
    ]);
  });

  it("accepts stored alternatives and skips moves that were one of them", () => {
    const [puzzle] = extractPuzzles(digest([move({ altUci: ["h5e5x"] })]), 0);
    expect(puzzle.acceptUci).toEqual(["h5f7", "h5e5x"]);

    expect(
      extractPuzzles(digest([move({ altUci: ["h5e5"] })]), 0)
    ).toHaveLength(0);
  });

  it("skips moves that aren't puzzles", () => {
    const cases: Partial<MoveDigest>[] = [
      { isMine: false },
      { uci: "h5f7" },
      { bestUci: undefined },
      { winAfter: 90 }, // lost less than 15
      { winBefore: 8, winAfter: 0 }, // already lost
      { secondBestGap: 2 }, // many moves work
      { classification: MoveClassification.Opening },
      { classification: MoveClassification.Forced },
      { bestUci: "a1a8" }, // illegal
    ];
    for (const overrides of cases) {
      expect(extractPuzzles(digest([move(overrides)]), 0)).toHaveLength(0);
    }
  });

  it("keeps a missed mate even when other moves are also good", () => {
    expect(
      extractPuzzles(digest([move({ secondBestGap: 1, missedMate: true })]), 0)
    ).toHaveLength(1);
  });
});

describe("mergeGamePuzzles", () => {
  const [fresh] = extractPuzzles(digest([move({})]), 100);

  it("adds new puzzles and removes ones that no longer qualify", () => {
    const stale = { ...fresh, id: getPuzzleId(7, 20), ply: 20 };
    const { put, remove } = mergeGamePuzzles([stale], [fresh]);
    expect(put).toEqual([fresh]);
    expect(remove).toEqual(["7:20"]);
  });

  it("keeps the schedule of a regenerated puzzle", () => {
    const trained = {
      ...fresh,
      bestUci: "old",
      box: 3,
      dueAt: 999,
      createdAt: 1,
      attempts: 2,
      firstAttemptAt: 5,
      lastAttemptAt: 6,
      lastResult: "clean" as const,
    };
    const { put, remove } = mergeGamePuzzles([trained], [fresh]);
    expect(remove).toEqual([]);
    expect(put).toEqual([{ ...trained, bestUci: "h5f7" }]);
  });

  it("writes nothing when a puzzle didn't change", () => {
    expect(mergeGamePuzzles([fresh], [{ ...fresh, createdAt: 500 }])).toEqual({
      put: [],
      remove: [],
    });
  });
});
