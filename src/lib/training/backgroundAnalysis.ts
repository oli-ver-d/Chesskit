import { getEvaluateGameParams, getGameFromPgn } from "@/lib/chess";
import { getDb } from "@/lib/db";
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

export const BATCH_ANALYSIS = { depth: 14, multiPv: 3 };

/** Yield to the UI every this many digests */
const DIGEST_CHUNK = 15;

export interface RefreshResult {
  /** Your games that need engine analysis, newest first */
  toAnalyze: number[];
  gamesChanged: boolean;
  digestsChanged: boolean;
}

const sortNewestFirst = (a: Game, b: Game) =>
  (b.endTime ?? 0) - (a.endTime ?? 0) || b.id - a.id;

/**
 * One pass over the saved games, run by the background daemon:
 * 1. backfills metadata on games saved before DB v2,
 * 2. updates `myColor` from the profile usernames,
 * 3. (re)builds stale digests and drops orphaned ones,
 * 4. lists your recent games that still need engine analysis.
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

  const digests = new Map(
    (await db.getAll("digests")).map((digest) => [digest.gameId, digest])
  );

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

  if (digestsToPut.length || digestsToDelete.length) {
    const tx = db.transaction("digests", "readwrite");
    await Promise.all([
      ...digestsToPut.map((d) => tx.store.put(d)),
      ...digestsToDelete.map((id) => tx.store.delete(id)),
      tx.done,
    ]);
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

  const tx = db.transaction(["games", "digests"], "readwrite");
  await tx.objectStore("games").put(analyzed);
  if (digest) await tx.objectStore("digests").put(digest);
  await tx.done;

  return true;
};
