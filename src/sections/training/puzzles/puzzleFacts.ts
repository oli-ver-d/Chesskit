import { Chess, Move } from "chess.js";
import { pieceOnSquare, pvToSan, uciToSan } from "@/lib/coach/facts";
import { uciMoveParams } from "@/lib/chess";
import { Game } from "@/types/game";
import { Puzzle } from "@/types/training";

/** What the solver shows about a puzzle, from the puzzle and its saved game */
export interface PuzzleContext {
  bestSan: string;
  bestLine?: string[];
  playedSan: string;
  playedFenAfter?: string;
  /** The opponent's best reply to the move played in the game */
  punishLine?: string[];
  /** The opponent's move just before the puzzle, to highlight it */
  previousMove?: Move;
}

export const getPuzzleContext = (
  puzzle: Puzzle,
  game: Game | undefined
): PuzzleContext => {
  const positions = game?.eval?.positions;
  const bestLine = positions?.[puzzle.ply]?.lines[0]?.pv;
  const punishLine = positions?.[puzzle.ply + 1]?.lines[0]?.pv;

  let playedFenAfter: string | undefined;
  try {
    playedFenAfter = new Chess(puzzle.fen).move(
      uciMoveParams(puzzle.playedUci)
    ).after;
  } catch {
    playedFenAfter = undefined;
  }

  let previousMove: Move | undefined;
  if (game && puzzle.ply > 0) {
    try {
      const chess = new Chess();
      chess.loadPgn(game.pgn);
      previousMove = chess.history({ verbose: true })[puzzle.ply - 1];
    } catch {
      previousMove = undefined;
    }
  }

  return {
    bestSan: uciToSan(puzzle.fen, puzzle.bestUci) ?? puzzle.bestUci,
    bestLine: bestLine?.[0] === puzzle.bestUci ? bestLine : undefined,
    playedSan: uciToSan(puzzle.fen, puzzle.playedUci) ?? puzzle.playedUci,
    playedFenAfter,
    punishLine,
    previousMove,
  };
};

/** First hint without an API key: points at the idea from the puzzle themes */
export const getStaticNudge = (puzzle: Puzzle): string => {
  const { themes } = puzzle;
  if (themes.includes("missed-mate")) {
    return "There's a forced checkmate here. Start by looking at checks.";
  }
  if (themes.includes("missed-capture")) {
    return "One of your opponent's pieces isn't properly defended.";
  }
  if (themes.includes("missed-punish")) {
    return "Your opponent's last move was a mistake. How can you take advantage of it?";
  }
  if (themes.includes("hung-piece")) {
    return "In the game your move left a piece hanging. Look for a move that keeps everything safe.";
  }
  return "Look at every check, capture and threat, for both sides.";
};

/** Second hint: the piece to move */
export const getPieceHint = (puzzle: Puzzle): string => {
  const square = puzzle.bestUci.slice(0, 2);
  const piece = pieceOnSquare(puzzle.fen, square) ?? "piece";
  return `Move your ${piece} on ${square}.`;
};

/** Explanation without an API key, after the puzzle is solved or revealed */
export const getStaticExplanation = (
  puzzle: Puzzle,
  context: PuzzleContext
): string => {
  const parts = [
    context.bestLine
      ? `The engine's line: ${pvToSan(puzzle.fen, context.bestLine)}.`
      : `The engine's move was ${context.bestSan}.`,
  ];
  if (context.playedFenAfter && context.punishLine?.length) {
    parts.push(
      `In the game you played ${context.playedSan}, and the best reply was ${pvToSan(
        context.playedFenAfter,
        context.punishLine,
        4
      )}.`
    );
  }
  return parts.join(" ");
};

export const THEME_LABELS: Record<string, string> = {
  "missed-mate": "Missed mate",
  "missed-capture": "Free piece",
  "hung-piece": "Hung piece",
  "missed-punish": "Punish the mistake",
  opening: "Opening",
  middlegame: "Middlegame",
  endgame: "Endgame",
};
