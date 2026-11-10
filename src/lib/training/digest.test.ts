import { describe, expect, it } from "vitest";
import { buildGameDigest, DIGEST_VERSION, isDigestStale } from "./digest";
import { Color, EngineName, MoveClassification } from "@/types/enums";
import { GameEval, LineEval, PositionEval } from "@/types/eval";
import { Game } from "@/types/game";

const line = (
  pv: string[],
  score: { cp?: number; mate?: number },
  multiPv = 1
): LineEval => ({ pv, depth: 14, multiPv, ...score });

const pos = (
  lines: LineEval[],
  moveClassification?: MoveClassification
): PositionEval => ({ lines, moveClassification });

// 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6?? — shared opening, scores are White's POV
const openingPositions: PositionEval[] = [
  pos([line(["e2e4"], { cp: 30 }), line(["d2d4"], { cp: 25 }, 2)]),
  pos([line(["e7e5"], { cp: 30 }), line(["c7c5"], { cp: 40 }, 2)]),
  pos([line(["g1f3"], { cp: 30 }), line(["f1c4"], { cp: 20 }, 2)]),
  pos([line(["g8f6"], { cp: 25 }), line(["b8c6"], { cp: 30 }, 2)]),
  pos([line(["g1f3"], { cp: 40 }), line(["d1h5"], { cp: 20 }, 2)]),
  pos([line(["g7g6"], { cp: 20 }), line(["d8e7"], { cp: 300 }, 2)]),
  // After 3...Nf6??: White mates in one
  pos(
    [line(["h5f7"], { mate: 1 }), line(["h5e5"], { cp: 200 }, 2)],
    MoveClassification.Blunder
  ),
];

const makeGame = (
  pgnMoves: string,
  lastPosition: PositionEval,
  overrides: Partial<Game> = {}
): Game => {
  const gameEval: GameEval = {
    positions: [...openingPositions, lastPosition],
    accuracy: { white: 81, black: 42 },
    settings: {
      engine: EngineName.Stockfish18Lite,
      depth: 14,
      multiPv: 2,
      date: "2026-11-10T00:00:00.000Z",
    },
  };

  return {
    id: 7,
    pgn: `[White "me"]\n[Black "them"]\n[Result "*"]\n\n${pgnMoves} *`,
    white: { name: "me" },
    black: { name: "them" },
    eval: gameEval,
    myColor: Color.White,
    ...overrides,
  };
};

const SCHOLARS_MATE =
  "1. e4 {[%clk 0:02:59.5]} e5 {[%clk 0:02:58]} 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#";
const MISSED_MATE = "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxe5+";

describe("buildGameDigest", () => {
  it("returns undefined when the game isn't mine or isn't analyzed", () => {
    const game = makeGame(SCHOLARS_MATE, pos([line([], { mate: 1 })]));
    expect(buildGameDigest({ ...game, myColor: undefined })).toBeUndefined();
    expect(buildGameDigest({ ...game, eval: undefined })).toBeUndefined();
  });

  it("returns undefined when the eval doesn't match the moves", () => {
    const game = makeGame("1. e4 e5", pos([line([], { cp: 0 })]));
    expect(buildGameDigest(game)).toBeUndefined();
  });

  it("builds per-move facts from the mover's point of view", () => {
    const digest = buildGameDigest(
      makeGame(SCHOLARS_MATE, pos([line([], { mate: 1 })]), {
        result: "1-0",
        openingName: "Italian Game",
      })
    );
    expect(digest).toBeDefined();
    if (!digest) return;

    expect(digest.version).toBe(DIGEST_VERSION);
    expect(digest.moves).toHaveLength(7);
    expect(digest.result).toBe("win");
    expect(digest.accuracy).toBe(81);
    expect(digest.openingName).toBe("Italian Game");

    const [e4, e5] = digest.moves;
    expect(e4).toMatchObject({
      ply: 0,
      moveNumber: 1,
      color: Color.White,
      isMine: true,
      uci: "e2e4",
      san: "e4",
      bestUci: "e2e4",
      phase: "opening",
      clockAfter: 179.5,
      // d4 is within 3% of e4
      altUci: ["d2d4"],
    });
    expect(e5).toMatchObject({ isMine: false, moveNumber: 1, clockAfter: 178 });

    // Black's blunder 3...Nf6: from Black's view, about 48% → 0%
    const nf6 = digest.moves[5];
    expect(nf6.san).toBe("Nf6");
    expect(nf6.classification).toBe(MoveClassification.Blunder);
    expect(nf6.winBefore).toBeGreaterThan(45);
    expect(nf6.winAfter).toBe(0);
    expect(nf6.secondBestGap).toBeGreaterThan(20);
    expect(nf6.altUci).toBeUndefined();

    // White found the mate
    const qxf7 = digest.moves[6];
    expect(qxf7.missedMate).toBeUndefined();
    expect(qxf7.opponentErredPrev).toBe(true);
    expect(qxf7.hungPiece).toBeUndefined();
  });

  it("flags a missed mate and the piece it left hanging", () => {
    const digest = buildGameDigest(
      makeGame(
        MISSED_MATE,
        pos(
          [line(["c6e5"], { cp: -800 }), line(["d8e7"], { cp: -700 }, 2)],
          MoveClassification.Blunder
        )
      )
    );
    const qxe5 = digest?.moves[6];

    expect(qxe5?.san).toBe("Qxe5+");
    expect(qxe5?.isMine).toBe(true);
    expect(qxe5?.missedMate).toBe(true);
    expect(qxe5?.hungPiece).toMatch(/queen on e5/i);
    expect(qxe5?.winBefore).toBe(100);
    expect(qxe5?.winAfter).toBeLessThan(5);
  });

  it("doesn't call an even trade a hung piece", () => {
    // 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxc6 — the reply dxc6 takes back a bishop for a knight
    const flat = (pv: string) => pos([line([pv], { cp: 30 })]);
    const positions = [
      flat("e2e4"),
      flat("e7e5"),
      flat("g1f3"),
      flat("b8c6"),
      flat("f1b5"),
      flat("a7a6"),
      flat("b5a4"),
      pos([line(["d7c6"], { cp: -300 })]),
    ];
    const game = makeGame("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6", flat(""));
    const digest = buildGameDigest({
      ...game,
      eval: { ...game.eval!, positions },
    });
    const bxc6 = digest?.moves[6];

    expect(bxc6?.san).toBe("Bxc6");
    expect(bxc6!.winBefore - bxc6!.winAfter).toBeGreaterThan(10);
    expect(bxc6?.hungPiece).toBeUndefined();
  });

  it("detects stale digests", () => {
    const game = makeGame(SCHOLARS_MATE, pos([line([], { mate: 1 })]));
    const digest = buildGameDigest(game);

    expect(isDigestStale(game, undefined)).toBe(true);
    expect(isDigestStale(game, digest)).toBe(false);
    expect(isDigestStale({ ...game, myColor: Color.Black }, digest)).toBe(true);
    expect(
      isDigestStale(
        {
          ...game,
          eval: {
            ...game.eval!,
            settings: { ...game.eval!.settings, date: "later" },
          },
        },
        digest
      )
    ).toBe(true);
  });
});
