import {
  Box,
  Button,
  Skeleton,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import { Icon } from "@iconify/react";
import Image from "next/image";
import { Fragment, ReactNode } from "react";
import { MoveClassification } from "@/types/enums";
import { CLASSIFICATION_COLORS } from "@/constants";
import { CoachText } from "./states";

const renderInline = (text: string): ReactNode[] =>
  text
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={i}>
          {part.replace(/(^|\s)\*(\S[^*]*\S|\S)\*/g, "$1$2")}
        </Fragment>
      )
    );

/** Coach text inside a sentence or an alert: renders **bold**, no blocks */
export function CoachInline({ text }: { text: string }) {
  return <>{renderInline(text)}</>;
}

/** Minimal Markdown: paragraphs, bullet lists and bold */
export function CoachMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <Box component="ul" key={`ul-${blocks.length}`} sx={{ my: 0.5, pl: 2.5 }}>
        {bullets.map((b, i) => (
          <li key={i}>
            <Typography variant="body2" component="span">
              {renderInline(b)}
            </Typography>
          </li>
        ))}
      </Box>
    );
    bullets = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^([-*•]|\d+\.)\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[2]);
      continue;
    }
    flush();
    if (!line) continue;
    const heading = line.replace(/^#+\s*/, "");
    blocks.push(
      <Typography
        variant="body2"
        key={`p-${blocks.length}`}
        sx={{ my: 0.5, fontWeight: heading !== line ? 700 : undefined }}
      >
        {renderInline(heading)}
      </Typography>
    );
  }
  flush();

  return <Box>{blocks}</Box>;
}

export const CLASSIFICATION_LABELS: Record<MoveClassification, string> = {
  [MoveClassification.Splendid]: "is brilliant !!",
  [MoveClassification.Perfect]: "is a great move !",
  [MoveClassification.Best]: "is best",
  [MoveClassification.Excellent]: "is excellent",
  [MoveClassification.Okay]: "is good",
  [MoveClassification.Inaccuracy]: "is an inaccuracy",
  [MoveClassification.Mistake]: "is a mistake",
  [MoveClassification.Blunder]: "is a blunder",
  [MoveClassification.Opening]: "is a book move",
  [MoveClassification.Forced]: "is forced",
};

interface Props {
  title?: ReactNode;
  /** A line under the title, shown even while the AI text loads */
  subtitle?: ReactNode;
  classification?: MoveClassification;
  content?: CoachText;
  placeholder?: ReactNode;
  actions?: ReactNode;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  compact?: boolean;
}

export default function CoachBubble({
  title,
  subtitle,
  classification,
  content,
  placeholder,
  actions,
  onRetry,
  onOpenSettings,
  compact,
}: Props) {
  const theme = useTheme();
  const accent = classification
    ? CLASSIFICATION_COLORS[classification]
    : theme.palette.primary.main;

  return (
    <Stack direction="row" spacing={1.2} alignItems="flex-start" width="100%">
      <Box
        sx={{
          flexShrink: 0,
          width: compact ? 30 : 38,
          height: compact ? 30 : 38,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.palette.primary.main,
          color: "white",
          mt: 0.3,
        }}
      >
        <Icon icon="mdi:robot-happy-outline" height={compact ? 18 : 22} />
      </Box>

      <Box
        sx={{
          flexGrow: 1,
          minWidth: 0,
          position: "relative",
          borderRadius: 2,
          px: 1.5,
          py: 1,
          backgroundColor:
            theme.palette.mode === "dark"
              ? "rgba(255,255,255,0.06)"
              : "rgba(0,0,0,0.04)",
          borderLeft: `3px solid ${accent}`,
        }}
      >
        {(title || classification) && (
          <Stack direction="row" alignItems="center" spacing={0.8} mb={0.3}>
            {classification && (
              <Image
                src={`/icons/${classification}.png`}
                alt=""
                width={16}
                height={16}
              />
            )}
            <Typography
              variant="body2"
              fontWeight={700}
              sx={{ color: classification ? accent : undefined }}
            >
              {title}
            </Typography>
          </Stack>
        )}

        {subtitle && (
          <Typography variant="body2" sx={{ mb: 0.3 }}>
            {subtitle}
          </Typography>
        )}

        {content?.status === "loading" && (
          <Stack spacing={0.4}>
            <Skeleton variant="text" animation="wave" width="95%" />
            <Skeleton variant="text" animation="wave" width="70%" />
          </Stack>
        )}

        {content?.status === "done" && content.text && (
          <CoachMarkdown text={content.text} />
        )}

        {content?.status === "error" && (
          <Stack spacing={0.5}>
            <Typography variant="body2" color="error">
              {content.text}
            </Typography>
            <Stack direction="row" spacing={1}>
              {onRetry && (
                <Button size="small" onClick={onRetry}>
                  Retry
                </Button>
              )}
              {onOpenSettings && (
                <Button size="small" onClick={onOpenSettings}>
                  Coach settings
                </Button>
              )}
            </Stack>
          </Stack>
        )}

        {!content && placeholder}

        {actions && (
          <Stack direction="row" spacing={1} mt={0.5} flexWrap="wrap">
            {actions}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
