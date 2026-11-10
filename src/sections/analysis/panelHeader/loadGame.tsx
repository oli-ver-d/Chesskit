import LoadGameButton from "../../loadGame/loadGameButton";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useChessActions } from "@/hooks/useChessActions";
import {
  boardAtom,
  boardOrientationAtom,
  evaluationProgressAtom,
  gameAtom,
  gameEvalAtom,
} from "../states";
import { useGameDatabase } from "@/hooks/useGameDatabase";
import { useAtomValue, useSetAtom } from "jotai";
import { Chess } from "chess.js";
import { useRouter } from "next/router";
import { GameEval } from "@/types/eval";
import { fetchLichessGame } from "@/lib/lichess";
import { getGameFromPgn } from "@/lib/chess";
import { Color } from "@/types/enums";

export default function LoadGame() {
  const router = useRouter();
  const game = useAtomValue(gameAtom);
  const { setPgn: setGamePgn } = useChessActions(gameAtom);
  const { resetToStartingPosition: resetBoard, goToMove: goToBoardMove } =
    useChessActions(boardAtom);
  const { gameFromUrl } = useGameDatabase();
  const setEval = useSetAtom(gameEvalAtom);
  const setBoardOrientation = useSetAtom(boardOrientationAtom);
  const evaluationProgress = useAtomValue(evaluationProgressAtom);

  const joinedGameHistory = useMemo(() => game.history().join(), [game]);

  const resetAndSetGamePgn = useCallback(
    (pgn: string, orientation?: boolean, gameEval?: GameEval) => {
      const gameFromPgn = new Chess();
      gameFromPgn.loadPgn(pgn);
      if (joinedGameHistory === gameFromPgn.history().join()) return;

      resetBoard(pgn);
      setEval(gameEval);
      setGamePgn(pgn);
      setBoardOrientation(orientation ?? true);
    },
    [joinedGameHistory, resetBoard, setGamePgn, setEval, setBoardOrientation]
  );

  const {
    lichessGameId,
    orientation: orientationParam,
    ply: plyParam,
  } = router.query;

  useEffect(() => {
    const handleLichess = async (id: string) => {
      const res = await fetchLichessGame(id);
      if (typeof res === "string") {
        resetAndSetGamePgn(res, orientationParam !== "black");
      }
    };

    if (gameFromUrl) {
      const orientation = gameFromUrl.myColor
        ? gameFromUrl.myColor === Color.White
        : !(
            gameFromUrl.site === "Chesskit.org" &&
            gameFromUrl.black.name === "You"
          );
      resetAndSetGamePgn(gameFromUrl.pgn, orientation, gameFromUrl.eval);
    } else if (typeof lichessGameId === "string" && !!lichessGameId) {
      handleLichess(lichessGameId);
    }
  }, [gameFromUrl, lichessGameId, orientationParam, resetAndSetGamePgn]);

  // `?gameId=X&ply=N` opens the saved game at the position after N half-moves
  const appliedPlyRef = useRef<string | undefined>(undefined);
  const gameFromUrlHistory = useMemo(() => {
    if (!gameFromUrl) return undefined;
    try {
      return getGameFromPgn(gameFromUrl.pgn).history().join();
    } catch {
      return undefined;
    }
  }, [gameFromUrl]);

  useEffect(() => {
    if (!gameFromUrl || typeof plyParam !== "string") return;
    const ply = parseInt(plyParam);
    const key = `${gameFromUrl.id}:${ply}`;
    if (Number.isNaN(ply) || appliedPlyRef.current === key) return;
    // Wait until the game from the URL is the one loaded
    if (joinedGameHistory !== gameFromUrlHistory) return;

    appliedPlyRef.current = key;
    goToBoardMove(ply, game);
  }, [
    gameFromUrl,
    gameFromUrlHistory,
    plyParam,
    joinedGameHistory,
    game,
    goToBoardMove,
  ]);

  useEffect(() => {
    const eventHandler = (event: MessageEvent) => {
      try {
        if (!event?.data?.pgn) return;
        const { pgn, orientation } = event.data as {
          pgn: string;
          orientation?: "white" | "black";
        };
        resetAndSetGamePgn(pgn, orientation !== "black");
      } catch (error) {
        console.error("Error processing message event:", error);
      }
    };
    window.addEventListener("message", eventHandler);

    return () => {
      window.removeEventListener("message", eventHandler);
    };
  }, [resetAndSetGamePgn]);

  const isGameLoaded =
    gameFromUrl !== undefined ||
    (!!game.getHeaders().White && game.getHeaders().White !== "?") ||
    game.history().length > 0;

  if (evaluationProgress) return null;

  return (
    <LoadGameButton
      label={isGameLoaded ? "Load another game" : "Load game"}
      size="small"
      setGame={async (game) => {
        await router.replace(
          {
            query: {},
            pathname: router.pathname,
          },
          undefined,
          { shallow: true, scroll: false }
        );
        resetAndSetGamePgn(game.pgn());
      }}
    />
  );
}
