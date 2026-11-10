import { Chess, Move } from "chess.js";
import { getHangingPieces } from "@/lib/coach/facts";
import { uciMoveParams } from "@/lib/chess";
import { MoveClassification } from "@/types/enums";
import { GameDigest, MoveDigest, Puzzle, PuzzleTheme } from "@/types/training";
import { TRAINING_THRESHOLDS } from "./thresholds";

/** Bump when extraction logic changes: every game's puzzles are regenerated (boxes kept) */
export const PUZZLE_VERSION = 1;

const SKIPPED_CLASSIFICATIONS = [
  MoveClassification.Opening,
  MoveClassification.Forced,
];

export const getPuzzleId = (gameId: number, ply: number) => `${gameId}:${ply}`;

const playUci = (fen: string, uci: string): Move | undefined => {
  try {
    return new Chess(fen).move(uciMoveParams(uci));
  } catch {
    return undefined;
  }
};

/** True if `move` captures a piece the opponent had left undefended or underdefended */
const capturesHangingPiece = (fen: string, move: Move): boolean => {
  if (!move.captured) return false;
  const opponent = move.color === "w" ? "b" : "w";
  return getHangingPieces(fen, opponent).some((piece) =>
    piece.includes(` on ${move.to} `)
  );
};

const isPuzzleMove = (
  move: MoveDigest
): move is MoveDigest & {
  bestUci: string;
} => {
  const { puzzleMinLoss, puzzleMinUniqueness, puzzleMinWinBefore } =
    TRAINING_THRESHOLDS;

  if (!move.isMine || !move.bestUci || move.bestUci === move.uci) return false;
  if (move.altUci?.includes(move.uci)) return false;
  if (
    move.classification &&
    SKIPPED_CLASSIFICATIONS.includes(move.classification)
  ) {
    return false;
  }
  if (move.winBefore - move.winAfter < puzzleMinLoss) return false;
  if (move.winBefore < puzzleMinWinBefore) return false;

  // Many moves win here: a poor puzzle. A missed mate is always a fair one.
  const unique =
    move.missedMate ||
    move.secondBestGap === undefined ||
    move.secondBestGap >= puzzleMinUniqueness;
  return unique;
};

const getThemes = (move: MoveDigest, best: Move): PuzzleTheme[] => {
  const themes: PuzzleTheme[] = [];
  if (move.missedMate) themes.push("missed-mate");
  if (capturesHangingPiece(move.fenBefore, best)) themes.push("missed-capture");
  if (move.hungPiece) themes.push("hung-piece");
  if (move.opponentErredPrev) themes.push("missed-punish");
  themes.push(move.phase);
  return themes;
};

/**
 * The positions in one of your analyzed games where you missed a clearly
 * better move, as new (never attempted) puzzles.
 */
export const extractPuzzles = (digest: GameDigest, now: number): Puzzle[] =>
  digest.moves.filter(isPuzzleMove).flatMap((move): Puzzle[] => {
    const best = playUci(move.fenBefore, move.bestUci);
    if (!best) return [];

    return [
      {
        id: getPuzzleId(digest.gameId, move.ply),
        gameId: digest.gameId,
        ply: move.ply,
        fen: move.fenBefore,
        myColor: digest.myColor,
        bestUci: move.bestUci,
        acceptUci: [move.bestUci, ...(move.altUci ?? [])],
        playedUci: move.uci,
        kind:
          move.winAfter >= TRAINING_THRESHOLDS.missedChanceMinWinAfter
            ? "missed-chance"
            : "blunder",
        themes: getThemes(move, best),
        winBefore: move.winBefore,
        winAfter: move.winAfter,
        endTime: digest.endTime,
        box: 0,
        dueAt: 0,
        createdAt: now,
        attempts: 0,
      },
    ];
  });

/**
 * Merges freshly extracted puzzles for one game into the stored ones. A puzzle
 * that still qualifies keeps its schedule and history (re-analysis may change
 * its answer); one that no longer qualifies is deleted.
 */
export const mergeGamePuzzles = (
  existing: Puzzle[],
  fresh: Puzzle[]
): { put: Puzzle[]; remove: string[] } => {
  const stored = new Map(existing.map((puzzle) => [puzzle.id, puzzle]));
  const freshIds = new Set(fresh.map((puzzle) => puzzle.id));

  const put = fresh.flatMap((puzzle) => {
    const old = stored.get(puzzle.id);
    if (!old) return [puzzle];

    const merged: Puzzle = {
      ...puzzle,
      box: old.box,
      dueAt: old.dueAt,
      createdAt: old.createdAt,
      attempts: old.attempts,
      firstAttemptAt: old.firstAttemptAt,
      lastAttemptAt: old.lastAttemptAt,
      lastResult: old.lastResult,
    };
    return isSamePuzzle(old, merged) ? [] : [merged];
  });

  return {
    put,
    remove: existing.map((p) => p.id).filter((id) => !freshIds.has(id)),
  };
};

const isSamePuzzle = (a: Puzzle, b: Puzzle) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(
    (key) =>
      JSON.stringify(a[key as keyof Puzzle]) ===
      JSON.stringify(b[key as keyof Puzzle])
  );
};

/** Key for spotting the same position in different games (move counters ignored) */
export const getFenKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");
