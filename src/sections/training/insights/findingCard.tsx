import {
  Box,
  Button,
  Chip,
  Collapse,
  Link,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Icon } from "@iconify/react";
import { useSetAtom } from "jotai";
import NextLink from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { Finding, InsightEvidence } from "@/lib/training/insights";
import { Color } from "@/types/enums";
import { puzzleSetAtom } from "../states";

const SEVERITY = {
  high: { label: "Big effect", icon: "mdi:alert-circle-outline" },
  medium: { label: "Clear effect", icon: "mdi:alert-outline" },
  low: { label: "Small effect", icon: "mdi:information-outline" },
} as const;

const SEVERITY_COLOR = {
  high: "error",
  medium: "warning",
  low: "info",
} as const;

const formatDate = (time?: number) =>
  time
    ? new Date(time).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : undefined;

export const moveLabel = (
  e: Pick<InsightEvidence, "moveNumber" | "color" | "san">
) => `${e.moveNumber}${e.color === Color.White ? "." : "…"} ${e.san}`;

function EvidenceRow({ evidence }: { evidence: InsightEvidence }) {
  const details = [
    `lost ${Math.round(evidence.loss)}% win chance`,
    evidence.openingName,
    formatDate(evidence.endTime),
  ].filter(Boolean);

  return (
    <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
      <Link
        component={NextLink}
        href={`/?gameId=${evidence.gameId}&ply=${evidence.ply}`}
        underline="hover"
        fontWeight={600}
        variant="body2"
      >
        {moveLabel(evidence)}
      </Link>
      <Typography variant="caption" color="text.secondary">
        {details.join(" · ")}
      </Typography>
    </Stack>
  );
}

export default function FindingCard({ finding }: { finding: Finding }) {
  const router = useRouter();
  const setPuzzleSet = useSetAtom(puzzleSetAtom);
  const [open, setOpen] = useState(false);
  const severity = SEVERITY[finding.severity];

  const trainThese = () => {
    setPuzzleSet({ label: finding.title, ids: finding.puzzleIds });
    router.push({ pathname: "/train", query: { tab: "puzzles" } }, undefined, {
      shallow: true,
      scroll: false,
    });
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack gap={1}>
        <Stack
          direction="row"
          gap={1}
          alignItems="flex-start"
          justifyContent="space-between"
        >
          <Typography variant="subtitle1" fontWeight={700}>
            {finding.title}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color={SEVERITY_COLOR[finding.severity]}
            icon={<Icon icon={severity.icon} width={16} />}
            label={severity.label}
            sx={{ flexShrink: 0 }}
          />
        </Stack>

        <Typography variant="body2" color="text.secondary">
          {finding.detail}
        </Typography>

        <Stack direction="row" gap={1} flexWrap="wrap">
          {finding.evidence.length > 0 && (
            <Button
              size="small"
              color="inherit"
              onClick={() => setOpen((value) => !value)}
              endIcon={
                <Icon icon={open ? "mdi:chevron-up" : "mdi:chevron-down"} />
              }
            >
              {open ? "Hide" : "See"} the positions ({finding.evidence.length})
            </Button>
          )}
          {finding.puzzleIds.length > 0 && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<Icon icon="mdi:puzzle-outline" />}
              onClick={trainThese}
            >
              Train these ({finding.puzzleIds.length})
            </Button>
          )}
        </Stack>

        <Collapse in={open} unmountOnExit>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {finding.evidence.map((evidence) => (
              <li key={`${evidence.gameId}:${evidence.ply}`}>
                <EvidenceRow evidence={evidence} />
              </li>
            ))}
          </Box>
        </Collapse>
      </Stack>
    </Paper>
  );
}
