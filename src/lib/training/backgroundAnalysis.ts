import { getEvaluateGameParams, getGameFromPgn } from "@/lib/chess";
import { getDb, getMeta } from "@/lib/db";
import {
  getGameMetaFromHeaders,
  getMyColor,
  Identity,
  parsePgnHeaders,
} from "@/lib/gameMeta";
import { sleep } from "@/lib/helpers";
import { UciEngine } from "@/lib/engine/uciEngine";
import { Game } from "@/types/game";
import { GameDigest } from "@/types/training";
import { buildGameDigest, isDigestStale } from "./digest";
import { PUZZLE_VERSION } from "./puzzles";
import { PUZZLE_VERSION_KEY, writeGamePuzzles } from "./puzzleStore";

export const BATCH_ANALYSIS = { depth: 14, multiPv: 3 };

/** Yield to the UI every this many digests */
const DIGEST_CHUNK = 15;

export interface RefreshResult {
  /** Your games that need engine analysis, newest first */
  toAnalyze: number[];
  gamesChanged: boolean;
  digestsChanged: boolean;
  puzzlesChanged: boolean;
}

const sortNewestFirst = (a: Game, b: Game) =>
  (b.endTime ?? 0) - (a.endTime ?? 0) || b.id - a.id;

/**
 * One pass over the saved games, run by the background daemon:
 * 1. backfills metadata on games saved before DB v2,
 * 2. updates `myColor` from the profile usernames,
 * 3. (re)builds stale digests and drops orphaned ones,
 * 4. regenerates the puzzles of every changed digest (or of all digests when
 *    the puzzle logic changed),
 * 5. lists your recent games that still need engine analysis.
 */
export const refreshTrainingData = async (
  identity: Identity,
  analyzeLimit: number
): Promise<RefreshResult> => {
  const db = await getDb();
  const games = await db.getAll("games");

  const usedExternalIds = new Set(
    games.map((game) => game.externalId).filter(Boolean)
  );
  const updatedGames: Game[] = [];
  for (const game of games) {
    let updated = game;

    if (game.origin === undefined) {
      const meta = getGameMetaFromHeaders(parsePgnHeaders(game.pgn));
      updated = { ...meta, ...stripUndefined(updated) };
      // Duplicates saved before v2 must not break the unique externalId index
      if (updated.externalId && usedExternalIds.has(updated.externalId)) {
        updated = { ...updated, externalId: undefined };
      }
      if (updated.externalId) usedExternalIds.add(updated.externalId);
    }

    const myColor = getMyColor(updated, identity);
    if (myColor !== updated.myColor) updated = { ...updated, myColor };

    if (updated !== game) updatedGames.push(updated);
  }

  if (updatedGames.length) {
    const tx = db.transaction("games", "readwrite");
    await Promise.all([...updatedGames.map((g) => tx.store.put(g)), tx.done]);
  }

  const currentGames = games.map(
    (game) => updatedGames.find((g) => g.id === game.id) ?? game
  );

  const storedDigests = await db.getAll("digests");
  const digests = new Map(storedDigests.map((d) => [d.gameId, d]));

  const digestsToPut: GameDigest[] = [];
  const digestsToDelete: number[] = [];
  let built = 0;

  for (const game of currentGames) {
    const digest = digests.get(game.id);
    digests.delete(game.id);

    if (!game.myColor || !game.eval) {
      if (digest) digestsToDelete.push(game.id);
      continue;
    }
    if (!isDigestStale(game, digest)) continue;

    const newDigest = buildGameDigest(game);
    if (newDigest) digestsToPut.push(newDigest);
    else if (digest) digestsToDelete.push(game.id);

    if (++built % DIGEST_CHUNK === 0) await sleep(0);
  }
  // Digests left in the map belong to deleted games
  digestsToDelete.push(...digests.keys());

  // Games whose puzzles must be regenerated, with their new digest (or none)
  const puzzleGames = new Map<number, GameDigest | undefined>();
  const puzzlesOutdated =
    (await getMeta<number>(PUZZLE_VERSION_KEY)) !== PUZZLE_VERSION;
  if (puzzlesOutdated) {
    storedDigests.forEach((d) => puzzleGames.set(d.gameId, d));
  }
  digestsToPut.forEach((d) => puzzleGames.set(d.gameId, d));
  digestsToDelete.forEach((id) => puzzleGames.set(id, undefined));

  let puzzlesChanged = false;
  if (puzzleGames.size || puzzlesOutdated) {
    const now = Date.now();
    const tx = db.transaction(["digests", "puzzles", "meta"], "readwrite");
    const digestStore = tx.objectStore("digests");
    const puzzleStore = tx.objectStore("puzzles");
    // Same transaction, so a digest is never saved without its puzzles
    for (const d of digestsToPut) await digestStore.put(d);
    for (const id of digestsToDelete) await digestStore.delete(id);
    for (const [gameId, digest] of puzzleGames) {
      if (await writeGamePuzzles(puzzleStore, gameId, digest, now)) {
        puzzlesChanged = true;
      }
    }
    if (puzzlesOutdated) {
      await tx.objectStore("meta").put(PUZZLE_VERSION, PUZZLE_VERSION_KEY);
    }
    await tx.done;
  }

  const toAnalyze = currentGames
    .filter((game) => game.myColor)
    .sort(sortNewestFirst)
    .slice(0, analyzeLimit)
    .filter((game) => !game.eval)
    .map((game) => game.id);

  return {
    toAnalyze,
    gamesChanged: updatedGames.length > 0,
    digestsChanged: digestsToPut.length + digestsToDelete.length > 0,
    puzzlesChanged,
  };
};

const stripUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as T;

/**
 * Analyzes one saved game with the batch settings, then stores its eval and
 * digest. Returns false if the game can't be analyzed (no moves, bad PGN).
 * With `force`, replaces an existing eval ("Re-analyze").
 */
export const analyzeSavedGame = async (
  engine: UciEngine,
  gameId: number,
  workersNb: number,
  onProgress?: (value: number) => void,
  force = false
): Promise<boolean> => {
  const db = await getDb();
  const game = await db.get("games", gameId);
  if (!game || (game.eval && !force)) return true;

  let params: ReturnType<typeof getEvaluateGameParams>;
  try {
    const chess = getGameFromPgn(game.pgn);
    if (!chess.history().length) return false;
    params = getEvaluateGameParams(chess);
  } catch {
    return false;
  }

  const gameEval = await engine.evaluateGame({
    ...params,
    ...BATCH_ANALYSIS,
    workersNb,
    setEvaluationProgress: onProgress,
    playersRatings: {
      white: game.white.rating,
      black: game.black.rating,
    },
  });

  // The game may have been deleted or analyzed on the Analysis page meanwhile
  const fresh = await db.get("games", gameId);
  if (!fresh || (fresh.eval && !force)) return true;

  const analyzed: Game = { ...fresh, eval: gameEval };
  const digest = buildGameDigest(analyzed);

  const tx = db.transaction(["games", "digests", "puzzles"], "readwrite");
  await tx.objectStore("games").put(analyzed);
  if (digest) await tx.objectStore("digests").put(digest);
  else await tx.objectStore("digests").delete(gameId);
  await writeGamePuzzles(tx.objectStore("puzzles"), gameId, digest, Date.now());
  await tx.done;

  return true;
};
