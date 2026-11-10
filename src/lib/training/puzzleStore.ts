import { IDBPObjectStore, StoreNames } from "idb";
import { ChesskitDB, getDb } from "@/lib/db";
import { GameDigest, Puzzle, PuzzleResult } from "@/types/training";
import { extractPuzzles, mergeGamePuzzles } from "./puzzles";
import { applyPuzzleAttempt } from "./schedule";

export const PUZZLE_VERSION_KEY = "puzzleVersion";

type PuzzleStore = IDBPObjectStore<
  ChesskitDB,
  ArrayLike<StoreNames<ChesskitDB>>,
  "puzzles",
  "readwrite"
>;

/**
 * Brings one game's stored puzzles in line with its digest (none if the
 * digest is gone). Call inside a readwrite transaction that includes
 * "puzzles". Returns true if anything changed.
 */
export const writeGamePuzzles = async (
  store: PuzzleStore,
  gameId: number,
  digest: GameDigest | undefined,
  now: number
): Promise<boolean> => {
  const existing = await store.index("by-gameId").getAll(gameId);
  const fresh = digest ? extractPuzzles(digest, now) : [];
  const { put, remove } = mergeGamePuzzles(existing, fresh);

  await Promise.all([
    ...put.map((puzzle) => store.put(puzzle)),
    ...remove.map((id) => store.delete(id)),
  ]);
  return put.length + remove.length > 0;
};

/** Saves an attempt: reschedules the puzzle and logs it. Returns the updated puzzle. */
export const recordPuzzleAttempt = async (
  puzzleId: string,
  result: PuzzleResult,
  details: { wrongAttempts: number; hintLevel: number; solvedUci?: string }
): Promise<Puzzle | undefined> => {
  const db = await getDb();
  const now = Date.now();
  const tx = db.transaction(["puzzles", "trainingLog"], "readwrite");

  const puzzle = await tx.objectStore("puzzles").get(puzzleId);
  if (!puzzle) {
    await tx.done;
    return undefined;
  }

  const updated = applyPuzzleAttempt(puzzle, result, now);
  await tx.objectStore("puzzles").put(updated);
  await tx.objectStore("trainingLog").add({
    kind: "puzzle",
    at: now,
    refId: puzzleId,
    success: result !== "failed",
    data: {
      result,
      ...details,
      box: updated.box,
      kind: puzzle.kind,
      themes: puzzle.themes,
    },
  });
  await tx.done;

  return updated;
};
