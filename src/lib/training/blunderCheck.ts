import { Chess, Square } from "chess.js";
import { PIECE_VALUES } from "@/lib/coach/facts";
import { TrainingLogEntry } from "@/types/training";
import { getPositionName } from "./repertoire";
import { DAY_MS } from "./schedule";
import { BLUNDER_CHECK_THRESHOLDS } from "./thresholds";

/** Off, Smart (sharp positions plus a random share of the rest) or every move */
export type BlunderCheckMode = "off" | "smart" | "every";

/** Correct: the best reply or as good. Partial: in the engine's top 3. */
export type BlunderCheckGrade = "correct" | "partial" | "missed";

/** What's logged to `trainingLog` for each blunder check */
export interface BlunderCheckLogData {
  grade: BlunderCheckGrade;
  /** Position before your candidate move */
  fen: string;
  candidateUci: string;
  answerUci: string;
  bestReplyUci: string;
  /** Win chance your candidate loses against the best reply */
  candidateLoss: number;
  candidateWasBad: boolean;
  /** You took the candidate back and played something else */
  changedMove: boolean;
}

/**
 * True if the position is sharp: you're in check, or after your move the
 * opponent has a check or a capture that doesn't lose material at first
 * glance (it takes a piece worth at least as much, or an undefended one).
 * Smart mode checks every sharp position, so being asked doesn't give away
 * whether your move is bad. Plain losing captures (a knight taking a
 * defended pawn) don't count: almost every middlegame position has one.
 */
export const isSharpPosition = (fenBefore: string, fenAfter: string) => {
  if (new Chess(fenBefore).inCheck()) return true;
  const chess = new Chess(fenAfter);
  const mover = chess.turn() === "w" ? "b" : "w";
  return chess.moves({ verbose: true }).some((move) => {
    if (/[+#]/.test(move.san)) return true;
    if (!move.captured) return false;
    if (PIECE_VALUES[move.captured] >= PIECE_VALUES[move.piece]) return true;
    return chess.attackers(move.to as Square, mover).length === 0;
  });
};

/**
 * Whether to stop and ask for the opponent's best reply before your move is
 * played. Never for a forced move, a move that ends the game, or a move that
 * stays in opening theory (a named position).
 */
export const shouldBlunderCheck = ({
  mode,
  fenBefore,
  fenAfter,
  random = Math.random,
}: {
  mode: BlunderCheckMode;
  fenBefore: string;
  fenAfter: string;
  random?: () => number;
}): boolean => {
  if (mode === "off") return false;
  if (new Chess(fenAfter).isGameOver()) return false;
  if (new Chess(fenBefore).moves().length <= 1) return false;
  if (getPositionName(fenAfter)) return false;
  if (mode === "every") return true;
  return (
    isSharpPosition(fenBefore, fenAfter) ||
    random() < BLUNDER_CHECK_THRESHOLDS.smartQuietRate
  );
};

/** An engine line after your candidate move: the reply and the opponent's win chance */
export interface ReplyLine {
  uci: string;
  win: number;
}

/**
 * Grades the reply you found for your opponent. `lines` are the engine's
 * top replies, best first; `answerWin` is the opponent's win chance after
 * your answer when it isn't one of them.
 */
export const gradeBlunderCheckAnswer = (
  answerUci: string,
  lines: ReplyLine[],
  answerWin?: number
): BlunderCheckGrade => {
  const best = lines[0];
  if (!best) return "missed";
  const rank = lines.findIndex((line) => line.uci === answerUci);
  if (rank === 0) return "correct";
  const win = rank > 0 ? lines[rank].win : answerWin;
  if (
    win !== undefined &&
    best.win - win <= BLUNDER_CHECK_THRESHOLDS.correctMargin
  ) {
    return "correct";
  }
  return rank > 0 ? "partial" : "missed";
};

export interface BlunderCheckSummary {
  checks: number;
  correct: number;
  partial: number;
  missed: number;
  /** Share of checks where you found the best reply (or as good), 0–100 */
  foundRate: number;
  /** Checks where your candidate move lost a lot to the best reply */
  badCandidates: number;
  /** Bad candidates you took back */
  saved: number;
  savedThisWeek: number;
  /** Bad candidates you played anyway */
  badKept: number;
}

export const summarizeBlunderChecks = (
  log: TrainingLogEntry[],
  now: number
): BlunderCheckSummary => {
  const checks = log
    .filter((entry) => entry.kind === "blunder-check" && entry.data)
    .map((entry) => ({
      at: entry.at,
      ...(entry.data as unknown as BlunderCheckLogData),
    }));
  const count = (grade: BlunderCheckGrade) =>
    checks.filter((c) => c.grade === grade).length;
  const bad = checks.filter((c) => c.candidateWasBad);
  const saved = bad.filter((c) => c.changedMove);
  const correct = count("correct");

  return {
    checks: checks.length,
    correct,
    partial: count("partial"),
    missed: count("missed"),
    foundRate: checks.length ? (correct / checks.length) * 100 : 0,
    badCandidates: bad.length,
    saved: saved.length,
    savedThisWeek: saved.filter((c) => c.at >= now - 7 * DAY_MS).length,
    badKept: bad.length - saved.length,
  };
};
