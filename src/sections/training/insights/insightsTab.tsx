import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { Icon } from "@iconify/react";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { buildWeaknessReportMessages } from "@/lib/coach/prompts";
import { getFindingsKey, Insights } from "@/lib/training/insights";
import { INSIGHT_THRESHOLDS } from "@/lib/training/thresholds";
import CoachBubble from "@/sections/coach/coachBubble";
import { useCoachLLM } from "@/sections/coach/useCoachLLM";
import { profileAtom } from "../states";
import { useTrainingOverview } from "../useTrainingOverview";
import FindingCard from "./findingCard";
import InsightsCharts from "./insightsCharts";
import { useInsights } from "./useInsights";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pct = (n: number | undefined) =>
  n === undefined ? "–" : `${Math.round(n)}%`;

function Stat({ value, label }: { value: string | number; label: string }) {
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

const MAX_TOKENS = 600;

function CoachRead({ insights }: { insights: Insights }) {
  const { ask, get, hasKey, openSettings } = useCoachLLM();
  const [open, setOpen] = useState(false);

  const key = `insights|${getFindingsKey(insights)}`;
  const messages = () =>
    buildWeaknessReportMessages({
      games: insights.games,
      score: insights.overall.score,
      accuracy: insights.overall.accuracy,
      phases: insights.byPhase
        .filter((p) => p.moves > 0)
        .map(
          (p) =>
            `${p.phase}: ${p.moves} moves, accuracy ${Math.round(p.accuracy)}%, ${
              Math.round(p.blundersPer100 * 10) / 10
            } blunders per 100 moves`
        ),
      findings: insights.findings.slice(0, 6).map((f) => ({
        title: f.title,
        detail: f.detail,
        severity: f.severity,
      })),
    });
  const cached = get(key);

  const request = (force: boolean) =>
    ask(key, messages(), { maxTokens: MAX_TOKENS, force });

  if (!open) {
    return (
      <Box>
        <Button
          variant="outlined"
          size="small"
          startIcon={<Icon icon="mdi:robot-happy-outline" />}
          onClick={() => {
            if (!hasKey) {
              openSettings();
              return;
            }
            setOpen(true);
            if (!cached || cached.status === "error") request(false);
          }}
        >
          Coach&apos;s read
        </Button>
      </Box>
    );
  }

  return (
    <CoachBubble
      title="Coach's read"
      content={cached ?? { status: "loading" }}
      onRetry={() => request(true)}
      onOpenSettings={openSettings}
      actions={
        <Button
          size="small"
          onClick={() => request(true)}
          disabled={cached?.status === "loading"}
        >
          Regenerate
        </Button>
      }
    />
  );
}

function EmptyState() {
  const overview = useTrainingOverview();
  const profile = useAtomValue(profileAtom);
  if (!overview) return null;

  const hasProfile = !!(profile.chessComUsername || profile.lichessUsername);
  const message = !hasProfile
    ? "Add your chess.com username above. Once your games are imported and analyzed, this page shows the patterns across them."
    : overview.myGames === 0
      ? "No games of yours yet. They're imported from chess.com automatically, or you can add games on the Database page."
      : `Your ${plural(overview.myGames, "game")} are being analyzed in the background. Insights appear here as games finish.`;

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>
        Insights
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Paper>
  );
}

/** Train → Insights: the weakness report across all your analyzed games */
export default function InsightsTab() {
  const insights = useInsights();
  if (!insights) return null;
  if (insights.games === 0) return <EmptyState />;

  const { overall, findings } = insights;
  const fewGames = insights.games < INSIGHT_THRESHOLDS.minGames * 2;

  return (
    <Stack gap={2}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack gap={2}>
          <Box>
            <Typography variant="h6" gutterBottom>
              Your games at a glance
            </Typography>
            <Typography variant="body2" color="text.secondary">
              From {plural(insights.games, "analyzed game")} and{" "}
              {plural(insights.moves, "move")} of yours. Each finding compares
              part of your games with the rest, so it shows your own weak spots,
              not how you compare with other players.
            </Typography>
          </Box>

          <Stack direction="row" gap={3} flexWrap="wrap">
            <Stat value={pct(overall.score)} label="score" />
            <Stat value={pct(overall.accuracy)} label="accuracy" />
            <Stat
              value={Math.round(overall.blundersPer100 * 10) / 10}
              label="blunders / 100 moves"
            />
            <Stat
              value={Math.round(overall.hungPerGame * 10) / 10}
              label="hung pieces / game"
            />
          </Stack>

          <CoachRead insights={insights} />
        </Stack>
      </Paper>

      <Typography variant="h6" component="h2" mt={1}>
        What to work on
      </Typography>
      {findings.length ? (
        findings.map((finding) => (
          <FindingCard key={finding.id} finding={finding} />
        ))
      ) : (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary">
            No clear weakness stands out yet.
            {fewGames
              ? ` Findings need enough games to be sure, and you have ${plural(insights.games, "analyzed game")} so far.`
              : " Your mistakes are spread evenly across your games."}
          </Typography>
        </Paper>
      )}
      {findings.length > 0 && fewGames && (
        <Typography variant="caption" color="text.secondary">
          Based on {plural(insights.games, "game")}: findings get more reliable
          as more of your games are analyzed.
        </Typography>
      )}

      <Typography variant="h6" component="h2" mt={1}>
        The numbers
      </Typography>
      <InsightsCharts insights={insights} />
    </Stack>
  );
}
