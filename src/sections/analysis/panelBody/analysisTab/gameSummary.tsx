import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { useAtomValue } from "jotai";
import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { Chess } from "chess.js";
import { gameAtom, gameEvalAtom } from "../../states";
import CoachBubble from "@/sections/coach/coachBubble";
import { useCoachLLM } from "@/sections/coach/useCoachLLM";
import {
  BAD_CLASSIFICATIONS,
  buildGameSummaryMessages,
  GameSummaryInput,
  GREAT_CLASSIFICATIONS,
  KeyMoment,
} from "@/lib/coach/prompts";
import {
  describeEval,
  moveLabel,
  pvToSan,
  uciToSan,
  winChanceFor,
} from "@/lib/coach/facts";
import { MoveClassification } from "@/types/enums";
import { GameEval } from "@/types/eval";

const buildSummaryInput = (
  game: Chess,
  gameEval: GameEval
): GameSummaryInput => {
  const headers = game.getHeaders();
  const history = game.history({ verbose: true });
  const counts: GameSummaryInput["counts"] = { w: {}, b: {} };
  const candidates: (KeyMoment & { swing: number })[] = [];
  let opening: string | undefined;

  history.forEach((move, i) => {
    const before = gameEval.positions[i];
    const after = gameEval.positions[i + 1];
    if (!before || !after) return;
    if (after.opening) opening = after.opening;
    const classification = after.moveClassification;
    if (!classification) return;

    counts[move.color][classification] =
      (counts[move.color][classification] ?? 0) + 1;

    const isKey =
      BAD_CLASSIFICATIONS.includes(classification) ||
      GREAT_CLASSIFICATIONS.includes(classification);
    if (!isKey) return;

    const wBefore = winChanceFor(before.lines[0], move.color) ?? 50;
    const wAfter = winChanceFor(after.lines[0], move.color) ?? 50;
    const uci = `${move.from}${move.to}${move.promotion ?? ""}`;
    const bestUci = before.bestMove ?? before.lines[0]?.pv?.[0];
    const isBad = BAD_CLASSIFICATIONS.includes(classification);

    candidates.push({
      label: moveLabel(move.before, move.san),
      color: move.color,
      classification,
      evalBefore: describeEval(before.lines[0]),
      evalAfter: move.san.includes("#")
        ? "checkmate"
        : describeEval(after.lines[0]),
      bestMove:
        isBad && bestUci !== uci ? uciToSan(move.before, bestUci) : undefined,
      bestLine:
        isBad && before.lines[0]?.pv
          ? pvToSan(move.before, before.lines[0].pv, 4)
          : undefined,
      reply: after.lines[0]?.pv?.length
        ? pvToSan(move.after, after.lines[0].pv, 3)
        : undefined,
      swing:
        Math.abs(wAfter - wBefore) +
        (classification === MoveClassification.Splendid ? 30 : 0),
    });
  });

  const keyMoments = candidates
    .sort((a, b) => b.swing - a.swing)
    .slice(0, 10)
    .sort(
      (a, b) =>
        history.findIndex((m) => moveLabel(m.before, m.san) === a.label) -
        history.findIndex((m) => moveLabel(m.before, m.san) === b.label)
    )
    .map(({ swing: _swing, ...m }) => m); // eslint-disable-line @typescript-eslint/no-unused-vars

  const movesSan = history
    .map((m, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${m.san}` : m.san))
    .join(" ");

  return {
    white: headers.White && headers.White !== "?" ? headers.White : "White",
    black: headers.Black && headers.Black !== "?" ? headers.Black : "Black",
    result:
      headers.Result && headers.Result !== "*" ? headers.Result : undefined,
    termination: headers.Termination,
    opening,
    accuracy: gameEval.accuracy,
    estimatedElo: gameEval.estimatedElo,
    counts,
    keyMoments,
    movesSan:
      movesSan.length > 3000 ? movesSan.slice(0, 3000) + " …" : movesSan,
  };
};

export default function GameSummaryButton() {
  const game = useAtomValue(gameAtom);
  const gameEval = useAtomValue(gameEvalAtom);
  const { ask, get, hasKey, openSettings } = useCoachLLM();
  const [open, setOpen] = useState(false);

  const request = useMemo(() => {
    if (!gameEval) return undefined;
    return {
      key: `summary|${game.history().join(" ")}|${gameEval.settings.date}`,
      messages: buildGameSummaryMessages(buildSummaryInput(game, gameEval)),
    };
  }, [game, gameEval]);

  if (!request) return null;
  const cached = get(request.key);

  const handleOpen = () => {
    if (!hasKey) {
      openSettings();
      return;
    }
    setOpen(true);
    if (!cached || cached.status === "error") {
      ask(request.key, request.messages, { maxTokens: 1500, force: true });
    }
  };

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        startIcon={<Icon icon="mdi:robot-happy-outline" />}
        onClick={handleOpen}
      >
        AI game summary
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Coach&apos;s game review</DialogTitle>
        <DialogContent>
          <CoachBubble
            content={cached ?? { status: "loading" }}
            onRetry={() =>
              ask(request.key, request.messages, {
                maxTokens: 1500,
                force: true,
              })
            }
            onOpenSettings={openSettings}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() =>
              ask(request.key, request.messages, {
                maxTokens: 1500,
                force: true,
              })
            }
            disabled={cached?.status === "loading"}
          >
            Regenerate
          </Button>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
