import { Box, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import { Icon } from "@iconify/react";
import { useRouter } from "next/router";
import { PageTitle } from "@/components/pageTitle";
import ProfileCard from "@/sections/training/profileCard";
import PuzzlesTab from "@/sections/training/puzzles/puzzlesTab";

const TABS = [
  {
    value: "puzzles",
    label: "Puzzles",
    icon: "mdi:puzzle-outline",
    description:
      "Every blunder and missed tactic from your analyzed games becomes a puzzle: find the move you missed. Puzzles you fail come back after a few days.",
  },
  {
    value: "openings",
    label: "Openings",
    icon: "mdi:book-open-page-variant-outline",
    description:
      "A repertoire built from the openings you actually play. Drill the moves; when you leave theory, the coach explains the plan behind the right move.",
  },
  {
    value: "insights",
    label: "Insights",
    icon: "mdi:chart-box-outline",
    description:
      "Patterns across all your games: where you hang pieces, when your accuracy drops, which openings you struggle against. Each finding links to the positions behind it.",
  },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default function Train() {
  const router = useRouter();
  const tabParam = router.query.tab;
  const tab: TabValue =
    TABS.find((t) => t.value === tabParam)?.value ?? TABS[0].value;
  const current = TABS.find((t) => t.value === tab) ?? TABS[0];

  const setTab = (value: TabValue) =>
    router.replace(
      { pathname: router.pathname, query: { tab: value } },
      undefined,
      {
        shallow: true,
        scroll: false,
      }
    );

  return (
    <Stack
      gap={3}
      sx={{ maxWidth: 900, mx: "auto", px: { xs: 1, sm: 2 }, width: "100%" }}
    >
      <PageTitle title="Chesskit Train" />

      <Typography variant="h4" component="h1">
        Train
      </Typography>

      <ProfileCard />

      <Box>
        <Tabs
          value={tab}
          onChange={(_, value: TabValue) => setTab(value)}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {TABS.map((t) => (
            <Tab
              key={t.value}
              value={t.value}
              label={t.label}
              icon={<Icon icon={t.icon} width={20} />}
              iconPosition="start"
            />
          ))}
        </Tabs>

        <Box mt={2}>
          {tab === "puzzles" ? (
            <PuzzlesTab />
          ) : (
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                {current.label}: coming soon
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {current.description}
              </Typography>
            </Paper>
          )}
        </Box>
      </Box>
    </Stack>
  );
}
