import { getDb, getMeta, setMeta } from "@/lib/db";
import {
  getGameMetaFromHeaders,
  getMyColor,
  Identity,
  parsePgnHeaders,
} from "@/lib/gameMeta";
import { sleep } from "@/lib/helpers";
import { Game } from "@/types/game";

const API = "https://api.chess.com/pub/player";

/** A game as the monthly archive endpoint returns it */
export interface ChessComArchiveGame {
  url: string;
  pgn?: string;
  time_control?: string;
  time_class?: string;
  end_time?: number;
  rated?: boolean;
  rules?: string;
  /** Opening URL, e.g. https://www.chess.com/openings/Italian-Game... */
  eco?: string;
  white: { username: string; rating?: number };
  black: { username: string; rating?: number };
}

export interface ChessComSyncCursor {
  /** Lowercased: a different username starts over */
  username: string;
  /** Archive URLs fetched after their month had ended, so never refetched */
  completeArchives: string[];
  lastSyncAt: number;
  /** The history setting of the last sync: a longer one means a sync is due */
  historyMonths?: number;
}

export interface ChessComRatings {
  username: string;
  bullet?: number;
  blitz?: number;
  rapid?: number;
  daily?: number;
  fetchedAt: number;
}

export const SYNC_CURSOR_KEY = "chessComSyncCursor";
export const RATINGS_KEY = "chessComRatings";

/** A month counts as complete this long after it ends, to let late games land */
const ARCHIVE_SETTLE_MS = 24 * 3600 * 1000;

export class ChessComSyncError extends Error {
  constructor(
    message: string,
    readonly kind: "notFound" | "rateLimited" | "network"
  ) {
    super(message);
  }
}

/** "…/games/2024/03" → { year: 2024, month: 3 } */
export const parseArchiveMonth = (
  archiveUrl: string
): { year: number; month: number } | undefined => {
  const match = archiveUrl.match(/\/(\d{4})\/(\d{2})\/?$/);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]) };
};

/** True once the archive's month (UTC) ended more than a day before `now` */
export const isArchiveComplete = (archiveUrl: string, now: number) => {
  const month = parseArchiveMonth(archiveUrl);
  if (!month) return false;
  const monthEnd = Date.UTC(month.year, month.month, 1);
  return now - monthEnd >= ARCHIVE_SETTLE_MS;
};

/**
 * The archives to fetch, oldest first: those within the last `historyMonths`
 * months (0 = all), minus months already fully imported.
 */
export const selectArchivesToFetch = (
  archives: string[],
  cursor: Pick<ChessComSyncCursor, "completeArchives"> | undefined,
  historyMonths: number,
  now: number
): string[] => {
  const today = new Date(now);
  const oldest =
    historyMonths > 0
      ? today.getUTCFullYear() * 12 + today.getUTCMonth() - (historyMonths - 1)
      : -Infinity;
  const done = new Set(cursor?.completeArchives ?? []);

  return archives
    .filter((url) => {
      const month = parseArchiveMonth(url);
      if (!month) return false;
      return month.year * 12 + month.month - 1 >= oldest && !done.has(url);
    })
    .sort();
};

/**
 * Turns an archive game into a game to save, or undefined for variants
 * (chess960, bughouse…) and games without a PGN.
 */
export const chessComGameToDbGame = (
  game: ChessComArchiveGame,
  identity: Identity
): Omit<Game, "id"> | undefined => {
  if (game.rules !== "chess" || !game.pgn) return undefined;

  const headers = parsePgnHeaders(game.pgn);
  const meta = getGameMetaFromHeaders({
    ...headers,
    Link: headers.Link || game.url,
    ECOUrl: headers.ECOUrl || game.eco,
  });

  const dbGame: Omit<Game, "id"> = {
    pgn: game.pgn,
    event: headers.Event,
    site: headers.Site,
    date: headers.Date,
    round: headers.Round ?? "?",
    white: {
      name: game.white.username || headers.White || "White",
      rating: game.white.rating ?? numberOrUndefined(headers.WhiteElo),
    },
    black: {
      name: game.black.username || headers.Black || "Black",
      rating: game.black.rating ?? numberOrUndefined(headers.BlackElo),
    },
    result: headers.Result,
    termination: headers.Termination,
    timeControl: headers.TimeControl ?? game.time_control,
    ...meta,
    origin: "chesscom",
    externalId: meta.externalId ?? game.url,
    endTime: game.end_time ? game.end_time * 1000 : meta.endTime,
    timeClass: game.time_class ?? meta.timeClass,
    rated: game.rated,
  };

  return { ...dbGame, myColor: getMyColor(dbGame, identity) };
};

const numberOrUndefined = (value: string | undefined) => {
  const n = Number(value);
  return value && !Number.isNaN(n) ? n : undefined;
};

/**
 * GET a chess.com JSON endpoint. chess.com answers 429 to parallel bursts, so
 * callers fetch serially, and a 429 backs off exponentially before retrying.
 */
const fetchChessCom = async <T>(
  url: string,
  signal?: AbortSignal,
  attempt = 0
): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ChessComSyncError("Couldn't reach chess.com", "network");
  }

  if (res.status === 429) {
    if (attempt >= 4) {
      throw new ChessComSyncError(
        "chess.com is rate limiting requests, try again later",
        "rateLimited"
      );
    }
    await sleep(2000 * 2 ** attempt);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return fetchChessCom(url, signal, attempt + 1);
  }
  if (res.status === 404) {
    throw new ChessComSyncError("chess.com user not found", "notFound");
  }
  if (!res.ok) {
    throw new ChessComSyncError(
      `chess.com returned an error (${res.status})`,
      "network"
    );
  }
  return res.json();
};

/**
 * Adds the games that aren't saved yet (deduped on `externalId`).
 * Returns how many were added.
 */
export const saveNewGames = async (
  games: Omit<Game, "id">[]
): Promise<number> => {
  if (!games.length) return 0;

  const db = await getDb();
  const tx = db.transaction("games", "readwrite");
  const byExternalId = tx.store.index("by-externalId");
  const seen = new Set<string>();
  let added = 0;

  for (const game of games) {
    const id = game.externalId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if ((await byExternalId.getKey(id)) !== undefined) continue;
    // The store generates the id
    await tx.store.add(game as Game);
    added++;
  }
  await tx.done;

  return added;
};

export interface ChessComSyncProgress {
  archivesDone: number;
  archivesTotal: number;
  added: number;
}

export interface ChessComSyncOptions {
  username: string;
  identity: Identity;
  /** Months of history to import (0 = all); only months not imported yet are fetched */
  historyMonths: number;
  signal?: AbortSignal;
  onProgress?: (progress: ChessComSyncProgress) => void;
  /** Called after each archive that added games */
  onGamesAdded?: () => void;
}

/**
 * Imports your chess.com games: fetches the monthly archives that aren't
 * fully imported yet (oldest first), saves new games, then refreshes your
 * ratings. The cursor in `meta` advances after each archive, so an
 * interrupted sync resumes where it stopped.
 */
export const syncChessComGames = async ({
  username,
  identity,
  historyMonths,
  signal,
  onProgress,
  onGamesAdded,
}: ChessComSyncOptions): Promise<{ added: number }> => {
  const user = username.trim().toLowerCase();
  const userPath = `${API}/${encodeURIComponent(user)}`;
  const startedAt = Date.now();

  const storedCursor = await getMeta<ChessComSyncCursor>(SYNC_CURSOR_KEY);
  const cursor: ChessComSyncCursor =
    storedCursor?.username === user
      ? storedCursor
      : { username: user, completeArchives: [], lastSyncAt: 0 };

  const { archives } = await fetchChessCom<{ archives: string[] }>(
    `${userPath}/games/archives`,
    signal
  );
  const toFetch = selectArchivesToFetch(
    archives ?? [],
    cursor,
    historyMonths,
    startedAt
  );

  let added = 0;
  for (const [index, archiveUrl] of toFetch.entries()) {
    onProgress?.({
      archivesDone: index,
      archivesTotal: toFetch.length,
      added,
    });

    const { games } = await fetchChessCom<{ games: ChessComArchiveGame[] }>(
      archiveUrl,
      signal
    );
    const newGames = (games ?? [])
      .map((game) => chessComGameToDbGame(game, identity))
      .filter((game): game is Omit<Game, "id"> => !!game);

    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const addedHere = await saveNewGames(newGames);
    added += addedHere;
    if (addedHere) onGamesAdded?.();

    if (isArchiveComplete(archiveUrl, startedAt)) {
      cursor.completeArchives = [...cursor.completeArchives, archiveUrl];
      await setMeta(SYNC_CURSOR_KEY, cursor);
    }
  }

  await setMeta(SYNC_CURSOR_KEY, {
    ...cursor,
    lastSyncAt: Date.now(),
    historyMonths,
  });
  onProgress?.({
    archivesDone: toFetch.length,
    archivesTotal: toFetch.length,
    added,
  });

  try {
    await setMeta(RATINGS_KEY, await fetchChessComRatings(user, signal));
  } catch (error) {
    // Ratings are a nice-to-have: the games are already imported
    if (signal?.aborted) throw error;
  }

  return { added };
};

interface ChessComStats {
  [key: string]: { last?: { rating?: number } } | undefined;
}

const fetchChessComRatings = async (
  user: string,
  signal?: AbortSignal
): Promise<ChessComRatings> => {
  const stats = await fetchChessCom<ChessComStats>(
    `${API}/${encodeURIComponent(user)}/stats`,
    signal
  );
  return {
    username: user,
    bullet: stats.chess_bullet?.last?.rating,
    blitz: stats.chess_blitz?.last?.rating,
    rapid: stats.chess_rapid?.last?.rating,
    daily: stats.chess_daily?.last?.rating,
    fetchedAt: Date.now(),
  };
};
