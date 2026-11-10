import { Chess, DEFAULT_POSITION } from "chess.js";
import { openings } from "@/data/openings";
import { uciMoveParams } from "@/lib/chess";
import { uciToSan } from "@/lib/coach/facts";
import { Color } from "@/types/enums";
import { GameDigest, RepertoireNode } from "@/types/training";
import { getFenKey } from "./puzzles";
import { REPERTOIRE_THRESHOLDS } from "./thresholds";

/** A move played in a repertoire position, by you or your opponents */
export interface RepertoireMove {
  uci: string;
  san: string;
  /** Games where it was played here */
  count: number;
  /** Average win chance it lost, for the side that played it (0–100) */
  avgLoss: number;
  /** Position after the move */
  nextKey?: string;
  /** End time of the latest game with this move */
  lastPlayedAt: number;
}

/** A position reached in the first moves of your games with one colour */
export interface RepertoirePosition {
  /** `getFenKey` of the position */
  key: string;
  fen: string;
  /** Fewest half-moves from the start that reach it */
  ply: number;
  myTurn: boolean;
  /** Games that reached it */
  games: number;
  /** Moves played here, most played first */
  moves: RepertoireMove[];
  /** Engine's best move here (the most common one across your games) */
  bestUci?: string;
}

/** How the move to play in a position was chosen */
export type RepertoireSource = "played" | "corrected" | "pinned";

/** A position where you move, with the move your repertoire plays */
export interface RepertoireEntry {
  /** `${color}:${fenKey}`, the key of its stored `RepertoireNode` */
  id: string;
  key: string;
  fen: string;
  /** Moves (UCI) from the start position to here */
  path: string[];
  sanPath: string[];
  /** Positions along the path: the start position first, this one last */
  pathKeys: string[];
  ply: number;
  games: number;
  uci: string;
  san: string;
  source: RepertoireSource;
  /** Your most played move here, when the repertoire plays another one */
  usual?: RepertoireMove;
  /** Moves that count as right here: the repertoire move and the ones you added */
  accepted: string[];
  /** Name of the deepest named position on the way here */
  openingName?: string;
  /** Your moves here, from your games */
  moves: RepertoireMove[];
  node?: RepertoireNode;
  excluded: boolean;
  /** Position after the repertoire move, when your games continue from it */
  nextKey?: string;
}

export interface Repertoire {
  color: Color;
  /** Games with this colour from the standard start position */
  games: number;
  rootKey: string;
  positions: Record<string, RepertoirePosition>;
  /** Positions where you move, nearest the start first */
  entries: RepertoireEntry[];
  byKey: Record<string, RepertoireEntry>;
}

export interface RepertoireOptions {
  maxPlies?: number;
  minGames?: number;
  maxLoss?: number;
}

export const ROOT_KEY = getFenKey(DEFAULT_POSITION);

export const getRepertoireId = (color: Color, fenKey: string) =>
  `${color}:${fenKey}`;

let openingNames: Map<string, string> | undefined;

/** Opening name of a position, from `data/openings.ts` (matched on the board only) */
export const getPositionName = (fen: string): string | undefined => {
  if (!openingNames) {
    openingNames = new Map();
    for (const { name, fen: board } of openings) {
      if (!openingNames.has(board)) openingNames.set(board, name);
    }
  }
  return openingNames.get(fen.split(" ")[0]);
};

/** "Sicilian Defense: Najdorf Variation" → "Sicilian Defense" */
export const getNameFamily = (name: string | undefined) =>
  name?.split(":")[0].trim() ?? "Unnamed opening";

/** The line holding your moves before any opening family starts */
export const FIRST_MOVES = "First moves";

/** Key of the position after `uci`, or undefined if the move is illegal */
const keyAfter = (fen: string, uci: string): string | undefined => {
  try {
    return getFenKey(new Chess(fen).move(uciMoveParams(uci)).after);
  } catch {
    return undefined;
  }
};

interface MoveAccumulator extends RepertoireMove {
  lossSum: number;
}

interface PositionAccumulator {
  position: RepertoirePosition;
  moves: Map<string, MoveAccumulator>;
  best: Map<string, number>;
}

const byPopularity = (a: RepertoireMove, b: RepertoireMove) =>
  b.count - a.count || a.avgLoss - b.avgLoss || b.lastPlayedAt - a.lastPlayedAt;

/** Every position in the first `maxPlies` half-moves of your games with `color` */
const collectPositions = (
  digests: GameDigest[],
  color: Color,
  maxPlies: number
) => {
  const acc = new Map<string, PositionAccumulator>();
  let games = 0;

  for (const digest of digests) {
    if (digest.myColor !== color || !digest.moves.length) continue;
    if (getFenKey(digest.moves[0].fenBefore) !== ROOT_KEY) continue;
    games++;

    const seen = new Set<string>();
    const limit = Math.min(maxPlies, digest.moves.length);
    for (let i = 0; i < limit; i++) {
      const move = digest.moves[i];
      const key = getFenKey(move.fenBefore);
      // A position repeated within one game counts once
      if (seen.has(key)) continue;
      seen.add(key);

      let entry = acc.get(key);
      if (!entry) {
        entry = {
          position: {
            key,
            fen: move.fenBefore,
            ply: i,
            myTurn: move.isMine,
            games: 0,
            moves: [],
          },
          moves: new Map(),
          best: new Map(),
        };
        acc.set(key, entry);
      }
      const { position } = entry;
      position.games++;
      position.ply = Math.min(position.ply, i);
      if (move.bestUci) {
        entry.best.set(move.bestUci, (entry.best.get(move.bestUci) ?? 0) + 1);
      }

      const endTime = digest.endTime ?? 0;
      const next = digest.moves[i + 1];
      let stat = entry.moves.get(move.uci);
      if (!stat) {
        stat = {
          uci: move.uci,
          san: move.san,
          count: 0,
          avgLoss: 0,
          lossSum: 0,
          lastPlayedAt: endTime,
        };
        entry.moves.set(move.uci, stat);
      }
      stat.count++;
      stat.lossSum += Math.max(0, move.winBefore - move.winAfter);
      stat.lastPlayedAt = Math.max(stat.lastPlayedAt, endTime);
      stat.nextKey ??= next
        ? getFenKey(next.fenBefore)
        : keyAfter(move.fenBefore, move.uci);
    }
  }

  const positions: Record<string, RepertoirePosition> = {};
  for (const { position, moves, best } of acc.values()) {
    position.moves = [...moves.values()]
      .map(({ lossSum, ...stat }) => ({
        ...stat,
        avgLoss: lossSum / stat.count,
      }))
      .sort(byPopularity);
    position.bestUci = [...best.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    positions[position.key] = position;
  }
  return { positions, games };
};

/** The move your repertoire plays in a position where you move */
const chooseMove = (
  position: RepertoirePosition,
  node: RepertoireNode | undefined,
  maxLoss: number
): Pick<RepertoireEntry, "uci" | "san" | "source" | "usual"> | undefined => {
  const top = position.moves[0];
  if (!top) return undefined;

  const pinnedSan = node?.pinnedUci
    ? uciToSan(position.fen, node.pinnedUci)
    : undefined;
  if (node?.pinnedUci && pinnedSan) {
    return {
      uci: node.pinnedUci,
      san: pinnedSan,
      source: "pinned",
      usual: top.uci === node.pinnedUci ? undefined : top,
    };
  }

  const bestSan = position.bestUci
    ? uciToSan(position.fen, position.bestUci)
    : undefined;
  if (
    top.avgLoss >= maxLoss &&
    position.bestUci &&
    bestSan &&
    position.bestUci !== top.uci
  ) {
    return {
      uci: position.bestUci,
      san: bestSan,
      source: "corrected",
      usual: top,
    };
  }

  return { uci: top.uci, san: top.san, source: "played" };
};

/**
 * Your opening repertoire with one colour, built from your games: in each
 * position where you move, your most played move (or the engine's, when
 * yours loses `maxLoss` or more on average); in each position where your
 * opponent moves, every reply you've faced at least `minGames` times.
 * Stored nodes override the move (pinned), add accepted moves, or cut a line.
 */
export const buildRepertoire = (
  digests: GameDigest[],
  color: Color,
  nodes: RepertoireNode[] = [],
  options: RepertoireOptions = {}
): Repertoire => {
  const {
    maxPlies = REPERTOIRE_THRESHOLDS.maxPlies,
    minGames = REPERTOIRE_THRESHOLDS.minGames,
    maxLoss = REPERTOIRE_THRESHOLDS.maxLoss,
  } = options;
  const { positions, games } = collectPositions(digests, color, maxPlies);
  const stored = new Map(
    nodes.filter((n) => n.color === color).map((n) => [n.fenKey, n])
  );

  const entries: RepertoireEntry[] = [];
  const byKey: Record<string, RepertoireEntry> = {};
  const visited = new Set<string>();

  // Breadth first, so each position gets its shortest path
  const queue: {
    key: string;
    path: string[];
    sanPath: string[];
    pathKeys: string[];
    name?: string;
  }[] = [{ key: ROOT_KEY, path: [], sanPath: [], pathKeys: [ROOT_KEY] }];

  while (queue.length) {
    const { key, path, sanPath, pathKeys, name } = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);

    const position = positions[key];
    if (!position || position.games < minGames) continue;
    const openingName = getPositionName(position.fen) ?? name;

    if (!position.myTurn) {
      for (const reply of position.moves) {
        if (reply.count < minGames || !reply.nextKey) continue;
        queue.push({
          key: reply.nextKey,
          path: [...path, reply.uci],
          sanPath: [...sanPath, reply.san],
          pathKeys: [...pathKeys, reply.nextKey],
          name: openingName,
        });
      }
      continue;
    }

    const node = stored.get(key);
    const choice = chooseMove(position, node, maxLoss);
    if (!choice) continue;

    const played = position.moves.find((m) => m.uci === choice.uci);
    const nextKey = played?.nextKey ?? keyAfter(position.fen, choice.uci);
    const entry: RepertoireEntry = {
      id: getRepertoireId(color, key),
      key,
      fen: position.fen,
      path,
      sanPath,
      pathKeys,
      ply: position.ply,
      games: position.games,
      ...choice,
      accepted: [
        ...new Set([
          choice.uci,
          ...(node?.extraUci ?? []).filter((uci) =>
            uciToSan(position.fen, uci)
          ),
        ]),
      ],
      openingName,
      moves: position.moves,
      node,
      excluded: !!node?.excluded,
      nextKey: nextKey && positions[nextKey] ? nextKey : undefined,
    };
    entries.push(entry);
    byKey[key] = entry;

    if (!entry.excluded && entry.nextKey) {
      queue.push({
        key: entry.nextKey,
        path: [...path, entry.uci],
        sanPath: [...sanPath, entry.san],
        pathKeys: [...pathKeys, entry.nextKey],
        name: openingName,
      });
    }
  }

  return { color, games, rootKey: ROOT_KEY, positions, entries, byKey };
};

/** True if the position should be drilled now: never drilled, or due */
export const isEntryDue = (entry: RepertoireEntry, now: number) =>
  !entry.excluded && (!entry.node?.box || entry.node.dueAt <= now);

/** Your opponent's replies in a position that the drill can play */
export const getDrillReplies = (
  repertoire: Repertoire,
  key: string,
  minGames: number = REPERTOIRE_THRESHOLDS.minGames
): (RepertoireMove & { nextKey: string })[] => {
  const position = repertoire.positions[key];
  if (!position || position.myTurn) return [];
  return position.moves.filter(
    (reply): reply is RepertoireMove & { nextKey: string } =>
      reply.count >= minGames &&
      !!reply.nextKey &&
      !!repertoire.byKey[reply.nextKey] &&
      !repertoire.byKey[reply.nextKey].excluded
  );
};

/** Entries the drill can reach from `key` that pass `include` */
export const countReachable = (
  repertoire: Repertoire,
  key: string,
  include: (entry: RepertoireEntry) => boolean
): number => {
  const visited = new Set<string>();
  let count = 0;
  const stack = [key];
  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const entry = repertoire.byKey[current];
    if (entry) {
      if (entry.excluded) continue;
      if (include(entry)) count++;
      if (entry.nextKey) stack.push(entry.nextKey);
    } else {
      stack.push(...getDrillReplies(repertoire, current).map((r) => r.nextKey));
    }
  }
  return count;
};

/**
 * The opponent's move for the drill, weighted by how often you face it.
 * It picks among the replies that lead to positions still to drill (`prefer`)
 * if any do, else among those that stay in the line (`within`), else any.
 */
export const pickDrillReply = (
  repertoire: Repertoire,
  key: string,
  prefer: (entry: RepertoireEntry) => boolean,
  within: (entry: RepertoireEntry) => boolean = () => true,
  random: () => number = Math.random
): RepertoireMove | undefined => {
  const replies = getDrillReplies(repertoire, key);
  if (!replies.length) return undefined;

  const leadingTo = (include: (entry: RepertoireEntry) => boolean) =>
    replies.filter(
      (reply) => countReachable(repertoire, reply.nextKey, include) > 0
    );
  const preferred = leadingTo(prefer);
  const inLine = preferred.length ? preferred : leadingTo(within);
  const pool = inLine.length ? inLine : replies;
  const total = pool.reduce((sum, reply) => sum + reply.count, 0);
  let roll = random() * total;
  for (const reply of pool) {
    roll -= reply.count;
    if (roll < 0) return reply;
  }
  return pool[pool.length - 1];
};

/** The first move of yours in a game that isn't in your repertoire */
export interface RepertoireExit {
  gameId: number;
  endTime?: number;
  ply: number;
  playedUci: string;
  playedSan: string;
  /** Win chance your move lost in that game */
  playedLoss: number;
  entry: RepertoireEntry;
}

/**
 * Where you left your repertoire in a game: your first move that isn't an
 * accepted move in a repertoire position. Undefined if you never did (the
 * game left the repertoire by the opponent's move, or your line ended).
 */
export const findRepertoireExit = (
  repertoire: Repertoire,
  digest: GameDigest,
  maxPlies: number = REPERTOIRE_THRESHOLDS.maxPlies
): RepertoireExit | undefined => {
  if (digest.myColor !== repertoire.color) return undefined;
  if (getFenKey(digest.moves[0]?.fenBefore ?? "") !== ROOT_KEY) {
    return undefined;
  }

  for (const move of digest.moves.slice(0, maxPlies)) {
    if (!move.isMine) continue;
    const entry = repertoire.byKey[getFenKey(move.fenBefore)];
    if (!entry || entry.excluded) return undefined;
    if (entry.accepted.includes(move.uci)) continue;
    return {
      gameId: digest.gameId,
      endTime: digest.endTime,
      ply: move.ply,
      playedUci: move.uci,
      playedSan: move.san,
      playedLoss: Math.max(0, move.winBefore - move.winAfter),
      entry,
    };
  }
  return undefined;
};

export interface RepertoireLine {
  /** Opening family the line ends in, such as "Sicilian Defense" */
  family: string;
  /** Moves from the start position to where the line's drill starts */
  startPath: string[];
  startSanPath: string[];
  /** Positions where you move in this line, nearest the start first */
  entries: RepertoireEntry[];
  /** Games that reached the ends of this line */
  games: number;
}

/** True if the drill stops after this position's move */
export const isLineEnd = (repertoire: Repertoire, entry: RepertoireEntry) =>
  entry.excluded ||
  !entry.nextKey ||
  getDrillReplies(repertoire, entry.nextKey).length === 0;

const commonPrefixLength = (paths: string[][]) => {
  let length = 0;
  while (
    paths.every(
      (path) => path.length > length && path[length] === paths[0][length]
    )
  ) {
    length++;
  }
  return length;
};

/**
 * Your repertoire as lines, grouped by the opening family each line ends in.
 * A line's drill starts where that family's name first appears (just before
 * your move when your move names it), so the Italian Game starts at 3. Bc4
 * rather than at 1. e4. The positions before any family starts make up a
 * "First moves" line from the start.
 */
export const getRepertoireLines = (
  repertoire: Repertoire
): RepertoireLine[] => {
  const groups = new Map<string, RepertoireEntry[]>();
  for (const entry of repertoire.entries) {
    if (!isLineEnd(repertoire, entry)) continue;
    // Your last move can name the line (3. Bc4 makes it an Italian Game)
    const name =
      (entry.nextKey && getPositionName(entry.nextKey)) || entry.openingName;
    const family = getNameFamily(name);
    groups.set(family, [...(groups.get(family) ?? []), entry]);
  }

  const lines = [...groups.entries()].map(([family, ends]): RepertoireLine => {
    // Where the family's name first appears on each line end's path, or the
    // move before when it's your move that picks the opening, and no later
    // than the line end itself
    const starts = ends.map((end) => {
      const keys = end.nextKey ? [...end.pathKeys, end.nextKey] : end.pathKeys;
      let index = keys.findIndex(
        (key) => getNameFamily(getPositionName(key)) === family
      );
      if (index > 0 && repertoire.byKey[keys[index - 1]]) index--;
      return end.path.slice(0, Math.min(Math.max(0, index), end.path.length));
    });
    const length = commonPrefixLength(starts);
    const startPath = starts[0].slice(0, length);

    const keys = new Set(ends.flatMap((end) => end.pathKeys.slice(length)));
    const entries = repertoire.entries.filter(
      (entry) => entry.path.length >= length && keys.has(entry.key)
    );
    return {
      family,
      startPath,
      startSanPath: ends[0].sanPath.slice(0, length),
      entries,
      games: ends.reduce((sum, end) => sum + end.games, 0),
    };
  });

  lines.sort((a, b) => b.games - a.games || a.family.localeCompare(b.family));

  const covered = new Set(
    lines.flatMap((line) => line.entries.map((e) => e.key))
  );
  const firstMoves = repertoire.entries.filter((e) => !covered.has(e.key));
  if (firstMoves.length) {
    lines.unshift({
      family: FIRST_MOVES,
      startPath: [],
      startSanPath: [],
      entries: firstMoves,
      games: repertoire.games,
    });
  }
  return lines;
};

/** "1. e4 e5 2. Nf3" from SAN moves played from the start position */
export const formatSanPath = (sanPath: string[], from = 0): string =>
  sanPath
    .map((san, i) => {
      const ply = from + i;
      if (ply % 2 === 0) return `${ply / 2 + 1}. ${san}`;
      return i === 0 ? `${Math.floor(ply / 2) + 1}... ${san}` : san;
    })
    .join(" ");
