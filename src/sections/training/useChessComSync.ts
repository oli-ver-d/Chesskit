import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { getMeta, notifyDbChange } from "@/lib/db";
import {
  ChessComSyncCursor,
  ChessComSyncError,
  SYNC_CURSOR_KEY,
  syncChessComGames,
} from "@/lib/sync/chessComSync";
import {
  chessComSyncRequestAtom,
  chessComSyncStatusAtom,
  profileAtom,
} from "./states";

/** Lets the page load first */
const START_DELAY_MS = 2000;
/** On load, sync if the last sync is older than this */
const STALE_ON_LOAD_MS = 60 * 60 * 1000;
/** While a tab is open, sync this often */
const SYNC_EVERY_MS = 30 * 60 * 1000;

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * Imports your chess.com games: on load if the last sync is over an hour old,
 * every 30 minutes while a tab is open, and when a "Sync now" button is
 * pressed. New games are picked up by the background analysis.
 */
export const useChessComSync = () => {
  const profile = useAtomValue(profileAtom);
  const syncRequest = useAtomValue(chessComSyncRequestAtom);
  const setStatus = useSetAtom(chessComSyncStatusAtom);
  const handledRequest = useRef(syncRequest);

  const {
    chessComUsername: username,
    lichessUsername,
    autoSync,
    syncHistoryMonths,
  } = profile;

  useEffect(() => {
    if (!username) {
      setStatus({ state: "idle" });
      return;
    }

    const force = syncRequest !== handledRequest.current;
    handledRequest.current = syncRequest;

    const controller = new AbortController();
    const { signal } = controller;
    const user = username.trim().toLowerCase();

    const readLastSync = async () => {
      const cursor = await getMeta<ChessComSyncCursor>(SYNC_CURSOR_KEY);
      return cursor?.username === user ? cursor : undefined;
    };

    const sync = async () => {
      setStatus((prev) => ({
        state: "syncing",
        lastSyncAt: prev.lastSyncAt,
        added: 0,
      }));
      try {
        const { added } = await syncChessComGames({
          username: user,
          identity: { chessComUsername: username, lichessUsername },
          historyMonths: syncHistoryMonths,
          signal,
          onProgress: (progress) =>
            setStatus((prev) => ({ ...prev, ...progress })),
          onGamesAdded: () => notifyDbChange("games"),
        });
        if (signal.aborted) return;
        setStatus({ state: "idle", lastSyncAt: Date.now(), added });
      } catch (error) {
        if (signal.aborted) return;
        const expected = error instanceof ChessComSyncError;
        // Expected failures (unknown user, offline, rate limit) are shown in the UI
        if (expected) console.warn("chess.com sync failed:", error.message);
        else console.error("chess.com sync failed", error);
        setStatus((prev) => ({
          state: "error",
          lastSyncAt: prev.lastSyncAt,
          error: expected ? error.message : "chess.com sync failed",
        }));
      }
    };

    const run = async () => {
      const cursor = await readLastSync();
      if (signal.aborted) return;
      // Any earlier sync was aborted when this effect started
      setStatus({ state: "idle", lastSyncAt: cursor?.lastSyncAt || undefined });

      if (!force) await abortableSleep(START_DELAY_MS, signal);
      if (signal.aborted) return;

      const due =
        force ||
        (autoSync &&
          (!cursor ||
            Date.now() - cursor.lastSyncAt > STALE_ON_LOAD_MS ||
            (cursor.historyMonths ?? 0) !== syncHistoryMonths));
      if (due) await sync();

      while (autoSync && !signal.aborted) {
        await abortableSleep(SYNC_EVERY_MS, signal);
        if (!signal.aborted) await sync();
      }
    };

    run();

    return () => controller.abort();
  }, [
    username,
    lichessUsername,
    autoSync,
    syncHistoryMonths,
    syncRequest,
    setStatus,
  ]);
};
