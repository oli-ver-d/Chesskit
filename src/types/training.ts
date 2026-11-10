import { Color, MoveClassification } from "./enums";

export type GamePhase = "opening" | "middlegame" | "endgame";
export type GameResultForMe = "win" | "loss" | "draw";

/** One half-move of a game, with the engine facts the training features need */
export interface MoveDigest {
  /** Index of the move in the game history (0 = White's first move) */
  ply: number;
  moveNumber: number;
  color: Color;
  isMine: boolean;
  fenBefore: string;
  uci: string;
  san: string;
  classification?: MoveClassification;
  /** Win chance for the side that moved, 0–100, before the move (= best play) */
  winBefore: number;
  /** Win chance for the side that moved, 0–100, after the move */
  winAfter: number;
  /** Engine's best move in `fenBefore` */
  bestUci?: string;
  /** Best line minus second-best line win chance for the mover (puzzle uniqueness) */
  secondBestGap?: number;
  phase: GamePhase;
  /** Mover's clock after the move, in seconds, from `[%clk]` comments */
  clockAfter?: number;
  /** Piece the move left hanging, when the opponent's best reply captures it */
  hungPiece?: string;
  /** The mover had a forced mate and the played move let it go */
  missedMate?: boolean;
  /** The opponent's previous move was a mistake or a blunder */
  opponentErredPrev?: boolean;
}

/** Derived per-game data, computed once from the PGN + stored eval */
export interface GameDigest {
  gameId: number;
  version: number;
  myColor: Color;
  /** Engine settings date of the eval this digest was built from */
  evalDate: string;
  endTime?: number;
  accuracy?: number;
  result?: GameResultForMe;
  openingName?: string;
  timeClass?: string;
  moves: MoveDigest[];
  /** First ply where you left your opening repertoire (opening trainer) */
  leftRepertoireAtPly?: number;
}

export interface Puzzle {
  /** `${gameId}:${ply}` */
  id: string;
  gameId: number;
  ply: number;
  fen: string;
  myColor: Color;
  bestUci: string;
  acceptUci: string[];
  playedUci: string;
  kind: "blunder" | "missed-chance";
  themes: string[];
  box: number;
  dueAt: number;
  createdAt: number;
}

export interface RepertoireNode {
  /** `${color}:${fenKey}` */
  id: string;
  color: Color;
  fenKey: string;
  /** Move (UCI) you should play here */
  moveUci?: string;
  /** Move counts from your games: UCI → count */
  seen: Record<string, number>;
  corrected?: boolean;
  pinned?: boolean;
  box: number;
  dueAt: number;
}

export type TrainingLogKind = "puzzle" | "opening" | "blunder-check";

export interface TrainingLogEntry {
  id?: number;
  kind: TrainingLogKind;
  at: number;
  refId?: string;
  success: boolean;
  data?: Record<string, unknown>;
}

export type AnalysisDaemonPhase =
  | "idle"
  | "syncing"
  | "digesting"
  | "analyzing"
  | "paused";

export interface AnalysisDaemonStatus {
  phase: AnalysisDaemonPhase;
  /** Games waiting for engine analysis */
  pending: number;
  /** Games analyzed since the daemon started */
  done: number;
  /** Progress of the game currently being analyzed, 0–100 */
  currentProgress?: number;
  pauseReason?: string;
}
