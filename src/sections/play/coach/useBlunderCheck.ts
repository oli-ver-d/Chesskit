import { Move } from "chess.js";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useEffectEvent } from "react";
import { useChessActions } from "@/hooks/useChessActions";
import { winChanceFor } from "@/lib/coach/facts";
import { buildBlunderCheckMessages } from "@/lib/coach/prompts";
import { getDb } from "@/lib/db";
import {
  BlunderCheckLogData,
  gradeBlunderCheckAnswer,
  ReplyLine,
} from "@/lib/training/blunderCheck";
import { BLUNDER_CHECK_THRESHOLDS } from "@/lib/training/thresholds";
import { useCoachLLM } from "@/sections/coach/useCoachLLM";
import { PositionEval } from "@/types/eval";
import { gameAtom, isGameInProgressAtom } from "../states";
import {
  BlunderCheck,
  blunderCheckAtom,
  blunderCheckSkipFenAtom,
} from "./states";

/** Depth for an answer that isn't one of the engine's top replies */
const ANSWER_DEPTH = 12;

const toUci = (move: Move) => move.from + move.to + (move.promotion ?? "");

const logCheck = (data: BlunderCheckLogData) =>
  getDb()
    .then((db) =>
      db.add("trainingLog", {
        kind: "blunder-check",
        at: Date.now(),
        refId: data.fen,
        success: data.grade === "correct",
        data: { ...data },
      })
    )
    .catch((error) => console.error("Saving the blunder check failed", error));

/**
 * Grades a staged blunder check (see `blunderCheckAtom`), and plays or
 * drops the staged move when you confirm or change it.
 */
export const useBlunderCheck = (
  getEval: (fen: string, depth?: number) => Promise<PositionEval>
) => {
  const [check, setCheck] = useAtom(blunderCheckAtom);
  const setSkipFen = useSetAtom(blunderCheckSkipFenAtom);
  const game = useAtomValue(gameAtom);
  const isGameInProgress = useAtomValue(isGameInProgressAtom);
  const { playMove } = useChessActions(gameAtom);
  const llm = useCoachLLM();

  const gameFen = game.fen();

  // A takeback, a new game or a resignation cancels the check
  useEffect(() => {
    if (!check) return;
    if (!isGameInProgress || check.candidate.before !== gameFen) {
      setCheck(undefined);
    }
  }, [gameFen, isGameInProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (candidate: Move) =>
    playMove({
      from: candidate.from,
      to: candidate.to,
      promotion: candidate.promotion,
    });

  const grade = useEffectEvent(
    async ({ candidate, answer }: { candidate: Move; answer: Move }) => {
      const me = candidate.color;
      const opponent = me === "w" ? "b" : "w";
      const isCurrent = (current: BlunderCheck | undefined) =>
        current?.stage === "grading" && current.answer.after === answer.after;

      try {
        const [before, after] = await Promise.all([
          getEval(candidate.before),
          getEval(candidate.after),
        ]);
        const lines = after.lines
          .map((line) => ({
            uci: line.pv[0],
            win: winChanceFor(line, opponent),
          }))
          .filter(
            (line): line is ReplyLine => !!line.uci && line.win !== undefined
          );
        if (!lines.length) throw new Error("No reply lines");

        const answerUci = toUci(answer);
        let answerWin: number | undefined;
        if (!lines.some((line) => line.uci === answerUci)) {
          const answerEval = await getEval(answer.after, ANSWER_DEPTH);
          answerWin = winChanceFor(answerEval.lines[0], opponent);
        }

        const myBefore = winChanceFor(before.lines[0], me) ?? 50;
        const candidateLoss = Math.max(0, myBefore - (100 - lines[0].win));
        const candidateWasBad =
          candidateLoss >= BLUNDER_CHECK_THRESHOLDS.badLoss;
        const result = gradeBlunderCheckAnswer(answerUci, lines, answerWin);
        const bestLine = after.lines[0].pv;

        let textKey: string | undefined;
        if (llm.hasKey && (result !== "correct" || candidateWasBad)) {
          textKey = `blunder-check|${candidate.after}|${answerUci}`;
          llm.ask(
            textKey,
            buildBlunderCheckMessages({
              fen: candidate.before,
              candidateUci: toUci(candidate),
              answerUci,
              grade: result,
              bestLine,
              candidateWasBad,
            }),
            { maxTokens: 200 }
          );
        }

        setCheck((current) =>
          isCurrent(current)
            ? {
                stage: "result",
                candidate,
                answer,
                result: {
                  grade: result,
                  bestLine,
                  candidateLoss,
                  candidateWasBad,
                  textKey,
                },
              }
            : current
        );
      } catch (error) {
        console.error("Blunder check failed", error);
        // Without an engine result, show the check as ungraded
        setCheck((current) =>
          isCurrent(current) ? { stage: "result", candidate, answer } : current
        );
      }
    }
  );

  useEffect(() => {
    if (check?.stage === "grading") {
      grade({ candidate: check.candidate, answer: check.answer });
    }
  }, [check]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (changedMove: boolean) => {
    if (!check) return;
    const { candidate } = check;
    if (check.stage === "result" && check.result) {
      logCheck({
        grade: check.result.grade,
        fen: candidate.before,
        candidateUci: toUci(candidate),
        answerUci: toUci(check.answer),
        bestReplyUci: check.result.bestLine[0],
        candidateLoss: Math.round(check.result.candidateLoss * 10) / 10,
        candidateWasBad: check.result.candidateWasBad,
        changedMove,
      });
    }
    setCheck(undefined);
    if (changedMove) setSkipFen(candidate.before);
    else play(candidate);
  };

  return {
    check,
    /** Play the staged move */
    confirm: () => finish(false),
    /** Drop the staged move and pick another one (not checked again) */
    change: () => finish(true),
    /** Play the staged move without answering */
    skip: () => {
      if (!check) return;
      setCheck(undefined);
      play(check.candidate);
    },
  };
};
