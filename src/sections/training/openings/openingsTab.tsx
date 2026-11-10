import {
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Link as MuiLink,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Icon } from "@iconify/react";
import NextLink from "next/link";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { uciToSan } from "@/lib/coach/facts";
import {
  findRepertoireExit,
  formatSanPath,
  getRepertoireLines,
  isEntryDue,
  Repertoire,
  RepertoireEntry,
  RepertoireLine,
} from "@/lib/training/repertoire";
import { updateRepertoireNode } from "@/lib/training/repertoireStore";
import { REPERTOIRE_THRESHOLDS } from "@/lib/training/thresholds";
import { Color } from "@/types/enums";
import { GameDigest, RepertoireNode } from "@/types/training";
import { profileAtom } from "../states";
import { useTrainingOverview } from "../useTrainingOverview";
import OpeningDrill, { describeSource } from "./openingDrill";
import { useRepertoire } from "./useRepertoire";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A position counts as learned from this Leitner box on (a week's interval) */
const LEARNED_BOX = 3;
const EXITS_SHOWN = 8;

const formatWhen = (time: number, now: number) => {
  const days = Math.round((time - now) / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  return days === 1 ? "tomorrow" : `in ${days} days`;
};

const status = (entry: RepertoireEntry, now: number) => {
  if (entry.excluded)
    return { label: "Not drilled", color: "default" as const };
  if (!entry.node?.box) return { label: "New", color: "info" as const };
  if (isEntryDue(entry, now))
    return { label: "Due", color: "warning" as const };
  return {
    label: `Next ${formatWhen(entry.node.dueAt, now)}`,
    color:
      entry.node.box >= LEARNED_BOX
        ? ("success" as const)
        : ("default" as const),
  };
};

interface Session {
  color: Color;
  line?: RepertoireLine;
}

/** Train → Openings: your repertoire from your own games, drilled with spaced repetition */
export default function OpeningsTab() {
  const data = useRepertoire();
  const [chosenColor, setChosenColor] = useState<Color>();
  const [session, setSession] = useState<Session>();
  const [now] = useState(() => Date.now());

  if (!data) return null;

  const color =
    chosenColor ??
    (data.white.entries.length || !data.black.entries.length
      ? Color.White
      : Color.Black);
  const repertoire = color === Color.White ? data.white : data.black;

  if (session) {
    return (
      <OpeningDrill
        key={`${session.color}|${session.line?.family ?? "all"}`}
        repertoire={session.color === Color.White ? data.white : data.black}
        line={session.line}
        onEnd={() => setSession(undefined)}
      />
    );
  }

  if (!data.white.entries.length && !data.black.entries.length) {
    return <EmptyState />;
  }

  const lines = getRepertoireLines(repertoire);
  const due = repertoire.entries.filter((e) => isEntryDue(e, now)).length;
  const learned = repertoire.entries.filter(
    (e) => !e.excluded && (e.node?.box ?? 0) >= LEARNED_BOX
  ).length;
  const fixes = repertoire.entries.filter(
    (e) => e.source === "corrected"
  ).length;

  return (
    <Stack gap={2}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack gap={2}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            gap={2}
            flexWrap="wrap"
          >
            <Typography variant="h6">Your repertoire</Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={color}
              onChange={(_, value: Color | null) =>
                value && setChosenColor(value)
              }
            >
              <ToggleButton value={Color.White}>
                As White ({data.white.entries.length})
              </ToggleButton>
              <ToggleButton value={Color.Black}>
                As Black ({data.black.entries.length})
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          <Typography variant="body2" color="text.secondary">
            Built from your {plural(repertoire.games, "game")} as{" "}
            {color === Color.White ? "White" : "Black"}: the move you play most
            in each position of the first {REPERTOIRE_THRESHOLDS.maxPlies / 2}{" "}
            moves, against every reply you've faced at least{" "}
            {REPERTOIRE_THRESHOLDS.minGames} times. Where your usual move loses{" "}
            {REPERTOIRE_THRESHOLDS.maxLoss}% win chance or more, the engine's
            move replaces it.
          </Typography>

          {repertoire.entries.length === 0 ? (
            <Typography variant="body2">
              Not enough games as {color === Color.White ? "White" : "Black"}{" "}
              yet: a position needs {REPERTOIRE_THRESHOLDS.minGames} games.
            </Typography>
          ) : (
            <>
              <Stack direction="row" gap={3} flexWrap="wrap">
                <Stat value={repertoire.entries.length} label="positions" />
                <Stat value={due} label="to drill" />
                <Stat value={learned} label="learned" />
                <Stat value={fixes} label="engine fixes" />
              </Stack>
              <Box>
                <Button
                  variant="contained"
                  startIcon={<Icon icon="mdi:book-open-page-variant-outline" />}
                  onClick={() => setSession({ color })}
                >
                  {due ? `Drill ${plural(due, "position")}` : "Practise anyway"}
                </Button>
              </Box>
            </>
          )}
        </Stack>
      </Paper>

      {lines.length > 0 && (
        <>
          <Typography variant="h6" component="h2" mt={1}>
            Lines
          </Typography>
          {lines.map((line) => (
            <LineCard
              key={line.family}
              repertoire={repertoire}
              line={line}
              now={now}
              onDrill={() => setSession({ color, line })}
            />
          ))}
        </>
      )}

      <Exits repertoire={repertoire} digests={data.digests} />
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

function LineCard({
  repertoire,
  line,
  now,
  onDrill,
}: {
  repertoire: Repertoire;
  line: RepertoireLine;
  now: number;
  onDrill: () => void;
}) {
  const [open, setOpen] = useState(false);
  const due = line.entries.filter((e) => isEntryDue(e, now)).length;
  const start = formatSanPath(line.startSanPath);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        gap={1}
      >
        <Box minWidth={0}>
          <Typography fontWeight={700}>{line.family}</Typography>
          <Typography variant="body2" color="text.secondary">
            {start ? `From ${start} · ` : ""}
            {plural(line.entries.length, "position")} ·{" "}
            {due ? `${due} to drill` : "nothing due"} ·{" "}
            {plural(line.games, "game")}
          </Typography>
        </Box>
        <Stack direction="row" gap={1} alignItems="center" flexShrink={0}>
          <Button size="small" variant="outlined" onClick={onDrill}>
            Drill
          </Button>
          <IconButton
            size="small"
            aria-label={open ? "Hide positions" : "Show positions"}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon icon={open ? "mdi:chevron-up" : "mdi:chevron-down"} />
          </IconButton>
        </Stack>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack mt={1.5} gap={1}>
          {line.entries.map((entry) => (
            <PositionRow
              key={entry.key}
              repertoire={repertoire}
              entry={entry}
              now={now}
            />
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}

function PositionRow({
  repertoire,
  entry,
  now,
}: {
  repertoire: Repertoire;
  entry: RepertoireEntry;
  now: number;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { label, color } = status(entry, now);
  const moves = formatSanPath(entry.sanPath);
  const yourMove = formatSanPath([...entry.sanPath, entry.san]).slice(
    moves.length
  );

  const edit = (update: (node: RepertoireNode) => RepertoireNode) => {
    setAnchor(null);
    updateRepertoireNode(repertoire.color, entry.key, update).catch((error) =>
      console.error("Saving the repertoire change failed", error)
    );
  };
  // A new move starts its schedule from scratch
  const pin = (uci: string | undefined) =>
    edit((node) => ({ ...node, pinnedUci: uci, box: 0, dueAt: 0 }));

  const bestUci = repertoire.positions[entry.key]?.bestUci;
  const bestSan = bestUci ? uciToSan(entry.fen, bestUci) : undefined;
  const others = entry.moves.filter((m) => m.uci !== entry.uci);
  const extras = entry.accepted.filter((uci) => uci !== entry.uci);

  return (
    <Stack
      direction="row"
      gap={1}
      alignItems="flex-start"
      sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}
    >
      <Box flex={1} minWidth={0}>
        <Typography variant="body2">
          {moves} <strong>{yourMove.trim() || entry.san}</strong>
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p">
          {describeSource(entry)}
          {extras.length
            ? ` Also accepted: ${extras
                .map((uci) => uciToSan(entry.fen, uci) ?? uci)
                .join(", ")}.`
            : ""}
        </Typography>
      </Box>
      <Chip size="small" label={label} color={color} variant="outlined" />
      <IconButton
        size="small"
        aria-label="Change this position"
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <Icon icon="mdi:dots-vertical" />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {others.map((move) => (
          <MenuItem key={move.uci} onClick={() => pin(move.uci)}>
            <ListItemText
              primary={`Play ${move.san} here instead`}
              secondary={`You played it in ${plural(move.count, "game")}`}
            />
          </MenuItem>
        ))}
        {bestUci &&
          bestSan &&
          bestUci !== entry.uci &&
          !others.some((m) => m.uci === bestUci) && (
            <MenuItem onClick={() => pin(bestUci)}>
              <ListItemText primary={`Play the engine's move, ${bestSan}`} />
            </MenuItem>
          )}
        {entry.source === "pinned" && (
          <MenuItem onClick={() => pin(undefined)}>
            <ListItemText
              primary="Go back to the automatic choice"
              secondary="Your most played move, or the engine's fix"
            />
          </MenuItem>
        )}
        {extras.map((uci) => (
          <MenuItem
            key={uci}
            onClick={() =>
              edit((node) => ({
                ...node,
                extraUci: node.extraUci?.filter((u) => u !== uci),
              }))
            }
          >
            <ListItemText
              primary={`Stop accepting ${uciToSan(entry.fen, uci) ?? uci}`}
            />
          </MenuItem>
        ))}
        <MenuItem
          onClick={() =>
            edit((node) => ({ ...node, excluded: !node.excluded }))
          }
        >
          <ListItemText
            primary={entry.excluded ? "Drill it again" : "Don't drill it"}
            secondary={
              entry.excluded ? undefined : "Nor the positions after it"
            }
          />
        </MenuItem>
      </Menu>
    </Stack>
  );
}

function Exits({
  repertoire,
  digests,
}: {
  repertoire: Repertoire;
  digests: GameDigest[];
}) {
  const games = digests
    .filter((d) => d.myColor === repertoire.color)
    .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
  const exits = games
    .map((digest) => findRepertoireExit(repertoire, digest))
    .filter((exit) => exit !== undefined);
  if (!exits.length) return null;

  const recent = games.slice(0, 20);
  const recentExits = recent.filter((digest) =>
    exits.some((exit) => exit.gameId === digest.gameId)
  ).length;

  return (
    <>
      <Typography variant="h6" component="h2" mt={1}>
        Where you left your repertoire
      </Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary" mb={1}>
          In {recentExits} of your last {plural(recent.length, "game")} as{" "}
          {repertoire.color === Color.White ? "White" : "Black"} you played a
          different move from your repertoire.
        </Typography>
        <Stack gap={1}>
          {exits.slice(0, EXITS_SHOWN).map((exit) => {
            const moveNumber = Math.floor(exit.ply / 2) + 1;
            const dots = exit.ply % 2 ? "..." : ".";
            return (
              <Typography key={exit.gameId} variant="body2">
                {exit.endTime
                  ? `${new Date(exit.endTime).toLocaleDateString()}: `
                  : ""}
                on move {moveNumber} you played{" "}
                <strong>
                  {moveNumber}
                  {dots} {exit.playedSan}
                </strong>
                {exit.playedLoss >= 1
                  ? ` (lost ${Math.round(exit.playedLoss)}% win chance)`
                  : ""}
                , your repertoire plays <strong>{exit.entry.san}</strong>.{" "}
                <MuiLink
                  component={NextLink}
                  href={`/?gameId=${exit.gameId}&ply=${exit.ply}`}
                >
                  See the game
                </MuiLink>
              </Typography>
            );
          })}
        </Stack>
      </Paper>
    </>
  );
}

function EmptyState() {
  const overview = useTrainingOverview();
  const profile = useAtomValue(profileAtom);
  if (!overview) return null;

  const hasProfile = !!(profile.chessComUsername || profile.lichessUsername);
  const message = !hasProfile
    ? "Add your chess.com username above. Once your games are imported and analyzed, your repertoire is built from the openings you actually play."
    : overview.myGames === 0
      ? "No games of yours yet. They're imported from chess.com automatically, or you can add games on the Database page."
      : overview.digests === 0
        ? `Your ${plural(overview.myGames, "game")} are being analyzed in the background. Your repertoire appears here as games finish.`
        : `Not enough games yet: a position goes into your repertoire once it comes up in ${REPERTOIRE_THRESHOLDS.minGames} of your analyzed games.`;

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Your repertoire
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Paper>
  );
}
