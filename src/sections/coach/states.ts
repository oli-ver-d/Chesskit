import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const DEFAULT_COACH_MODEL = "google/gemini-2.5-flash";

export const coachApiKeyAtom = atomWithStorage<string>("aiCoachApiKey", "");
export const coachModelAtom = atomWithStorage<string>(
  "aiCoachModel",
  DEFAULT_COACH_MODEL
);
export const coachSettingsOpenAtom = atom(false);

/** Review: automatically explain each move as you step through a reviewed game */
export const reviewAutoExplainAtom = atomWithStorage<boolean>(
  "aiCoachAutoExplain",
  true
);

export type CoachVerbosity = "all" | "key" | "off";

export const playCoachEnabledAtom = atomWithStorage<boolean>(
  "aiCoachPlayEnabled",
  true
);
export const playCoachVerbosityAtom = atomWithStorage<CoachVerbosity>(
  "aiCoachPlayVerbosity",
  "key"
);
export const playCoachTakebacksAtom = atomWithStorage<boolean>(
  "aiCoachPlayTakebacks",
  true
);

export interface CoachText {
  status: "loading" | "done" | "error";
  text?: string;
}

/** Cache of LLM answers, keyed by a prompt-specific key */
export const coachTextCacheAtom = atom<Record<string, CoachText>>({});
