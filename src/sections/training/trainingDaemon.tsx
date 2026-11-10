import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { subscribeDbChange, notifyDbChange } from "@/lib/db";
import { sleep } from "@/lib/helpers";
import { Stockfish18 } from "@/lib/engine/stockfish18";
import { UciEngine } from "@/lib/engine/uciEngine";
import { getRecommendedWorkersNb } from "@/lib/engine/worker";
import {
  analyzeSavedGame,
  refreshTrainingData,
} from "@/lib/training/backgroundAnalysis";
import { isGameInProgressAtom } from "@/sections/play/states";
import { evaluationProgressAtom } from "@/sections/analysis/states";
import {
  analysisDaemonStatusAtom,
  analysisPausedAtom,
  Profile,
  profileAtom,
} from "./states";

/** Lets the page load (and the profile load from localStorage) first */
const START_DELAY_MS = 3000;
/** Batch of DB changes from elsewhere (imports, saves) before rescanning */
const RESCAN_DEBOUNCE_MS = 1500;

const getPauseReason = (
  profile: Profile,
  userPaused: boolean,
  playInProgress: boolean,
  reviewInProgress: boolean
): string | undefined => {
  if (!profile.autoAnalyze) return "Background analysis is turned off";
  if (userPaused) return "Paused";
  if (playInProgress) return "Paused while you play";
  if (reviewInProgress) return "Paused while the Analysis page is working";
  return undefined;
};

/**
 * Keeps training data up to date in the background: backfills game metadata,
 * builds digests, and analyzes your recent unanalyzed games one at a time.
 * Mounted once in the layout so it survives page changes. Renders nothing.
 */
export default function TrainingDaemon() {
  const profile = useAtomValue(profileAtom);
  const userPaused = useAtomValue(analysisPausedAtom);
  const playInProgress = useAtomValue(isGameInProgressAtom);
  const reviewProgress = useAtomValue(evaluationProgressAtom);
  const setStatus = useSetAtom(analysisDaemonStatusAtom);

  const pauseReason = getPauseReason(
    profile,
    userPaused,
    playInProgress,
    !!reviewProgress
  );

  const contextRef = useRef({ profile, pauseReason });
  const wakeRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    contextRef.current = { profile, pauseReason };
    wakeRef.current();
  }, [profile, pauseReason]);

  useEffect(() => {
    let stopped = false;
    let dirty = true;
    let selfWriting = false;
    let resolveWake: (() => void) | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let engine: UciEngine | null = null;
    let engineUnsupported = false;
    const unanalyzable = new Set<number>();
    let done = 0;

    const wake = () => {
      dirty = true;
      resolveWake?.();
      resolveWake = undefined;
    };
    wakeRef.current = wake;

    const unsubscribe = subscribeDbChange((store) => {
      if (selfWriting || store !== "games") return;
      clearTimeout(debounce);
      debounce = setTimeout(wake, RESCAN_DEBOUNCE_MS);
    });

    const notify = (stores: ("games" | "digests")[]) => {
      selfWriting = true;
      stores.forEach(notifyDbChange);
      selfWriting = false;
    };

    const shutdownEngine = () => {
      engine?.shutdown();
      engine = null;
    };

    const run = async () => {
      await sleep(START_DELAY_MS);

      while (!stopped) {
        if (!dirty) {
          await new Promise<void>((resolve) => (resolveWake = resolve));
          continue;
        }
        dirty = false;

        const { profile, pauseReason } = contextRef.current;
        let refresh: Awaited<ReturnType<typeof refreshTrainingData>>;
        try {
          refresh = await refreshTrainingData(
            profile,
            profile.autoAnalyzeLimit
          );
        } catch (error) {
          console.error("Training data refresh failed", error);
          setStatus({ phase: "idle", pending: 0, done });
          continue;
        }
        if (stopped) return;
        if (refresh.gamesChanged || refresh.digestsChanged) {
          notify([
            ...(refresh.gamesChanged ? (["games"] as const) : []),
            ...(refresh.digestsChanged ? (["digests"] as const) : []),
          ]);
        }

        const queue = refresh.toAnalyze.filter((id) => !unanalyzable.has(id));
        const reason =
          pauseReason ??
          (engineUnsupported
            ? "Your browser can't run the analysis engine"
            : undefined);

        if (!queue.length || reason) {
          if (!queue.length) shutdownEngine();
          setStatus({
            phase: queue.length ? "paused" : "idle",
            pending: queue.length,
            done,
            pauseReason: queue.length ? reason : undefined,
          });
          continue;
        }

        if (!engine) {
          try {
            engine = await Stockfish18.create(true);
          } catch (error) {
            console.error("Background analysis engine failed", error);
            engineUnsupported = true;
            dirty = true;
            continue;
          }
          if (stopped) return shutdownEngine();
        }

        const gameId = queue[0];
        setStatus({
          phase: "analyzing",
          pending: queue.length,
          done,
          currentProgress: 0,
        });

        try {
          const workersNb = Math.max(
            1,
            Math.floor(getRecommendedWorkersNb() / 2)
          );
          const ok = await analyzeSavedGame(
            engine,
            gameId,
            workersNb,
            (value) =>
              setStatus((prev) => ({ ...prev, currentProgress: value }))
          );
          if (!ok) unanalyzable.add(gameId);
          else done++;
        } catch (error) {
          console.error(`Background analysis of game ${gameId} failed`, error);
          unanalyzable.add(gameId);
          // The engine may be in a bad state: start a fresh one next time
          shutdownEngine();
        }

        if (stopped) return;
        notify(["games", "digests"]);
        dirty = true;
      }
    };

    run();

    return () => {
      stopped = true;
      clearTimeout(debounce);
      unsubscribe();
      resolveWake?.();
      wakeRef.current = () => undefined;
      shutdownEngine();
    };
  }, [setStatus]);

  return null;
}
