import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { Icon } from "@iconify/react";
import { colorName, pvToSan, uciToSan } from "@/lib/coach/facts";
import { useCoachLLM } from "@/sections/coach/useCoachLLM";
import { BlunderCheck } from "./states";

interface Props {
  check: BlunderCheck;
  confirm: () => void;
  change: () => void;
  skip: () => void;
}

/** The staged move's blunder check: find their reply, then confirm or change your move */
export default function BlunderCheckPanel({
  check,
  confirm,
  change,
  skip,
}: Props) {
  const { get } = useCoachLLM();
  const { candidate } = check;
  const opponent = colorName(candidate.color === "w" ? "b" : "w");
  const san = candidate.san;

  if (check.stage === "reply") {
    return (
      <Alert
        severity="info"
        icon={<Icon icon="mdi:shield-search" />}
        sx={{ width: "100%" }}
      >
        <strong>Blunder check.</strong>{" "}
        {`Before you play ${san}: what's ${opponent}'s best reply? Play it on the board.`}
        <Box mt={1}>
          <Button size="small" color="inherit" onClick={skip}>
            Skip, play {san}
          </Button>
        </Box>
      </Alert>
    );
  }

  if (check.stage === "grading") {
    return (
      <Stack direction="row" gap={1} alignItems="center">
        <CircularProgress size={16} />
        <Typography variant="body2">Checking your answer…</Typography>
      </Stack>
    );
  }

  const { result, answer } = check;
  const buttons = (bad: boolean) => (
    <Stack direction="row" gap={1} mt={1} flexWrap="wrap">
      <Button
        size="small"
        variant={bad ? "outlined" : "contained"}
        color={bad ? "inherit" : "primary"}
        onClick={confirm}
      >
        Play {san}
      </Button>
      <Button
        size="small"
        variant={bad ? "contained" : "outlined"}
        color={bad ? "warning" : "inherit"}
        startIcon={<Icon icon="mdi:undo" />}
        onClick={change}
      >
        Change move
      </Button>
    </Stack>
  );

  if (!result) {
    return (
      <Alert severity="info" sx={{ width: "100%" }}>
        The engine couldn't check this one.
        {buttons(false)}
      </Alert>
    );
  }

  const bestSan =
    uciToSan(candidate.after, result.bestLine[0]) ?? result.bestLine[0];
  const line = pvToSan(candidate.after, result.bestLine, 4);
  const coach = result.textKey ? get(result.textKey) : undefined;
  const loss = Math.round(result.candidateLoss);

  const answerText =
    result.grade === "correct" ? (
      <>
        <strong>Well spotted.</strong>{" "}
        {answer.san === bestSan
          ? `${bestSan} is ${opponent}'s best reply.`
          : `${answer.san} is as good as the engine's ${bestSan}.`}
      </>
    ) : result.grade === "partial" ? (
      <>
        <strong>Close.</strong> {answer.san} is a good reply, but the best is{" "}
        <strong>{bestSan}</strong>.
      </>
    ) : (
      <>
        <strong>Not quite.</strong> {opponent}'s best reply is{" "}
        <strong>{bestSan}</strong>.
      </>
    );

  return (
    <Alert
      severity={
        result.candidateWasBad
          ? "error"
          : result.grade === "correct"
            ? "success"
            : "warning"
      }
      sx={{ width: "100%" }}
    >
      {answerText}
      <Typography variant="body2" color="text.secondary" mt={0.5}>
        Engine line: {line}
      </Typography>
      {coach?.status === "done" && coach.text ? (
        <Typography variant="body2" mt={0.5}>
          {coach.text}
        </Typography>
      ) : coach?.status === "loading" ? (
        <Typography variant="body2" mt={0.5} color="text.secondary">
          The coach is thinking…
        </Typography>
      ) : null}
      <Typography variant="body2" mt={0.5}>
        {result.candidateWasBad
          ? `After ${bestSan}, ${san} costs you ${loss}% win chance. Think again?`
          : `${san} holds up against it.`}
      </Typography>
      {buttons(result.candidateWasBad)}
    </Alert>
  );
}
