import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { AnalysisDaemonStatus } from "@/types/training";

export interface Profile {
  chessComUsername?: string;
  /** Stored now; lichess auto-import is not built yet (see TRAINING-PLAN.md) */
  lichessUsername?: string;
  /** Import new chess.com games automatically (milestone 1) */
  autoSync: boolean;
  /** Analyze your saved games in the background */
  autoAnalyze: boolean;
  /** How many of your most recent games the background analysis covers */
  autoAnalyzeLimit: number;
}

export const DEFAULT_PROFILE: Profile = {
  autoSync: true,
  autoAnalyze: true,
  autoAnalyzeLimit: 50,
};

export const profileAtom = atomWithStorage<Profile>(
  "trainingProfile",
  DEFAULT_PROFILE
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
