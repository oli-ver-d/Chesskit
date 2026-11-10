import {
  Button,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { Icon } from "@iconify/react";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { getMeta } from "@/lib/db";
import { ChessComRatings, RATINGS_KEY } from "@/lib/sync/chessComSync";
import { ChessComSyncStatus } from "@/types/training";
import {
  chessComSyncRequestAtom,
  chessComSyncStatusAtom,
  profileAtom,
} from "./states";

const formatAgo = (time: number, now: number) => {
  const minutes = Math.round((now - time) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(time).toLocaleDateString();
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const getSyncStatusText = (
  status: ChessComSyncStatus,
  now: number
): string => {
  if (status.state === "syncing") {
    const total = status.archivesTotal ?? 0;
    const months =
      total > 1
        ? ` (month ${Math.min((status.archivesDone ?? 0) + 1, total)} of ${total})`
        : "";
    return `Importing from chess.com${months}: ${plural(status.added ?? 0, "new game")}`;
  }
  if (status.state === "error") return status.error ?? "chess.com sync failed";
  if (!status.lastSyncAt) return "Not synced yet";
  const added =
    status.added !== undefined ? ` · ${plural(status.added, "new game")}` : "";
  return `Synced ${formatAgo(status.lastSyncAt, now)}${added}`;
};

/** "Synced 5 min ago · 3 new games" and a "Sync now" button */
export function ChessComSyncStatusLine() {
  const profile = useAtomValue(profileAtom);
  const status = useAtomValue(chessComSyncStatusAtom);
  const requestSync = useSetAtom(chessComSyncRequestAtom);
  const now = useNow();

  if (!profile.chessComUsername) return null;

  const syncing = status.state === "syncing";

  return (
    <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
      <Button
        size="small"
        variant="outlined"
        disabled={syncing}
        onClick={() => requestSync((n) => n + 1)}
        startIcon={
          syncing ? (
            <CircularProgress size={14} />
          ) : (
            <Icon icon="mdi:sync" width={16} />
          )
        }
      >
        Sync now
      </Button>
      <Typography
        variant="body2"
        color={status.state === "error" ? "error" : "text.secondary"}
      >
        {getSyncStatusText(status, now)}
      </Typography>
    </Stack>
  );
}

/** Your current chess.com ratings, saved by the last sync */
export function ChessComRatingChips() {
  const profile = useAtomValue(profileAtom);
  const status = useAtomValue(chessComSyncStatusAtom);
  const [ratings, setRatings] = useState<ChessComRatings>();

  const user = profile.chessComUsername?.trim().toLowerCase();

  useEffect(() => {
    if (!user || status.state !== "idle") return;
    let cancelled = false;
    getMeta<ChessComRatings>(RATINGS_KEY).then((value) => {
      if (!cancelled) setRatings(value?.username === user ? value : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [user, status.state, status.lastSyncAt]);

  if (!user || !ratings) return null;

  const entries = (["bullet", "blitz", "rapid", "daily"] as const).filter(
    (key) => ratings[key]
  );
  if (!entries.length) return null;

  return (
    <Stack direction="row" gap={1} flexWrap="wrap">
      {entries.map((key) => (
        <Chip
          key={key}
          size="small"
          variant="outlined"
          label={`${key[0].toUpperCase()}${key.slice(1)} ${ratings[key]}`}
        />
      ))}
    </Stack>
  );
}

/** Re-renders every minute so "5 min ago" stays right */
const useNow = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  return now;
};
