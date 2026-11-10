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
  /** Other stored engine moves within `acceptMargin` of the best one */
  altUci?: string[];
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
}

export type PuzzleTheme =
  | "hung-piece"
  | "missed-mate"
  | "missed-capture"
  | "missed-punish"
  | GamePhase;

/** How a puzzle attempt went, for the spaced repetition */
export type PuzzleResult = "clean" | "hinted" | "failed";

export interface Puzzle {
  /** `${gameId}:${ply}` */
  id: string;
  gameId: number;
  /** Index of your move in the game (the position before it is the puzzle) */
  ply: number;
  fen: string;
  myColor: Color;
  bestUci: string;
  /** Moves that solve it: the best move and stored lines within `acceptMargin` */
  acceptUci: string[];
  /** The move you played in the game */
  playedUci: string;
  kind: "blunder" | "missed-chance";
  themes: PuzzleTheme[];
  /** Your win chance with the best move, and after the move you played */
  winBefore: number;
  winAfter: number;
  /** End time of the game, to show newer mistakes first */
  endTime?: number;
  /** Leitner box: 0 = never attempted */
  box: number;
  dueAt: number;
  createdAt: number;
  attempts: number;
  firstAttemptAt?: number;
  lastAttemptAt?: number;
  lastResult?: PuzzleResult;
}

/**
 * What's stored for one position of your opening repertoire where you move:
 * your own edits and its review schedule. The repertoire itself (which moves
 * you play, how often) is rebuilt from your digests, so new games never
 * overwrite these.
 */
export interface RepertoireNode {
  /** `${color}:${fenKey}` */
  id: string;
  /** Your colour in this repertoire */
  color: Color;
  fenKey: string;
  /** Move you chose to play here, instead of the one picked from your games */
  pinnedUci?: string;
  /** Other moves you accept here (added during a drill) */
  extraUci?: string[];
  /** Left out of drills, along with the positions after it */
  excluded?: boolean;
  /** Leitner box: 0 = never drilled */
  box: number;
  dueAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastResult?: PuzzleResult;
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

export interface ChessComSyncStatus {
  state: "idle" | "syncing" | "error";
  /** Last successful sync, ms */
  lastSyncAt?: number;
  /** Games added by the last (or current) sync */
  added?: number;
  archivesDone?: number;
  archivesTotal?: number;
  error?: string;
}

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
