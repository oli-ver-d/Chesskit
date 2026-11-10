/**
 * Tunable thresholds for the training features, in win-chance points (0–100)
 * for the side to move. Starting values from TRAINING-PLAN.md; tune them
 * against real games.
 */
export const TRAINING_THRESHOLDS = {
  /** A move of yours that lost at least this much becomes a puzzle */
  puzzleMinLoss: 15,
  /** Best move must beat the second-best by this much (or mate), so the puzzle has one answer */
  puzzleMinUniqueness: 8,
  /** Skip positions that were already lost even with the best move */
  puzzleMinWinBefore: 10,
  /** A move counts as "you didn't lose much more" (missed chance, not a blunder) at or above this */
  missedChanceMinWinAfter: 45,
  /** A different move this close to the best one also solves a puzzle */
  acceptMargin: 3,
} as const;

/**
 * Weakness report rules (`lib/training/insights.ts`). A finding needs a
 * segment at least this big and an effect at least this strong, compared
 * with your own baseline.
 */
export const INSIGHT_THRESHOLDS = {
  /** Games needed in a segment of games (colour, time class) */
  minGames: 8,
  /** Your moves needed in a segment of moves (phase, move numbers) */
  minMoves: 40,
  /** Blunders needed in a segment before its blunder rate counts */
  minBlunders: 3,
  /** Games needed in one opening family with one colour */
  minOpeningGames: 6,
  /** A segment's rate must be this many times the rest of your games' */
  ratio: 1.5,
  /** Score % in an opening this far below your overall score */
  openingScoreGap: 15,
  /** Game accuracy this far below the rest of your games */
  accuracyGap: 5,
  /** "Winning position": your win chance after your move, 0–100 */
  winningPosition: 80,
  /** Games needed where you reached a winning position */
  minWinningGames: 5,
  /** Expected score from winning positions, and how far below it counts */
  conversionExpected: 85,
  conversionGap: 15,
  /** Clock left, in seconds, that counts as time trouble */
  lowClock: 30,
  /** Clock left at or above which a move is played "with time" */
  comfortableClock: 60,
  /** Moves needed in time trouble */
  minLowClockMoves: 20,
  /** A puzzle theme this common among your puzzles is your top miss */
  themeShare: 0.3,
  minThemePuzzles: 5,
  /** Puzzle solve rate for a theme this far below your overall solve rate */
  themeSolveGap: 20,
  minThemeAttempts: 6,
  /** Positions listed under each finding */
  evidence: 8,
} as const;

/** Opening repertoire (`lib/training/repertoire.ts`) */
export const REPERTOIRE_THRESHOLDS = {
  /** Half-moves from the start that the repertoire covers */
  maxPlies: 16,
  /** Games a position or an opponent's reply needs to be in the repertoire */
  minGames: 2,
  /** Your usual move is replaced by the engine's when it loses this much on average */
  maxLoss: 8,
} as const;

/** Blunder-check habit training in play mode (`lib/training/blunderCheck.ts`) */
export const BLUNDER_CHECK_THRESHOLDS = {
  /** Share of quiet positions checked in Smart mode */
  smartQuietRate: 0.25,
  /** An answer this close to the best reply (opponent's win chance) is correct */
  correctMargin: 5,
  /** A candidate move losing this much to the best reply counts as bad */
  badLoss: 15,
} as const;
