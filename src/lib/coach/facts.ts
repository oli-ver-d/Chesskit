import { Chess, Square, PieceSymbol, Color as ChessColor } from "chess.js";
import { LineEval, PositionEval } from "@/types/eval";
import { getLineWinPercentage } from "@/lib/engine/helpers/winPercentage";
import { uciMoveParams } from "@/lib/chess";

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

const PIECE_VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 100,
};

export const colorName = (color: ChessColor | string): string =>
  color === "w" ? "White" : "Black";

/** Human readable evaluation from White's point of view. */
export const describeEval = (line?: Pick<LineEval, "cp" | "mate">): string => {
  if (!line) return "unknown";

  if (line.mate !== undefined && line.mate !== 0) {
    const side = line.mate > 0 ? "White" : "Black";
    return `${side} has a forced mate in ${Math.abs(line.mate)}`;
  }
  if (line.mate === 0) return "checkmate";

  const cp = line.cp ?? 0;
  const pawns = cp / 100;
  const label = `${pawns > 0 ? "+" : ""}${pawns.toFixed(2)}`;
  const abs = Math.abs(pawns);
  const side = pawns > 0 ? "White" : "Black";

  if (abs < 0.3) return `${label} (roughly equal)`;
  if (abs < 1) return `${label} (${side} is slightly better)`;
  if (abs < 2.5) return `${label} (${side} is clearly better)`;
  return `${label} (${side} is winning)`;
};

/** Win chance (0-100) for the given colour. */
export const winChanceFor = (
  line: LineEval | undefined,
  color: ChessColor | string
): number | undefined => {
  if (!line) return undefined;
  try {
    const white = getLineWinPercentage(line);
    return color === "w" ? white : 100 - white;
  } catch {
    return undefined;
  }
};

/** Converts a UCI principal variation to numbered SAN: "14. Nxe5 d6 15. Bb5+" */
export const pvToSan = (fen: string, pv: string[], maxPlies = 6): string => {
  const chess = new Chess(fen);
  const parts: string[] = [];

  for (const uci of pv.slice(0, maxPlies)) {
    const moveNumber = chess.moveNumber();
    const turn = chess.turn();
    let san: string;
    try {
      san = chess.move(uciMoveParams(uci)).san;
    } catch {
      break;
    }
    if (turn === "w") parts.push(`${moveNumber}. ${san}`);
    else if (parts.length === 0) parts.push(`${moveNumber}... ${san}`);
    else parts.push(san);
  }

  return parts.join(" ");
};

export const uciToSan = (fen: string, uci?: string): string | undefined => {
  if (!uci) return undefined;
  try {
    return new Chess(fen).move(uciMoveParams(uci)).san;
  } catch {
    return undefined;
  }
};

export const moveLabel = (fenBefore: string, san: string): string => {
  const [, turn, , , , fullMove] = fenBefore.split(" ");
  return turn === "w" ? `${fullMove}. ${san}` : `${fullMove}... ${san}`;
};

/**
 * Lists pieces of `color` that the opponent attacks and that are either
 * undefended or attacked by a cheaper piece.
 */
export const getHangingPieces = (fen: string, color: ChessColor): string[] => {
  const chess = new Chess(fen);
  const opponent: ChessColor = color === "w" ? "b" : "w";
  const result: string[] = [];

  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece || piece.color !== color || piece.type === "k") continue;
      const square = piece.square as Square;
      const attackers = chess.attackers(square, opponent);
      if (!attackers.length) continue;

      const defenders = chess.attackers(square, color);
      const cheapestAttacker = Math.min(
        ...attackers.map((sq) => {
          const p = chess.get(sq);
          return p ? PIECE_VALUES[p.type] : 100;
        })
      );

      if (!defenders.length) {
        result.push(`${PIECE_NAMES[piece.type]} on ${square} (undefended)`);
      } else if (cheapestAttacker < PIECE_VALUES[piece.type]) {
        result.push(
          `${PIECE_NAMES[piece.type]} on ${square} (attacked by a cheaper piece)`
        );
      }
    }
  }

  return result;
};

/** Material balance in pawns from White's point of view. */
export const getMaterialBalance = (fen: string): number => {
  const board = fen.split(" ")[0];
  let total = 0;
  for (const char of board) {
    const lower = char.toLowerCase() as PieceSymbol;
    if (!(lower in PIECE_VALUES) || lower === "k") continue;
    total += (char === lower ? -1 : 1) * PIECE_VALUES[lower];
  }
  return total;
};

export const describeMaterial = (fen: string): string => {
  const balance = getMaterialBalance(fen);
  if (balance === 0) return "material is level";
  return `${balance > 0 ? "White" : "Black"} is up ${Math.abs(balance)} point${
    Math.abs(balance) === 1 ? "" : "s"
  } of material`;
};

export const getGamePhase = (fen: string, plyIndex: number): string => {
  const board = fen.split(" ")[0];
  const heavy = (board.match(/[qrbnQRBN]/g) ?? []).length;
  if (plyIndex < 16 && heavy >= 12) return "opening";
  if (heavy <= 6) return "endgame";
  return "middlegame";
};

/**
 * FEN with the side to move swapped ("null move"), used to find what the
 * opponent is threatening. Returns undefined if the side to move is in check.
 */
export const getNullMoveFen = (fen: string): string | undefined => {
  try {
    const chess = new Chess(fen);
    if (chess.inCheck()) return undefined;
    const parts = fen.split(" ");
    parts[1] = parts[1] === "w" ? "b" : "w";
    parts[3] = "-";
    const nullFen = parts.join(" ");
    const test = new Chess(nullFen);
    if (test.inCheck()) return undefined;
    return nullFen;
  } catch {
    return undefined;
  }
};

export const getBestLine = (position?: PositionEval): LineEval | undefined =>
  position?.lines?.[0];

export const pieceOnSquare = (
  fen: string,
  square: string
): string | undefined => {
  try {
    const piece = new Chess(fen).get(square as Square);
    return piece ? PIECE_NAMES[piece.type] : undefined;
  } catch {
    return undefined;
  }
};
