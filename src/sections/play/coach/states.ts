import { atom } from "jotai";
import { Arrow } from "react-chessboard/dist/chessboard/types";
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
}

export const coachMessagesAtom = atom<CoachMessage[]>([]);
export const hintArrowsAtom = atom<Arrow[]>([]);
export const hintLevelAtom = atom<{ ply: number; level: number }>({
  ply: -1,
  level: 0,
});
export const showPlayMoveIconAtom = atom(true);
