import { Color } from "./enums";
import { GameEval } from "./eval";

export interface Game {
  id: number;
  pgn: string;
  event?: string;
  site?: string;
  date?: string;
  round?: string;
  white: Player;
  black: Player;
  result?: string;
  eval?: GameEval;
  termination?: string;
  timeControl?: string;
  /** Where the game came from (added in DB v2) */
  origin?: GameSource;
  /** Stable id from the source site, e.g. the chess.com game URL, used to dedupe imports */
  externalId?: string;
  /** End of the game, ms since epoch */
  endTime?: number;
  /** The colour you played, from your profile usernames; undefined if not your game */
  myColor?: Color;
  /** chess.com time class: bullet / blitz / rapid / daily */
  timeClass?: string;
  rated?: boolean;
  openingName?: string;
  eco?: string;
}

/** Where a saved game came from */
export type GameSource = "chesscom" | "lichess" | "chesskit" | "pgn";

export interface Player {
  name: string;
  rating?: number;
  avatarUrl?: string;
  title?: string;
}

export interface LoadedGame {
  id: string;
  pgn: string;
  date?: string;
  white: Player;
  black: Player;
  result?: string;
  timeControl?: string;
  movesNb?: number;
  url?: string;
}
