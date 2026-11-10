import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { Icon } from "@iconify/react";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import {
  buildPuzzleQueue,
  DEFAULT_NEW_PER_DAY,
  PuzzleQueue,
} from "@/lib/training/schedule";
import { Puzzle } from "@/types/training";
import { profileAtom, puzzleSetAtom } from "../states";
import { useTrainingOverview } from "../useTrainingOverview";
import PuzzleSolver from "./puzzleSolver";
import { usePuzzles } from "./usePuzzles";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const formatWhen = (time: number, now: number) => {
  const hours = Math.round((time - now) / (60 * 60 * 1000));
  if (hours < 1) return "within the hour";
  if (hours < 24) return `in ${plural(hours, "hour")}`;
  return `in ${plural(Math.round(hours / 24), "day")}`;
};

interface Session {
  current?: Puzzle;
  doneIds: string[];
  /** Ignore the daily new-puzzle cap ("Keep going") */
  unlimited: boolean;
  /** Drill only these puzzles (an Insights finding's "Train these") */
  setIds?: string[];
}

/** A puzzle set in order: due ones first, then the rest, newest game first */
const orderSet = (puzzles: Puzzle[], ids: string[]) =>
  puzzles
    .filter((p) => ids.includes(p.id))
    .sort(
      (a, b) =>
        (a.box ? a.dueAt : Infinity) - (b.box ? b.dueAt : Infinity) ||
        (b.endTime ?? 0) - (a.endTime ?? 0)
    );

/** Train → Puzzles: the positions you got wrong in your games, with spaced repetition */
export default function PuzzlesTab() {
  const puzzles = usePuzzles();
  const overview = useTrainingOverview();
  const profile = useAtomValue(profileAtom);
  const [now, setNow] = useState(() => Date.now());
  const [session, setSession] = useState<Session>();
  const [puzzleSet, setPuzzleSet] = useAtom(puzzleSetAtom);

  const getQueue = (unlimited: boolean, at: number): PuzzleQueue =>
    buildPuzzleQueue(
      puzzles ?? [],
      at,
      unlimited ? Infinity : DEFAULT_NEW_PER_DAY
    );

  const getSessionQueue = (
    unlimited: boolean,
    setIds: string[] | undefined,
    at: number
  ) =>
    setIds ? orderSet(puzzles ?? [], setIds) : getQueue(unlimited, at).queue;

  const pickNext = (
    doneIds: string[],
    unlimited: boolean,
    setIds?: string[]
  ) => {
    const at = Date.now();
    setNow(at);
    const current = getSessionQueue(unlimited, setIds, at).find(
      (p) => !doneIds.includes(p.id)
    );
    setSession({ current, doneIds, unlimited, setIds });
  };

  const queueInfo = getQueue(session?.unlimited ?? false, now);
  const left = session
    ? getSessionQueue(session.unlimited, session.setIds, now).filter(
        (p) => !session.doneIds.includes(p.id) && p.id !== session.current?.id
      ).length
    : 0;
  const setPuzzles = puzzleSet ? orderSet(puzzles ?? [], puzzleSet.ids) : [];

  if (!puzzles || !overview) return null;

  if (session?.current) {
    const { current, doneIds, unlimited, setIds } = session;
    return (
      <Stack gap={2}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Typography variant="body2" color="text.secondary">
            {setIds && puzzleSet ? `${puzzleSet.label} · ` : ""}Puzzle{" "}
            {doneIds.length + 1} ·{" "}
            {left ? `${left} more in the queue` : "last one in the queue"}
          </Typography>
          <Button
            size="small"
            color="inherit"
            onClick={() => setSession(undefined)}
          >
            End session
          </Button>
        </Stack>
        <PuzzleSolver
          key={current.id}
          puzzle={current}
          onNext={() => pickNext([...doneIds, current.id], unlimited, setIds)}
          onSkip={() => pickNext([...doneIds, current.id], unlimited, setIds)}
        />
      </Stack>
    );
  }

  const { queue, dueCount, newCount, newRemaining, nextDueAt } = queueInfo;
  const total = puzzles.length;
  const mastered = puzzles.filter((p) => p.box >= 4).length;

  return (
    <Stack gap={2}>
      {puzzleSet && (
        <Paper variant="outlined" sx={{ p: 2, borderColor: "primary.main" }}>
          <Stack gap={1}>
            <Typography
              variant="overline"
              color="text.secondary"
              lineHeight={1.5}
            >
              From Insights
            </Typography>
            <Typography fontWeight={700}>{puzzleSet.label}</Typography>
            <Typography variant="body2" color="text.secondary">
              {setPuzzles.length
                ? `${plural(setPuzzles.length, "puzzle")} from this part of your games, whether or not they're due.`
                : "None of these puzzles exist any more."}
            </Typography>
            <Stack direction="row" gap={1}>
              {setPuzzles.length > 0 && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<Icon icon="mdi:puzzle-outline" />}
                  onClick={() => pickNext([], false, puzzleSet.ids)}
                >
                  Solve {plural(setPuzzles.length, "puzzle")}
                </Button>
              )}
              <Button
                size="small"
                color="inherit"
                onClick={() => setPuzzleSet(undefined)}
              >
                Clear
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack gap={2}>
          {session && (
            <Typography>
              <strong>Session done.</strong> You worked through{" "}
              {plural(session.doneIds.length, "puzzle")}.
            </Typography>
          )}

          {total === 0 ? (
            <EmptyState
              hasProfile={
                !!(profile.chessComUsername || profile.lichessUsername)
              }
              myGames={overview.myGames}
              analyzedGames={overview.analyzedGames}
            />
          ) : (
            <>
              <Box>
                <Typography variant="h6" gutterBottom>
                  Puzzles from your games
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Every position where you missed a much better move, from{" "}
                  {plural(overview.digests, "analyzed game")}. Find the move you
                  missed; puzzles you get wrong come back after a few days.
                </Typography>
              </Box>

              <Stack direction="row" gap={3} flexWrap="wrap">
                <Stat value={dueCount} label="to review" />
                <Stat value={newCount} label="new today" />
                <Stat value={total} label="in total" />
                <Stat value={mastered} label="mastered" />
              </Stack>

              {queue.length > 0 ? (
                <Box>
                  <Button
                    variant="contained"
                    startIcon={<Icon icon="mdi:puzzle-outline" />}
                    onClick={() => pickNext([], session?.unlimited ?? false)}
                  >
                    Solve {plural(queue.length, "puzzle")}
                  </Button>
                </Box>
              ) : (
                <Stack gap={1} alignItems="flex-start">
                  <Typography variant="body2">
                    You're all caught up.
                    {nextDueAt
                      ? ` The next review is due ${formatWhen(nextDueAt, now)}.`
                      : ""}
                  </Typography>
                  {newRemaining > 0 && (
                    <Button
                      variant="outlined"
                      onClick={() => pickNext([], true)}
                    >
                      Keep going ({newRemaining} new)
                    </Button>
                  )}
                </Stack>
              )}
            </>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Box>
      <Typography variant="h5" component="p">
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

function EmptyState({
  hasProfile,
  myGames,
  analyzedGames,
}: {
  hasProfile: boolean;
  myGames: number;
  analyzedGames: number;
}) {
  const message = !hasProfile
    ? "Add your chess.com username above. Your games are imported and analyzed in the background, and every blunder or missed tactic becomes a puzzle."
    : myGames === 0
      ? "No games of yours yet. They're imported from chess.com automatically, or you can add games on the Database page."
      : analyzedGames === 0
        ? `Your ${plural(myGames, "game")} are being analyzed in the background. Puzzles appear here as each game finishes.`
        : `No puzzles yet: no clear mistakes in your ${plural(analyzedGames, "analyzed game")}. More appear as your games are analyzed.`;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Puzzles from your games
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}
