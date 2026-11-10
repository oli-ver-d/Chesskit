import { Box, Stack, Tab, Tabs, Typography } from "@mui/material";
import { Icon } from "@iconify/react";
import { useRouter } from "next/router";
import { PageTitle } from "@/components/pageTitle";
import ProfileCard from "@/sections/training/profileCard";
import InsightsTab from "@/sections/training/insights/insightsTab";
import OpeningsTab from "@/sections/training/openings/openingsTab";
import PuzzlesTab from "@/sections/training/puzzles/puzzlesTab";

const TABS = [
  {
    value: "puzzles",
    label: "Puzzles",
    icon: "mdi:puzzle-outline",
  },
  {
    value: "openings",
    label: "Openings",
    icon: "mdi:book-open-page-variant-outline",
  },
  {
    value: "insights",
    label: "Insights",
    icon: "mdi:chart-box-outline",
  },
] as const;

type TabValue = (typeof TABS)[number]["value"];

export default function Train() {
  const router = useRouter();
  const tabParam = router.query.tab;
  const tab: TabValue =
    TABS.find((t) => t.value === tabParam)?.value ?? TABS[0].value;

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
          ) : tab === "openings" ? (
            <OpeningsTab />
          ) : (
            <InsightsTab />
          )}
        </Box>
      </Box>
    </Stack>
  );
}
