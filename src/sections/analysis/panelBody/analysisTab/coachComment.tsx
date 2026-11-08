import { Button, Stack } from "@mui/material";
import { useAtomValue } from "jotai";
import { useEffect, useMemo } from "react";
import { Icon } from "@iconify/react";
import { boardAtom, currentPositionAtom, gameEvalAtom } from "../../states";
import CoachBubble, {
  CLASSIFICATION_LABELS,
} from "@/sections/coach/coachBubble";
import { useCoachLLM } from "@/sections/coach/useCoachLLM";
import { reviewAutoExplainAtom } from "@/sections/coach/states";
import { buildMoveExplanationMessages } from "@/lib/coach/prompts";
import { moveLabel } from "@/lib/coach/facts";
import GameSummaryButton from "./gameSummary";

const MIN_DEPTH_FOR_EXPLANATION = 10;

export default function CoachComment() {
  const position = useAtomValue(currentPositionAtom);
  const board = useAtomValue(boardAtom);
  const gameEval = useAtomValue(gameEvalAtom);
  const autoExplain = useAtomValue(reviewAutoExplainAtom);
  const { ask, get, hasKey, openSettings } = useCoachLLM();

  const lastMove = position.lastMove;
  const evalBefore = position.lastEval;
  const evalAfter = position.eval;
  const isFromGameReview = !!gameEval && position.currentMoveIdx !== undefined;

  const request = useMemo(() => {
    if (!lastMove || !evalBefore?.lines?.length || !evalAfter?.lines?.length)
      return undefined;

    const deepEnough =
      isFromGameReview ||
      ((evalBefore.lines[0].depth ?? 0) >= MIN_DEPTH_FOR_EXPLANATION &&
        (evalAfter.lines[0].depth ?? 0) >= MIN_DEPTH_FOR_EXPLANATION);
    if (!deepEnough) return undefined;

    const uci = `${lastMove.from}${lastMove.to}${lastMove.promotion ?? ""}`;
    return {
      key: `move|${lastMove.before}|${uci}`,
      messages: buildMoveExplanationMessages({
        fenBefore: lastMove.before,
        fenAfter: lastMove.after,
        san: lastMove.san,
        uci,
        evalBefore,
        evalAfter,
        classification: evalAfter.moveClassification,
        opening: evalAfter.opening ?? position.opening,
        plyIndex: board.history().length - 1,
        audience: "review",
      }),
    };
  }, [
    lastMove,
    evalBefore,
    evalAfter,
    isFromGameReview,
    position.opening,
    board,
  ]);

  const cached = request ? get(request.key) : undefined;

  // Auto-explain reviewed moves, debounced so quickly stepping through moves
  // doesn't fire a request for every position.
  useEffect(() => {
    if (!request || !hasKey || !autoExplain || !isFromGameReview) return;
    if (cached) return;
    const timeout = setTimeout(() => {
      ask(request.key, request.messages);
    }, 450);
    return () => clearTimeout(timeout);
  }, [request?.key, hasKey, autoExplain, isFromGameReview]); // eslint-disable-line react-hooks/exhaustive-deps

  const showSummary = !!gameEval;

  if (!lastMove) {
    if (!showSummary) return null;
    return (
      <Stack width="100%" alignItems="center">
        <GameSummaryButton />
      </Stack>
    );
  }

  const classification = evalAfter?.moveClassification;
  const title = (
    <>
      {moveLabel(lastMove.before, lastMove.san)}{" "}
      {classification ? CLASSIFICATION_LABELS[classification] : ""}
    </>
  );

  const placeholder = !hasKey ? (
    <Stack spacing={0.5} alignItems="flex-start">
      <span style={{ fontSize: "0.875rem" }}>
        Add your OpenRouter key to get coach explanations for every move.
      </span>
      <Button
        size="small"
        startIcon={<Icon icon="mdi:key-variant" />}
        onClick={openSettings}
      >
        Set up AI Coach
      </Button>
    </Stack>
  ) : !request ? (
    <span style={{ fontSize: "0.875rem", opacity: 0.7 }}>
      Waiting for the engine…
    </span>
  ) : (
    <Button
      size="small"
      startIcon={<Icon icon="mdi:chat-processing-outline" />}
      onClick={() => ask(request.key, request.messages)}
    >
      Explain this move
    </Button>
  );

  return (
    <Stack width="100%" spacing={1} alignItems="center" maxWidth="32rem">
      <CoachBubble
        title={title}
        classification={classification}
        content={cached}
        placeholder={placeholder}
        onRetry={
          request
            ? () => ask(request.key, request.messages, { force: true })
            : undefined
        }
        onOpenSettings={openSettings}
      />
      {showSummary && <GameSummaryButton />}
    </Stack>
  );
}
