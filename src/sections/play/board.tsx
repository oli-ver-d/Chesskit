import { useAtom, useAtomValue } from "jotai";
import { Move } from "chess.js";
import { CSSProperties, useEffect, useMemo } from "react";
import { Arrow } from "react-chessboard/dist/chessboard/types";
import {
  engineEloAtom,
  gameAtom,
  playerColorAtom,
  isGameInProgressAtom,
  gameDataAtom,
  enginePlayNameAtom,
} from "./states";
import { useChessActions } from "@/hooks/useChessActions";
import { useScreenSize } from "@/hooks/useScreenSize";
import { useEngine } from "@/hooks/useEngine";
import { uciMoveParams } from "@/lib/chess";
import Board from "@/components/board";
import { useGameData } from "@/hooks/useGameData";
import { usePlayersData } from "@/hooks/usePlayersData";
import { sleep } from "@/lib/helpers";
import { shouldBlunderCheck } from "@/lib/training/blunderCheck";
import { blunderCheckModeAtom } from "@/sections/coach/states";
import { Color } from "@/types/enums";
import {
  blunderCheckAtom,
  blunderCheckSkipFenAtom,
  hintArrowsAtom,
  showPlayMoveIconAtom,
} from "./coach/states";

const STAGED_STYLE: CSSProperties = {
  backgroundColor: "rgba(255, 196, 0, 0.45)",
};
const BEST_REPLY_COLOR = "#e05b4b";
const ANSWER_COLOR = "#3B9AC6";

export default function BoardContainer() {
  const screenSize = useScreenSize();
  const engineName = useAtomValue(enginePlayNameAtom);
  const engine = useEngine(engineName);
  const game = useAtomValue(gameAtom);
  const { white, black } = usePlayersData(gameAtom);
  const playerColor = useAtomValue(playerColorAtom);
  const { playMove } = useChessActions(gameAtom);
  const engineElo = useAtomValue(engineEloAtom);
  const isGameInProgress = useAtomValue(isGameInProgressAtom);
  const hintArrows = useAtomValue(hintArrowsAtom);
  const blunderCheckMode = useAtomValue(blunderCheckModeAtom);
  const [check, setCheck] = useAtom(blunderCheckAtom);
  const [skipFen, setSkipFen] = useAtom(blunderCheckSkipFenAtom);

  const gameFen = game.fen();
  const isGameFinished = game.isGameOver();

  useEffect(() => {
    const playEngineMove = async () => {
      if (
        !engine?.getIsReady() ||
        game.turn() === playerColor ||
        isGameFinished ||
        !isGameInProgress
      ) {
        return;
      }

      const timePromise = sleep(1000);
      const move = await engine.getEngineNextMove(gameFen, engineElo);
      await timePromise;

      if (move) playMove(uciMoveParams(move));
    };
    playEngineMove();

    return () => {
      engine?.stopAllCurrentJobs();
    };
  }, [gameFen, isGameInProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  const boardSize = useMemo(() => {
    const width = screenSize.width;
    const height = screenSize.height;

    // 900 is the md layout breakpoint
    if (window?.innerWidth < 900) {
      return Math.min(width, height - 150);
    }

    return Math.min(width - 300, height * 0.83);
  }, [screenSize]);

  useGameData(gameAtom, gameDataAtom);

  /** Stages your move for a blunder check, then takes your answer for the opponent */
  const onMoveIntercept = (move: Move): boolean => {
    if (!isGameInProgress) return false;
    if (check) {
      if (check.stage === "reply") {
        setCheck({
          stage: "grading",
          candidate: check.candidate,
          answer: move,
        });
      }
      return true;
    }
    if (move.color !== playerColor) return false;
    if (skipFen === move.before) {
      setSkipFen(undefined);
      return false;
    }
    if (
      !shouldBlunderCheck({
        mode: blunderCheckMode,
        fenBefore: move.before,
        fenAfter: move.after,
      })
    ) {
      return false;
    }
    setCheck({ stage: "reply", candidate: move });
    return true;
  };

  const opponentColor = playerColor === Color.White ? Color.Black : Color.White;
  const canPlay = !isGameInProgress
    ? false
    : !check
      ? playerColor
      : check.stage === "reply"
        ? opponentColor
        : false;

  let arrows: Arrow[] = hintArrows;
  let squareStyles: Record<string, CSSProperties> | undefined;
  if (check) {
    arrows = [];
    squareStyles = {
      [check.candidate.from]: STAGED_STYLE,
      [check.candidate.to]: STAGED_STYLE,
    };
    if (check.stage === "result" && check.result?.bestLine[0]) {
      const best = check.result.bestLine[0];
      const answer = check.answer.from + check.answer.to;
      if (answer !== best.slice(0, 4)) {
        arrows.push([check.answer.from, check.answer.to, ANSWER_COLOR]);
      }
      arrows.push([
        best.slice(0, 2),
        best.slice(2, 4),
        BEST_REPLY_COLOR,
      ] as Arrow);
    }
  }

  return (
    <Board
      id="PlayBoard"
      canPlay={canPlay}
      gameAtom={gameAtom}
      boardSize={boardSize}
      whitePlayer={white}
      blackPlayer={black}
      boardOrientation={playerColor}
      currentPositionAtom={gameDataAtom}
      showPlayerMoveIconAtom={showPlayMoveIconAtom}
      extraArrows={arrows}
      customSquareStyles={squareStyles}
      onMoveIntercept={onMoveIntercept}
      overrideFen={check?.candidate.after}
    />
  );
}
