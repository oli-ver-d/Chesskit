import { Box, Grid2 as Grid } from "@mui/material";
import { Chessboard } from "react-chessboard";
import { PrimitiveAtom, atom, useAtomValue, useSetAtom } from "jotai";
import {
  Arrow,
  CustomPieces,
  CustomSquareRenderer,
  Piece,
  PromotionPieceOption,
  Square,
} from "react-chessboard/dist/chessboard/types";
import { useChessActions } from "@/hooks/useChessActions";
import {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Color, MoveClassification } from "@/types/enums";
import { Chess, Move } from "chess.js";
import { playIllegalMoveSound, playSoundFromMove } from "@/lib/sounds";
import { getSquareRenderer } from "./squareRenderer";
import { CurrentPosition } from "@/types/eval";
import EvaluationBar from "./evaluationBar";
import { CLASSIFICATION_COLORS } from "@/constants";
import { Player } from "@/types/game";
import PlayerHeader from "./playerHeader";
import { boardHueAtom, pieceSetAtom } from "./states";
import tinycolor from "tinycolor2";

export interface Props {
  id: string;
  canPlay?: Color | boolean;
  gameAtom: PrimitiveAtom<Chess>;
  boardSize?: number;
  whitePlayer: Player;
  blackPlayer: Player;
  boardOrientation?: Color;
  currentPositionAtom?: PrimitiveAtom<CurrentPosition>;
  showBestMoveArrow?: boolean;
  showPlayerMoveIconAtom?: PrimitiveAtom<boolean>;
  showEvaluationBar?: boolean;
  extraArrows?: Arrow[];
  /** Extra styles per square, e.g. a hint highlight */
  customSquareStyles?: Record<string, CSSProperties>;
  /**
   * Called with every legal move made on the board (drop, click or
   * promotion) before it's played. Return true to handle it yourself: the
   * move is then not played into `gameAtom`.
   */
  onMoveIntercept?: (move: Move) => boolean;
  /**
   * Show this position instead of the game's, e.g. a move that isn't played
   * yet. Moves made on it are only passed to `onMoveIntercept`.
   */
  overrideFen?: string;
}

export default function Board({
  id: boardId,
  canPlay,
  gameAtom,
  boardSize,
  whitePlayer,
  blackPlayer,
  boardOrientation = Color.White,
  currentPositionAtom = atom({}),
  showBestMoveArrow = false,
  showPlayerMoveIconAtom,
  showEvaluationBar = false,
  extraArrows,
  customSquareStyles,
  onMoveIntercept,
  overrideFen,
}: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const game = useAtomValue(gameAtom);
  const { playMove } = useChessActions(gameAtom);
  const clickedSquaresAtom = useMemo(() => atom<Square[]>([]), []);
  const setClickedSquares = useSetAtom(clickedSquaresAtom);
  const playableSquaresAtom = useMemo(() => atom<Square[]>([]), []);
  const setPlayableSquares = useSetAtom(playableSquaresAtom);
  const position = useAtomValue(currentPositionAtom);
  const [showPromotionDialog, setShowPromotionDialog] = useState(false);
  const [moveClickFrom, setMoveClickFrom] = useState<Square | null>(null);
  const [moveClickTo, setMoveClickTo] = useState<Square | null>(null);
  const pieceSet = useAtomValue(pieceSetAtom);
  const boardHue = useAtomValue(boardHueAtom);

  const gameFen = overrideFen ?? game.fen();
  /** The position shown and played on: the game, or `overrideFen` */
  const boardGame = useMemo(
    () => (overrideFen ? new Chess(overrideFen) : game),
    [overrideFen, game]
  );

  useEffect(() => {
    setClickedSquares([]);
  }, [gameFen, setClickedSquares]);

  const isPiecePlayable = useCallback(
    ({ piece }: { piece: string }): boolean => {
      if (boardGame.isGameOver() || !canPlay) return false;
      if (canPlay === true || canPlay === piece[0]) return true;
      return false;
    },
    [canPlay, boardGame]
  );

  /** Plays a move, unless `onMoveIntercept` takes it */
  const tryMove = useCallback(
    (params: { from: string; to: string; promotion?: string }) => {
      if (!onMoveIntercept && !overrideFen) return playMove(params);

      let move: Move;
      try {
        move = new Chess(boardGame.fen()).move(params);
      } catch {
        playIllegalMoveSound();
        return null;
      }
      if (onMoveIntercept?.(move)) {
        playSoundFromMove(move);
        return move;
      }
      // A position that isn't the game's can't be played into it
      return overrideFen ? null : playMove(params);
    },
    [onMoveIntercept, overrideFen, boardGame, playMove]
  );

  const onPieceDrop = useCallback(
    (source: Square, target: Square, piece: string): boolean => {
      if (!isPiecePlayable({ piece })) return false;

      const result = tryMove({
        from: source,
        to: target,
        promotion: piece[1]?.toLowerCase() ?? "q",
      });

      return !!result;
    },
    [isPiecePlayable, tryMove]
  );

  const resetMoveClick = useCallback(
    (square?: Square | null) => {
      setMoveClickFrom(square ?? null);
      setMoveClickTo(null);
      setShowPromotionDialog(false);
      if (square) {
        const moves = boardGame.moves({ square, verbose: true });
        setPlayableSquares(moves.map((m) => m.to));
      } else {
        setPlayableSquares([]);
      }
    },
    [setMoveClickFrom, setMoveClickTo, setPlayableSquares, boardGame]
  );

  const handleSquareLeftClick = useCallback(
    (square: Square, piece?: string) => {
      setClickedSquares([]);

      if (!moveClickFrom) {
        if (piece && !isPiecePlayable({ piece })) return;
        resetMoveClick(square);
        return;
      }

      const validMoves = boardGame.moves({
        square: moveClickFrom,
        verbose: true,
      });
      const move = validMoves.find((m) => m.to === square);

      if (!move) {
        resetMoveClick(square);
        return;
      }

      setMoveClickTo(square);

      if (
        move.piece === "p" &&
        ((move.color === "w" && square[1] === "8") ||
          (move.color === "b" && square[1] === "1"))
      ) {
        setShowPromotionDialog(true);
        return;
      }

      const result = tryMove({
        from: moveClickFrom,
        to: square,
      });

      resetMoveClick(result ? undefined : square);
    },
    [
      boardGame,
      isPiecePlayable,
      moveClickFrom,
      tryMove,
      resetMoveClick,
      setClickedSquares,
    ]
  );

  const handleSquareRightClick = useCallback(
    (square: Square) => {
      setClickedSquares((prev) =>
        prev.includes(square)
          ? prev.filter((s) => s !== square)
          : [...prev, square]
      );
    },
    [setClickedSquares]
  );

  const handlePieceDragBegin = useCallback(
    (_: string, square: Square) => {
      resetMoveClick(square);
    },
    [resetMoveClick]
  );

  const handlePieceDragEnd = useCallback(() => {
    resetMoveClick();
  }, [resetMoveClick]);

  const onPromotionPieceSelect = useCallback(
    (piece?: PromotionPieceOption, from?: Square, to?: Square) => {
      if (!piece) return false;
      const promotionPiece = piece[1]?.toLowerCase() ?? "q";

      if (moveClickFrom && moveClickTo) {
        const result = tryMove({
          from: moveClickFrom,
          to: moveClickTo,
          promotion: promotionPiece,
        });
        resetMoveClick();
        return !!result;
      }

      if (from && to) {
        const result = tryMove({
          from,
          to,
          promotion: promotionPiece,
        });
        resetMoveClick();
        return !!result;
      }

      resetMoveClick(moveClickFrom);
      return false;
    },
    [moveClickFrom, moveClickTo, tryMove, resetMoveClick]
  );

  const customArrows: Arrow[] = useMemo(() => {
    const bestMove = position?.lastEval?.bestMove;
    const moveClassification = position?.eval?.moveClassification;

    if (
      bestMove &&
      showBestMoveArrow &&
      moveClassification !== MoveClassification.Best &&
      moveClassification !== MoveClassification.Opening &&
      moveClassification !== MoveClassification.Forced &&
      moveClassification !== MoveClassification.Perfect
    ) {
      const bestMoveArrow = [
        bestMove.slice(0, 2),
        bestMove.slice(2, 4),
        tinycolor(CLASSIFICATION_COLORS[MoveClassification.Best])
          .spin(-boardHue)
          .toHexString(),
      ] as Arrow;

      return [bestMoveArrow, ...(extraArrows ?? [])];
    }

    return extraArrows ?? [];
  }, [position, showBestMoveArrow, boardHue, extraArrows]);

  const SquareRenderer: CustomSquareRenderer = useMemo(() => {
    return getSquareRenderer({
      currentPositionAtom: currentPositionAtom,
      clickedSquaresAtom,
      playableSquaresAtom,
      showPlayerMoveIconAtom,
      boardSize: boardSize || 400,
    });
  }, [
    currentPositionAtom,
    clickedSquaresAtom,
    playableSquaresAtom,
    showPlayerMoveIconAtom,
    boardSize,
  ]);

  const customPieces = useMemo(
    () =>
      PIECE_CODES.reduce<CustomPieces>((acc, piece) => {
        acc[piece] = ({ squareWidth }) => (
          <Box
            width={squareWidth}
            height={squareWidth}
            sx={{
              backgroundImage: `url(/piece/${pieceSet}/${piece}.svg)`,
              backgroundSize: "contain",
            }}
          />
        );

        return acc;
      }, {}),
    [pieceSet]
  );

  const customBoardStyle = useMemo(() => {
    const commonBoardStyle = {
      borderRadius: "5px",
      boxShadow: "0 2px 10px rgba(0, 0, 0, 0.5)",
    };

    if (boardHue) {
      return {
        ...commonBoardStyle,
        filter: `hue-rotate(${boardHue}deg)`,
      };
    }

    return commonBoardStyle;
  }, [boardHue]);

  return (
    <Grid
      container
      justifyContent="center"
      alignItems="center"
      wrap="nowrap"
      width={boardSize}
    >
      {showEvaluationBar && (
        <EvaluationBar
          height={boardRef?.current?.offsetHeight || boardSize || 400}
          boardOrientation={boardOrientation}
          currentPositionAtom={currentPositionAtom}
        />
      )}

      <Grid
        container
        rowGap={1.5}
        justifyContent="center"
        alignItems="center"
        paddingLeft={{ xs: 0.5, sm: showEvaluationBar ? 2 : 0 }}
        size="grow"
      >
        <PlayerHeader
          color={boardOrientation === Color.White ? Color.Black : Color.White}
          gameAtom={gameAtom}
          player={boardOrientation === Color.White ? blackPlayer : whitePlayer}
        />

        <Grid
          container
          justifyContent="center"
          alignItems="center"
          ref={boardRef}
          size={12}
        >
          <Chessboard
            id={`${boardId}-${canPlay}`}
            position={gameFen}
            onPieceDrop={onPieceDrop}
            boardOrientation={
              boardOrientation === Color.White ? "white" : "black"
            }
            customBoardStyle={customBoardStyle}
            customArrows={customArrows}
            isDraggablePiece={isPiecePlayable}
            customSquare={SquareRenderer}
            customSquareStyles={customSquareStyles}
            onSquareClick={handleSquareLeftClick}
            onSquareRightClick={handleSquareRightClick}
            onPieceDragBegin={handlePieceDragBegin}
            onPieceDragEnd={handlePieceDragEnd}
            onPromotionPieceSelect={onPromotionPieceSelect}
            showPromotionDialog={showPromotionDialog}
            promotionToSquare={moveClickTo}
            animationDuration={200}
            customPieces={customPieces}
          />
        </Grid>

        <PlayerHeader
          color={boardOrientation}
          gameAtom={gameAtom}
          player={boardOrientation === Color.White ? whitePlayer : blackPlayer}
        />
      </Grid>
    </Grid>
  );
}

export const PIECE_CODES = [
  "wP",
  "wB",
  "wN",
  "wR",
  "wQ",
  "wK",
  "bP",
  "bB",
  "bN",
  "bR",
  "bQ",
  "bK",
] as const satisfies Piece[];
