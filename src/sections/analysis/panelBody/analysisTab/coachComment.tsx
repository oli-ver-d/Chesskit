import { Button, Stack } from "@mui/material";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Icon } from "@iconify/react";
import { boardAtom, currentPositionAtom, gameEvalAtom } from "../../states";
import CoachBubble, {
  CLASSIFICATION_LABELS,
} from "@/sections/coach/coachBubble";
import { useCoachLLM } from "@/sections/coach/useCoachLLM";
import { reviewAutoExplainAtom } from "@/sections/coach/states";
import {
  buildBestMoveMessages,
  buildMoveExplanationMessages,
  getBestMoveSummary,
  MoveCoachInput,
} from "@/lib/coach/prompts";
import { moveLabel, uciToSan } from "@/lib/coach/facts";
import { uciMoveParams } from "@/lib/chess";
import { MoveClassification } from "@/types/enums";
import GameSummaryButton from "./gameSummary";

const MIN_DEPTH_FOR_EXPLANATION = 10;

export default function CoachComment() {
  const position = useAtomValue(currentPositionAtom);
  const board = useAtomValue(boardAtom);
  const gameEval = useAtomValue(gameEvalAtom);
  const autoExplain = useAtomValue(reviewAutoExplainAtom);
  const { ask, get, hasKey, openSettings } = useCoachLLM();
  const setBoard = useSetAtom(boardAtom);
  /** Key of the move whose "best move" bubble is open */
  const [bestOpenKey, setBestOpenKey] = useState<string>();

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
    const input: MoveCoachInput = {
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
    };

    // What the engine preferred, when the move played wasn't its first choice
    const bestUci = evalBefore.bestMove ?? evalBefore.lines[0].pv[0];
    const bestSan = uciToSan(lastMove.before, bestUci);
    const best =
      bestUci && bestSan && bestUci !== uci
        ? {
            uci: bestUci,
            label: moveLabel(lastMove.before, bestSan),
            key: `best|${lastMove.before}|${bestUci}|${uci}`,
            messages: buildBestMoveMessages(input),
            summary: getBestMoveSummary(input),
          }
        : undefined;

    return {
      key: `move|${lastMove.before}|${uci}`,
      messages: buildMoveExplanationMessages(input),
      best,
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

  const best = request?.best;
  const bestOpen = !!best && bestOpenKey === best.key;

  const toggleBest = () => {
    if (!best) return;
    if (bestOpen) return setBestOpenKey(undefined);
    setBestOpenKey(best.key);
    if (hasKey) ask(best.key, best.messages);
  };

  /** Swaps the move played for the engine's move, as a line off the game */
  const playBestOnBoard = () => {
    if (!best) return;
    const next = new Chess();
    try {
      next.loadPgn(board.pgn());
      next.undo();
      next.move(uciMoveParams(best.uci));
    } catch {
      return;
    }
    setBoard(next);
  };

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
        actions={
          best && (
            <Button
              size="small"
              startIcon={<Icon icon="mdi:star-outline" />}
              onClick={toggleBest}
            >
              {bestOpen ? "Hide best move" : "Best move"}
            </Button>
          )
        }
      />
      {best && bestOpen && (
        <CoachBubble
          title={`Best was ${best.label}`}
          classification={MoveClassification.Best}
          content={hasKey ? get(best.key) : undefined}
          placeholder={
            <span style={{ fontSize: "0.875rem" }}>{best.summary}</span>
          }
          onRetry={() => ask(best.key, best.messages, { force: true })}
          onOpenSettings={openSettings}
          actions={
            <Button
              size="small"
              startIcon={<Icon icon="mdi:chess-knight" />}
              onClick={playBestOnBoard}
            >
              Play it on the board
            </Button>
          }
        />
      )}
      {showSummary && <GameSummaryButton />}
    </Stack>
  );
}
