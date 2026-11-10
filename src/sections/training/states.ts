import { atom, Getter } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { AnalysisDaemonStatus, ChessComSyncStatus } from "@/types/training";

export interface Profile {
  chessComUsername?: string;
  /** Stored now; lichess auto-import is not built yet (see TRAINING-PLAN.md) */
  lichessUsername?: string;
  /** Import new chess.com games automatically */
  autoSync: boolean;
  /** Months of chess.com history to import (0 = all) */
  syncHistoryMonths: number;
  /** Analyze your saved games in the background */
  autoAnalyze: boolean;
  /** How many of your most recent games the background analysis covers */
  autoAnalyzeLimit: number;
}

export const DEFAULT_PROFILE: Profile = {
  autoSync: true,
  syncHistoryMonths: 3,
  autoAnalyze: true,
  autoAnalyzeLimit: 50,
};

const storedProfileAtom = atomWithStorage<Partial<Profile>>(
  "trainingProfile",
  DEFAULT_PROFILE
);

const readProfile = (get: Getter): Profile => ({
  ...DEFAULT_PROFILE,
  ...get(storedProfileAtom),
});

/** The stored profile, with defaults for fields added after it was saved */
export const profileAtom = atom(
  readProfile,
  (get, set, update: Profile | ((prev: Profile) => Profile)) =>
    set(
      storedProfileAtom,
      typeof update === "function" ? update(readProfile(get)) : update
    )
);

/** Paused by the user from the NavBar indicator */
export const analysisPausedAtom = atomWithStorage<boolean>(
  "trainingAnalysisPaused",
  false
);

export const analysisDaemonStatusAtom = atom<AnalysisDaemonStatus>({
  phase: "idle",
  pending: 0,
  done: 0,
});

/** Games to (re-)analyze before the regular queue, e.g. "Re-analyze" on the Database page */
export const analysisPriorityAtom = atom<number[]>([]);

export const chessComSyncStatusAtom = atom<ChessComSyncStatus>({
  state: "idle",
});

/** Incremented by "Sync now" buttons */
export const chessComSyncRequestAtom = atom(0);
