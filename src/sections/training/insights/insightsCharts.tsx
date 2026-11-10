import {
  Box,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from "@mui/material";
import { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import { Insights, THEME_NAMES } from "@/lib/training/insights";
import { Color } from "@/types/enums";

/** dataviz reference palette, categorical slot 1, stepped per mode */
const SERIES_1 = { light: "#2a78d6", dark: "#3987e5" };

const pct = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "–" : `${Math.round(n)}%`;
const num = (n: number) => (Math.round(n * 10) / 10).toString();
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const useChartColors = () => {
  const theme = useTheme();
  return {
    bar: SERIES_1[theme.palette.mode],
    text: theme.palette.text.primary,
    muted: theme.palette.text.secondary,
    grid: theme.palette.divider,
  };
};

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={700}>
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="caption" color="text.secondary" component="p">
          {subtitle}
        </Typography>
      )}
      <Box mt={1.5}>{children}</Box>
    </Paper>
  );
}

function ChartTooltip({
  active,
  payload,
  lines,
}: TooltipProps<number, string> & {
  lines: (row: Record<string, unknown>) => string[];
}) {
  const row = payload?.[0]?.payload as Record<string, unknown> | undefined;
  if (!active || !row) return null;
  const [title, ...rest] = lines(row);
  return (
    <Paper elevation={3} sx={{ px: 1.5, py: 1 }}>
      <Typography variant="body2" fontWeight={700}>
        {title}
      </Typography>
      {rest.map((line) => (
        <Typography
          key={line}
          variant="caption"
          color="text.secondary"
          component="p"
        >
          {line}
        </Typography>
      ))}
    </Paper>
  );
}

function SimpleTable({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            {head.map((cell, i) => (
              <TableCell key={cell} align={i ? "right" : "left"}>
                {cell}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={String(row[0])}>
              {row.map((cell, i) => (
                <TableCell key={i} align={i ? "right" : "left"}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function MoveNumberChart({ insights }: { insights: Insights }) {
  const colors = useChartColors();
  const data = insights.byMoveBucket
    .filter((bucket) => bucket.moves > 0)
    .map((bucket) => ({
      ...bucket,
      value: Math.round(bucket.avgLoss * 10) / 10,
    }));

  return (
    <Section
      title="Win chance lost per move, by move number"
      subtitle={`Lower is better. Your average: ${num(insights.overall.avgLoss)} points per move.`}
    >
      <Box height={220}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 20, right: 8, left: 0, bottom: 8 }}
          >
            <CartesianGrid vertical={false} stroke={colors.grid} />
            <XAxis
              dataKey="label"
              tick={{ fill: colors.muted, fontSize: 12 }}
              axisLine={{ stroke: colors.grid }}
              tickLine={false}
              label={{
                value: "Move number",
                position: "insideBottom",
                offset: -4,
                fill: colors.muted,
                fontSize: 12,
              }}
              height={40}
            />
            <YAxis
              tick={{ fill: colors.muted, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={32}
            />
            <Tooltip
              cursor={{ fill: colors.grid, opacity: 0.4 }}
              isAnimationActive={false}
              content={
                <ChartTooltip
                  lines={(row) => [
                    `Moves ${row.label}`,
                    `${row.value} points lost per move`,
                    `Accuracy ${pct(row.accuracy as number)}`,
                    `${row.moves} moves, ${row.blunders} blunders`,
                  ]}
                />
              }
            />
            <ReferenceLine
              y={Math.round(insights.overall.avgLoss * 10) / 10}
              stroke={colors.muted}
              strokeDasharray="4 4"
            />
            <Bar
              dataKey="value"
              fill={colors.bar}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="value"
                position="top"
                fill={colors.text}
                fontSize={12}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Section>
  );
}

function OpeningChart({ insights }: { insights: Insights }) {
  const colors = useChartColors();
  const data = insights.byOpening
    .filter((opening) => opening.games >= 2)
    .slice(0, 8)
    .map((opening) => ({
      ...opening,
      name: `${opening.family} (${opening.color === Color.White ? "W" : "B"})`,
      value: Math.round(opening.score),
    }));
  if (!data.length) return null;

  return (
    <Section
      title="Score by opening"
      subtitle={`Your most played openings (W = you had White, B = Black). The dashed line is your overall score, ${pct(insights.overall.score)}.`}
    >
      <Box height={Math.max(120, data.length * 36 + 30)}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 40, left: 8, bottom: 0 }}
          >
            <CartesianGrid horizontal={false} stroke={colors.grid} />
            <XAxis
              type="number"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: colors.muted, fontSize: 12 }}
              axisLine={{ stroke: colors.grid }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={200}
              tick={{ fill: colors.text, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: colors.grid, opacity: 0.4 }}
              isAnimationActive={false}
              content={
                <ChartTooltip
                  lines={(row) => [
                    String(row.name),
                    `Score ${row.value}% in ${row.games} games`,
                    `${row.wins} won, ${row.draws} drawn, ${row.losses} lost`,
                    `Accuracy ${pct(row.accuracy as number | undefined)}`,
                  ]}
                />
              }
            />
            <ReferenceLine
              x={Math.round(insights.overall.score)}
              stroke={colors.muted}
              strokeDasharray="4 4"
            />
            <Bar
              dataKey="value"
              fill={colors.bar}
              maxBarSize={20}
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="value"
                position="right"
                formatter={(v: number) => `${v}%`}
                fill={colors.text}
                fontSize={12}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Section>
  );
}

/** Charts and tables behind the findings */
export default function InsightsCharts({ insights }: { insights: Insights }) {
  const segments = [
    ...insights.byColor.map((s) => ({
      ...s,
      name: s.key === Color.White ? "As White" : "As Black",
    })),
    ...insights.byTimeClass.map((s) => ({ ...s, name: capitalize(s.key) })),
  ];
  const themes = insights.themes.filter((t) => t.puzzles > 0);
  const { conversion } = insights;

  return (
    <Stack gap={2}>
      <MoveNumberChart insights={insights} />

      <Section title="By game phase">
        <SimpleTable
          head={[
            "Phase",
            "Moves",
            "Accuracy",
            "Blunders / 100 moves",
            "Hung pieces / game",
          ]}
          rows={insights.byPhase
            .filter((p) => p.moves > 0)
            .map((p) => [
              capitalize(p.phase),
              p.moves,
              pct(p.accuracy),
              num(p.blundersPer100),
              num(p.hungPerGame),
            ])}
        />
      </Section>

      <OpeningChart insights={insights} />

      <Section title="By colour and time control">
        <SimpleTable
          head={["", "Games", "Score", "Accuracy"]}
          rows={segments.map((s) => [
            s.name,
            s.games,
            pct(s.score),
            pct(s.accuracy),
          ])}
        />
      </Section>

      {conversion.games > 0 && (
        <Section
          title="Winning positions"
          subtitle={`Games where your win chance reached ${conversion.threshold}% after one of your moves.`}
        >
          <Typography variant="body2">
            You won <strong>{conversion.wins}</strong> of{" "}
            <strong>{conversion.games}</strong> ({pct(conversion.score)} score):{" "}
            {conversion.draws} drawn, {conversion.losses} lost.
          </Typography>
        </Section>
      )}

      {insights.byClock.length > 0 && (
        <Section
          title="By time on your clock"
          subtitle="Time left before your move, from the clock times in your games."
        >
          <SimpleTable
            head={["Clock", "Moves", "Blunders / 100 moves", "Accuracy"]}
            rows={insights.byClock.map((c) => [
              c.label,
              c.moves,
              c.moves ? num(c.blundersPer100) : "–",
              c.moves ? pct(c.accuracy) : "–",
            ])}
          />
        </Section>
      )}

      {themes.length > 0 && (
        <Section
          title="What you miss"
          subtitle="Your puzzles by theme, and how often you solve them."
        >
          <SimpleTable
            head={["Theme", "Puzzles", "Share", "Solved"]}
            rows={themes.map((t) => [
              capitalize(THEME_NAMES[t.theme]),
              t.puzzles,
              pct(t.share * 100),
              t.attempts ? `${pct(t.solveRate)} of ${t.attempts}` : "not tried",
            ])}
          />
        </Section>
      )}
    </Stack>
  );
}
