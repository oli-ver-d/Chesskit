import { Chess, Move } from "chess.js";
import { parseClockComment } from "@/lib/chess";
import {
  getGamePhase,
  getHangingPieces,
  PIECE_VALUES,
} from "@/lib/coach/facts";
import { getLineWinPercentage } from "@/lib/engine/helpers/winPercentage";
import { Color, MoveClassification } from "@/types/enums";
import { LineEval, PositionEval } from "@/types/eval";
import { Game } from "@/types/game";
import {
  GameDigest,
  GamePhase,
  GameResultForMe,
  MoveDigest,
} from "@/types/training";

/** Bump when digest logic changes: stored digests are rebuilt (no re-analysis) */
export const DIGEST_VERSION = 2;

/** A move must lose at least this much win chance to count as leaving a piece hanging */
const HUNG_PIECE_MIN_LOSS = 10;

const ERROR_CLASSIFICATIONS = [
  MoveClassification.Mistake,
  MoveClassification.Blunder,
];

/** Win chance (0–100) for White, or undefined if the line has no score */
const whiteWin = (line: LineEval | undefined): number | undefined => {
  if (!line || (line.cp === undefined && line.mate === undefined)) {
    return undefined;
  }
  return getLineWinPercentage(line);
};

const forMover = (winWhite: number, color: Color) =>
  color === Color.White ? winWhite : 100 - winWhite;

/** Mate distance from the mover's side: > 0 means the mover is mating */
const mateForMover = (line: LineEval | undefined, color: Color) =>
  line?.mate === undefined
    ? undefined
    : color === Color.White
      ? line.mate
      : -line.mate;

const getBestUci = (position: PositionEval | undefined) =>
  position?.bestMove ?? position?.lines[0]?.pv[0];

/**
 * If the opponent's best reply to the move captures a piece (not a pawn) that
 * the move left hanging, describes that piece. Even or favourable trades
 * (the move captured at least as much as the reply takes back) don't count.
 */
const getHungPiece = (
  move: Move,
  afterEval: PositionEval
): string | undefined => {
  const reply = getBestUci(afterEval);
  if (!reply) return undefined;

  let replyMove: Move;
  try {
    replyMove = new Chess(move.after).move({
      from: reply.slice(0, 2),
      to: reply.slice(2, 4),
      promotion: reply[4],
    });
  } catch {
    return undefined;
  }

  if (!replyMove.captured || replyMove.captured === "p") return undefined;

  const gained = move.captured ? PIECE_VALUES[move.captured] : 0;
  if (gained >= PIECE_VALUES[replyMove.captured]) return undefined;

  return getHangingPieces(move.after, move.color).find((piece) =>
    piece.includes(` on ${replyMove.to} `)
  );
};

const getResultForMe = (
  result: string | undefined,
  myColor: Color
): GameResultForMe | undefined => {
  if (result === "1/2-1/2") return "draw";
  if (result === "1-0") return myColor === Color.White ? "win" : "loss";
  if (result === "0-1") return myColor === Color.Black ? "win" : "loss";
  return undefined;
};

/**
 * Per-move facts for one analyzed game of yours. Returns undefined if the game
 * isn't yours, isn't analyzed, or its eval doesn't match its moves.
 */
export const buildGameDigest = (game: Game): GameDigest | undefined => {
  const { eval: gameEval, myColor } = game;
  if (!gameEval || !myColor) return undefined;

  const chess = new Chess();
  try {
    chess.loadPgn(game.pgn);
  } catch {
    return undefined;
  }

  const history = chess.history({ verbose: true });
  const { positions } = gameEval;
  if (!history.length || positions.length !== history.length + 1) {
    return undefined;
  }

  const comments = new Map(
    chess.getComments().map(({ fen, comment }) => [fen, comment])
  );

  const moves = history.map((move, ply): MoveDigest => {
    const color = move.color as Color;
    const before = positions[ply];
    const after = positions[ply + 1];

    const whiteBefore = whiteWin(before.lines[0]) ?? 50;
    const whiteAfter = whiteWin(after.lines[0]) ?? whiteBefore;
    const winBefore = forMover(whiteBefore, color);
    const winAfter = forMover(whiteAfter, color);

    const whiteSecond = whiteWin(before.lines[1]);
    const secondBestGap =
      whiteSecond === undefined
        ? undefined
        : winBefore - forMover(whiteSecond, color);

    const mateBefore = mateForMover(before.lines[0], color);
    const mateAfter = mateForMover(after.lines[0], color);
    const missedMate =
      mateBefore !== undefined &&
      mateBefore > 0 &&
      !(mateAfter !== undefined && mateAfter > 0);

    const hungPiece =
      winBefore - winAfter >= HUNG_PIECE_MIN_LOSS
        ? getHungPiece(move, after)
        : undefined;

    const opponentErredPrev =
      ply > 0 &&
      !!before.moveClassification &&
      ERROR_CLASSIFICATIONS.includes(before.moveClassification);

    return {
      ply,
      moveNumber: Math.floor(ply / 2) + 1,
      color,
      isMine: color === myColor,
      fenBefore: move.before,
      uci: move.from + move.to + (move.promotion ?? ""),
      san: move.san,
      classification: after.moveClassification,
      winBefore,
      winAfter,
      bestUci: getBestUci(before),
      secondBestGap,
      phase: getGamePhase(move.before, ply) as GamePhase,
      clockAfter: parseClockComment(comments.get(move.after))?.totalSeconds,
      hungPiece,
      missedMate: missedMate || undefined,
      opponentErredPrev: opponentErredPrev || undefined,
    };
  });

  return {
    gameId: game.id,
    version: DIGEST_VERSION,
    myColor,
    evalDate: gameEval.settings.date,
    endTime: game.endTime,
    accuracy:
      myColor === Color.White
        ? gameEval.accuracy.white
        : gameEval.accuracy.black,
    result: getResultForMe(game.result, myColor),
    openingName: game.openingName,
    timeClass: game.timeClass,
    moves,
  };
};

/** True if `digest` is missing or was built from other data than `game` now has */
export const isDigestStale = (
  game: Game,
  digest: GameDigest | undefined
): boolean =>
  !digest ||
  digest.version !== DIGEST_VERSION ||
  digest.myColor !== game.myColor ||
  digest.evalDate !== game.eval?.settings.date;
