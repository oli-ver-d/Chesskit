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
