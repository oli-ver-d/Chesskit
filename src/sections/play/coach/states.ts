import { Move } from "chess.js";
import { atom } from "jotai";
import { Arrow } from "react-chessboard/dist/chessboard/types";
import { BlunderCheckGrade } from "@/lib/training/blunderCheck";
import { MoveClassification } from "@/types/enums";

export type CoachMessageKind = "player" | "bot" | "hint" | "info";

export interface CoachMessage {
  id: string;
  kind: CoachMessageKind;
  /** Number of half-moves played when this message applies */
  ply: number;
  title?: string;
  classification?: MoveClassification;
  /** Key in the LLM cache for the AI text, if any */
  textKey?: string;
  /** Static text (no AI) */
  text?: string;
  canTakeback?: boolean;
  /** On your inaccuracies, mistakes and blunders: the move the engine preferred */
  betterMove?: BetterMove;
}

export interface BetterMove {
  /** Position before your move */
  fen: string;
  san: string;
  uci: string;
  /** Engine line starting with the better move, numbered SAN */
  line: string;
  playedUci: string;
}

export const coachMessagesAtom = atom<CoachMessage[]>([]);
export const hintArrowsAtom = atom<Arrow[]>([]);
/** "Show better move": the board shows the position before your move with arrows */
export const betterMovePreviewAtom = atom<
  { messageId: string; fen: string; arrows: Arrow[] } | undefined
>(undefined);
export const hintLevelAtom = atom<{ ply: number; level: number }>({
  ply: -1,
  level: 0,
});
export const showPlayMoveIconAtom = atom(true);

export interface BlunderCheckResult {
  grade: BlunderCheckGrade;
  /** Engine's best line for the opponent after your candidate move */
  bestLine: string[];
  /** Win chance your candidate loses against the best reply */
  candidateLoss: number;
  candidateWasBad: boolean;
  /** Key in the LLM cache for the coach's explanation, if any */
  textKey?: string;
}

/**
 * A blunder check in progress: your move is staged (shown, not played)
 * while you find the opponent's best reply, then graded.
 */
export type BlunderCheck =
  | { stage: "reply"; candidate: Move }
  | { stage: "grading"; candidate: Move; answer: Move }
  | {
      stage: "result";
      candidate: Move;
      answer: Move;
      result?: BlunderCheckResult;
    };

export const blunderCheckAtom = atom<BlunderCheck | undefined>(undefined);
/** Position where you changed your move after a check: the next move there isn't checked */
export const blunderCheckSkipFenAtom = atom<string | undefined>(undefined);
