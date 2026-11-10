import {
  Box,
  Button,
  Checkbox,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import CoachBubble, {
  CLASSIFICATION_LABELS,
} from "@/sections/coach/coachBubble";
import { useCoachLLM } from "@/sections/coach/useCoachLLM";
import { BlunderCheckMode } from "@/lib/training/blunderCheck";
import {
  blunderCheckModeAtom,
  CoachVerbosity,
  playCoachEnabledAtom,
  playCoachTakebacksAtom,
  playCoachVerbosityAtom,
} from "@/sections/coach/states";
import { coachMessagesAtom, CoachMessage } from "./states";
import { usePlayCoach } from "./usePlayCoach";
import { useBlunderCheck } from "./useBlunderCheck";
import BlunderCheckPanel from "./blunderCheckPanel";
import { gameAtom, isGameInProgressAtom } from "../states";

const VERBOSITY_OPTIONS: {
  value: CoachVerbosity;
  label: string;
  help: string;
}[] = [
  {
    value: "all",
    label: "Explain every move",
    help: "Your moves and the bot's",
  },
  {
    value: "key",
    label: "Key moments",
    help: "Mistakes, great moves and threats",
  },
  { value: "off", label: "Hints only", help: "Badges, hints and takebacks" },
];

const HINT_LABELS = ["Hint", "Bigger hint", "Show best move"];

const BLUNDER_CHECK_OPTIONS: {
  value: BlunderCheckMode;
  label: string;
  help: string;
}[] = [
  { value: "off", label: "Off", help: "Moves are played straight away" },
  {
    value: "smart",
    label: "Smart",
    help: "In sharp positions (checks and captures in the air) and on some quiet moves",
  },
  { value: "every", label: "Every move", help: "Outside opening theory" },
];

export default function CoachPanel() {
  const [enabled, setEnabled] = useAtom(playCoachEnabledAtom);
  const [verbosity, setVerbosity] = useAtom(playCoachVerbosityAtom);
  const [takebacks, setTakebacks] = useAtom(playCoachTakebacksAtom);
  const messages = useAtomValue(coachMessagesAtom);
  const isGameInProgress = useAtomValue(isGameInProgressAtom);
  const game = useAtomValue(gameAtom);
  const { get, hasKey, openSettings } = useCoachLLM();
  const { canHint, hintLevel, requestHint, takeback, engineReady, getEval } =
    usePlayCoach();
  const [blunderCheckMode, setBlunderCheckMode] = useAtom(blunderCheckModeAtom);
  const { check, confirm, change, skip } = useBlunderCheck(getEval);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, get]);

  const latestPly = game.history().length;

  const renderMessage = (message: CoachMessage) => {
    const content = message.textKey
      ? get(message.textKey)
      : message.text
        ? { status: "done" as const, text: message.text }
        : message.kind === "player" && !message.classification
          ? { status: "loading" as const }
          : undefined;

    const title =
      message.kind === "player" && message.classification
        ? `${message.title} ${CLASSIFICATION_LABELS[message.classification]}`
        : message.title;

    // Takeback is only offered while this is still the latest player move
    const showTakeback =
      message.canTakeback &&
      isGameInProgress &&
      latestPly >= message.ply &&
      latestPly <= message.ply + 1;

    return (
      <CoachBubble
        key={message.id}
        compact
        title={title}
        classification={message.classification}
        content={content}
        onOpenSettings={openSettings}
        actions={
          showTakeback ? (
            <Button
              size="small"
              variant="contained"
              color="warning"
              startIcon={<Icon icon="mdi:undo" />}
              onClick={() => takeback(message)}
            >
              Take back &amp; retry
            </Button>
          ) : undefined
        }
      />
    );
  };

  return (
    <Stack width="100%" spacing={1.5}>
      <Divider />
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={1}>
          <Icon icon="mdi:robot-happy-outline" height={22} />
          <Typography fontWeight={700}>Coach</Typography>
        </Stack>
        <Stack direction="row" alignItems="center">
          <Tooltip title={enabled ? "Turn coach off" : "Turn coach on"}>
            <Switch
              size="small"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
          </Tooltip>
          <IconButton
            size="small"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            aria-label="coach options"
          >
            <Icon icon="mdi:tune-variant" />
          </IconButton>
        </Stack>
      </Stack>

      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
      >
        {VERBOSITY_OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            selected={verbosity === option.value}
            onClick={() => setVerbosity(option.value)}
          >
            <ListItemIcon>
              {verbosity === option.value && <Icon icon="mdi:check" />}
            </ListItemIcon>
            <ListItemText primary={option.label} secondary={option.help} />
          </MenuItem>
        ))}
        <Divider />
        <MenuItem onClick={() => setTakebacks(!takebacks)}>
          <ListItemIcon>
            <Checkbox size="small" checked={takebacks} sx={{ p: 0 }} />
          </ListItemIcon>
          <ListItemText primary="Offer takebacks on mistakes" />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            openSettings();
          }}
        >
          <ListItemIcon>
            <Icon icon="mdi:key-variant" />
          </ListItemIcon>
          <ListItemText primary="API key & model" />
        </MenuItem>
      </Menu>

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        gap={1}
        flexWrap="wrap"
      >
        <Tooltip title="Before your move is played, find your opponent's best reply">
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Icon icon="mdi:shield-search" height={18} />
            <Typography variant="body2">Blunder check</Typography>
          </Stack>
        </Tooltip>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={blunderCheckMode}
          onChange={(_, value: BlunderCheckMode | null) =>
            value && setBlunderCheckMode(value)
          }
        >
          {BLUNDER_CHECK_OPTIONS.map((option) => (
            <Tooltip key={option.value} title={option.help}>
              <ToggleButton
                value={option.value}
                sx={{ py: 0.25, textTransform: "none" }}
              >
                {option.label}
              </ToggleButton>
            </Tooltip>
          ))}
        </ToggleButtonGroup>
      </Stack>

      {check && (
        <BlunderCheckPanel
          check={check}
          confirm={confirm}
          change={change}
          skip={skip}
        />
      )}

      {enabled && (
        <>
          <Box
            ref={scrollRef}
            sx={{
              maxHeight: { xs: "45vh", md: "50vh" },
              overflowY: "auto",
              pr: 0.5,
            }}
          >
            <Stack spacing={1.2}>
              {messages.length === 0 && (
                <CoachBubble
                  compact
                  content={{
                    status: "done",
                    text: !hasKey
                      ? "I'll grade your moves with Stockfish as you play. Add an OpenRouter key and I'll also explain them, warn you about threats and give hints."
                      : isGameInProgress
                        ? "Your move! Ask me for a hint any time."
                        : "Start a game and I'll comment on your moves as you play.",
                  }}
                  actions={
                    !hasKey ? (
                      <Button
                        size="small"
                        startIcon={<Icon icon="mdi:key-variant" />}
                        onClick={openSettings}
                      >
                        Set up AI Coach
                      </Button>
                    ) : undefined
                  }
                />
              )}
              {messages.map(renderMessage)}
            </Stack>
          </Box>

          {isGameInProgress && hintLevel < 3 && !check && (
            <Stack direction="row" spacing={1} justifyContent="center">
              <Button
                variant="outlined"
                startIcon={<Icon icon="mdi:lightbulb-on-outline" />}
                disabled={!canHint}
                onClick={requestHint}
              >
                {!engineReady
                  ? "Loading engine…"
                  : HINT_LABELS[Math.min(hintLevel, 2)]}
              </Button>
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
