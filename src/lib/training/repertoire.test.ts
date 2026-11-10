import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { Color } from "@/types/enums";
import { GameDigest, MoveDigest, RepertoireNode } from "@/types/training";
import {
  buildRepertoire,
  countReachable,
  findRepertoireExit,
  formatSanPath,
  getDrillReplies,
  getRepertoireId,
  getRepertoireLines,
  isEntryDue,
  pickDrillReply,
  ROOT_KEY,
} from "./repertoire";
import { getFenKey } from "./puzzles";

interface DigestOptions {
  myColor?: Color;
  /** Win chance lost, by ply */
  loss?: Record<number, number>;
  /** Engine's best move, by ply (defaults to the move played) */
  best?: Record<number, string>;
  endTime?: number;
}

let nextId = 1;

const digestOf = (
  sans: string[],
  { myColor = Color.White, loss = {}, best = {}, endTime }: DigestOptions = {}
): GameDigest => {
  const chess = new Chess();
  const moves = sans.map((san, ply): MoveDigest => {
    const move = chess.move(san);
    const uci = move.from + move.to + (move.promotion ?? "");
    return {
      ply,
      moveNumber: Math.floor(ply / 2) + 1,
      color: move.color as Color,
      isMine: move.color === myColor,
      fenBefore: move.before,
      uci,
      san: move.san,
      winBefore: 50,
      winAfter: 50 - (loss[ply] ?? 0),
      bestUci: best[ply] ?? uci,
      phase: "opening",
    };
  });
  const gameId = nextId++;
  return {
    gameId,
    version: 3,
    myColor,
    evalDate: "2026-11-01",
    endTime: endTime ?? gameId,
    moves,
  };
};

const times = (n: number, sans: string[], options?: DigestOptions) =>
  Array.from({ length: n }, () => digestOf(sans, options));

const ITALIAN = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"];
const SICILIAN = ["e4", "c5", "Nf3", "d6", "d4", "cxd4"];
const SCANDINAVIAN = ["e4", "d5", "exd5", "Qxd5"];

const whiteGames = () => [
  ...times(3, ITALIAN),
  ...times(2, SICILIAN),
  ...times(1, SCANDINAVIAN),
];

const keyAfter = (sans: string[]) => {
  const chess = new Chess();
  sans.forEach((san) => chess.move(san));
  return getFenKey(chess.fen());
};

const node = (
  fenKey: string,
  overrides: Partial<RepertoireNode> = {}
): RepertoireNode => ({
  id: getRepertoireId(Color.White, fenKey),
  color: Color.White,
  fenKey,
  box: 0,
  dueAt: 0,
  attempts: 0,
  ...overrides,
});

describe("buildRepertoire", () => {
  it("follows your moves and the replies you face at least twice", () => {
    const repertoire = buildRepertoire(whiteGames(), Color.White);
    expect(repertoire.games).toBe(6);
    expect(repertoire.entries.map((e) => formatSanPath(e.sanPath))).toEqual([
      "",
      "1. e4 e5",
      "1. e4 c5",
      "1. e4 e5 2. Nf3 Nc6",
      "1. e4 c5 2. Nf3 d6",
    ]);
    const root = repertoire.byKey[ROOT_KEY];
    expect(root).toMatchObject({
      san: "e4",
      source: "played",
      games: 6,
      accepted: ["e2e4"],
    });
    // 1...d5 was faced once: not in the repertoire
    expect(
      getDrillReplies(repertoire, keyAfter(["e4"])).map((r) => r.san)
    ).toEqual(["e5", "c5"]);
  });

  it("names positions from the openings list", () => {
    const repertoire = buildRepertoire(whiteGames(), Color.White);
    const italian = repertoire.byKey[keyAfter(ITALIAN.slice(0, 4))];
    expect(italian.openingName).toMatch(/^King's Knight Opening/);
    expect(
      repertoire.byKey[keyAfter(SICILIAN.slice(0, 2))].openingName
    ).toMatch(/^Sicilian Defense/);
  });

  it("groups lines by the opening they end in", () => {
    const lines = getRepertoireLines(
      buildRepertoire(
        [...whiteGames(), ...times(2, [...ITALIAN, "c3", "Nf6", "d4", "exd4"])],
        Color.White
      )
    );
    expect(
      lines.map((line) => ({
        family: line.family,
        start: formatSanPath(line.startSanPath),
        entries: line.entries.map((e) => e.san),
        games: line.games,
      }))
    ).toEqual([
      {
        // Your moves before either opening starts
        family: "First moves",
        start: "",
        entries: ["e4", "Nf3"],
        games: 8,
      },
      {
        // Your 3. Bc4 makes it an Italian Game, so the line starts there
        family: "Italian Game",
        start: "1. e4 e5 2. Nf3 Nc6",
        entries: ["Bc4", "c3", "d4"],
        games: 2,
      },
      {
        family: "Sicilian Defense",
        start: "1. e4 c5",
        entries: ["Nf3", "d4"],
        games: 2,
      },
    ]);
  });

  it("replaces a move that loses a lot with the engine's move", () => {
    const digests = times(3, ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6"], {
      loss: { 2: 12 },
      best: { 2: "g1f3" },
    });
    const repertoire = buildRepertoire(digests, Color.White);
    const entry = repertoire.byKey[keyAfter(["e4", "e5"])];
    expect(entry).toMatchObject({
      uci: "g1f3",
      san: "Nf3",
      source: "corrected",
      usual: { san: "Qh5", count: 3, avgLoss: 12 },
    });
    // You never played Nf3 here, so the line ends
    expect(entry.nextKey).toBeUndefined();
    expect(repertoire.entries).toHaveLength(2);
  });

  it("keeps your move when it loses less than the limit", () => {
    const digests = times(3, ["e4", "e5", "Qh5", "Nc6"], {
      loss: { 2: 7 },
      best: { 2: "g1f3" },
    });
    const entry = buildRepertoire(digests, Color.White).byKey[
      keyAfter(["e4", "e5"])
    ];
    expect(entry.source).toBe("played");
    expect(entry.san).toBe("Qh5");
  });

  it("applies pinned moves, accepted moves and removed lines", () => {
    const afterE5 = keyAfter(["e4", "e5"]);
    const afterC5 = keyAfter(["e4", "c5"]);
    const repertoire = buildRepertoire(whiteGames(), Color.White, [
      node(ROOT_KEY, { pinnedUci: "d2d4", extraUci: ["e2e4", "a1a5"] }),
      node(afterE5, { excluded: true }),
      // Another colour's node is ignored
      { ...node(afterC5, { pinnedUci: "b1c3" }), color: Color.Black },
    ]);
    const root = repertoire.byKey[ROOT_KEY];
    expect(root).toMatchObject({
      uci: "d2d4",
      source: "pinned",
      usual: { san: "e4" },
      // The illegal move is dropped
      accepted: ["d2d4", "e2e4"],
    });
    // You never played 1. d4, so nothing follows
    expect(repertoire.entries).toHaveLength(1);

    const unpinned = buildRepertoire(whiteGames(), Color.White, [
      node(afterE5, { excluded: true }),
    ]);
    expect(unpinned.byKey[afterE5].excluded).toBe(true);
    // Nothing after the removed position is in the repertoire
    expect(unpinned.byKey[keyAfter(ITALIAN.slice(0, 4))]).toBeUndefined();
    expect(
      getDrillReplies(unpinned, keyAfter(["e4"])).map((r) => r.san)
    ).toEqual(["c5"]);
  });

  it("builds a Black repertoire from the opponent's first moves", () => {
    const digests = [
      ...times(2, ["e4", "c5", "Nf3", "Nc6"], { myColor: Color.Black }),
      ...times(2, ["d4", "Nf6", "c4", "e6"], { myColor: Color.Black }),
      ...times(2, ITALIAN),
    ];
    const repertoire = buildRepertoire(digests, Color.Black);
    expect(repertoire.games).toBe(4);
    expect(repertoire.byKey[ROOT_KEY]).toBeUndefined();
    // Equally common: the more recent games' moves come first
    expect(repertoire.entries.map((e) => e.san)).toEqual([
      "Nf6",
      "c5",
      "e6",
      "Nc6",
    ]);
  });

  it("skips games from a custom start position", () => {
    const custom = digestOf(["e4", "e5"]);
    custom.moves[0].fenBefore = "8/8/8/8/8/8/8/K6k w - - 0 1";
    expect(buildRepertoire([custom], Color.White).games).toBe(0);
  });
});

describe("drilling", () => {
  it("knows which positions are due", () => {
    const repertoire = buildRepertoire(whiteGames(), Color.White, [
      node(ROOT_KEY, { box: 2, dueAt: 1000 }),
    ]);
    const root = repertoire.byKey[ROOT_KEY];
    expect(isEntryDue(root, 999)).toBe(false);
    expect(isEntryDue(root, 1000)).toBe(true);
    expect(countReachable(repertoire, ROOT_KEY, (e) => isEntryDue(e, 0))).toBe(
      4
    );
  });

  it("picks replies by how often you face them, preferring lines to drill", () => {
    const repertoire = buildRepertoire(whiteGames(), Color.White);
    const afterE4 = keyAfter(["e4"]);
    // e5 is faced 3 times, c5 twice: a roll under 3/5 picks e5
    const all = () => true;
    expect(pickDrillReply(repertoire, afterE4, all, all, () => 0.5)?.san).toBe(
      "e5"
    );
    expect(pickDrillReply(repertoire, afterE4, all, all, () => 0.7)?.san).toBe(
      "c5"
    );

    // Only the Sicilian still has positions to drill
    const sicilian = new Set(
      repertoire.entries.filter((e) => e.sanPath[1] === "c5").map((e) => e.key)
    );
    const inSicilian = (e: { key: string }) => sicilian.has(e.key);
    const none = () => false;
    expect(
      pickDrillReply(repertoire, afterE4, inSicilian, all, () => 0)?.san
    ).toBe("c5");
    // Nothing left to drill: stay in the line
    expect(
      pickDrillReply(repertoire, afterE4, none, inSicilian, () => 0)?.san
    ).toBe("c5");
    expect(pickDrillReply(repertoire, afterE4, none, none, () => 0)?.san).toBe(
      "e5"
    );
    expect(pickDrillReply(repertoire, ROOT_KEY, () => true)).toBeUndefined();
  });
});

describe("findRepertoireExit", () => {
  it("finds your first move outside the repertoire", () => {
    const digests = whiteGames();
    const offbeat = digestOf(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    const repertoire = buildRepertoire([...digests, offbeat], Color.White);

    expect(findRepertoireExit(repertoire, offbeat)).toMatchObject({
      gameId: offbeat.gameId,
      ply: 4,
      playedSan: "Bb5",
      entry: { san: "Bc4" },
    });
    expect(findRepertoireExit(repertoire, digests[0])).toBeUndefined();
    // The opponent left the repertoire first
    expect(findRepertoireExit(repertoire, digests[5])).toBeUndefined();
  });
});

describe("formatSanPath", () => {
  it("numbers the moves", () => {
    expect(formatSanPath(["e4", "e5", "Nf3"])).toBe("1. e4 e5 2. Nf3");
    expect(formatSanPath(["e5", "Nf3"], 1)).toBe("1... e5 2. Nf3");
  });
});
