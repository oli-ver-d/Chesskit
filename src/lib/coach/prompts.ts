import { Chess } from "chess.js";
import { uciMoveParams } from "@/lib/chess";
import { MoveClassification } from "@/types/enums";
import { PositionEval } from "@/types/eval";
import { ChatMessage } from "./openrouter";
import {
  colorName,
  describeEval,
  describeMaterial,
  describeMoveEffects,
  describePawns,
  getGamePhase,
  getHangingPieces,
  moveLabel,
  pvToSan,
  uciToSan,
} from "./facts";

export const CLASSIFICATION_NAMES: Record<MoveClassification, string> = {
  [MoveClassification.Splendid]: "Brilliant",
  [MoveClassification.Perfect]: "Great (the only good move)",
  [MoveClassification.Best]: "Best",
  [MoveClassification.Excellent]: "Excellent",
  [MoveClassification.Okay]: "Good (but not the best)",
  [MoveClassification.Inaccuracy]: "Inaccuracy",
  [MoveClassification.Mistake]: "Mistake",
  [MoveClassification.Blunder]: "Blunder",
  [MoveClassification.Opening]: "Book (opening theory)",
  [MoveClassification.Forced]: "Forced (the only legal move)",
};

export const BAD_CLASSIFICATIONS = [
  MoveClassification.Inaccuracy,
  MoveClassification.Mistake,
  MoveClassification.Blunder,
];

export const GREAT_CLASSIFICATIONS = [
  MoveClassification.Splendid,
  MoveClassification.Perfect,
];

const SYSTEM_PROMPT = `You are a friendly, encouraging chess coach, like the coach in chess.com's Game Review. You explain moves to club-level players in plain English.

Rules:
- The engine data you are given is the ground truth. Never contradict it. Never invent variations, tactics or piece locations that are not supported by the data. If the reason is unclear from the data, keep it general rather than guessing.
- Use the moves exactly as written in the data (standard algebraic notation).
- Explain the idea (why the move is good or bad: what it wins, allows, defends or threatens). Don't quote engine numbers like "+1.23"; translate them into words ("wins a knight", "leaves you slightly worse").
- Be concise and natural. Default to 1-3 short sentences. No headings, no lists, no preamble like "Great question".`;

export interface MoveCoachInput {
  fenBefore: string;
  fenAfter: string;
  san: string;
  uci: string;
  evalBefore: PositionEval;
  evalAfter: PositionEval;
  classification?: MoveClassification;
  opening?: string;
  plyIndex: number;
  /** review: neutral White/Black. player: the user made this move. */
  audience: "review" | "player";
}

const buildMoveFacts = (input: MoveCoachInput): string[] => {
  const mover = input.fenBefore.split(" ")[1] as "w" | "b";
  const opponent = mover === "w" ? "b" : "w";
  const bestBefore = input.evalBefore.lines[0];
  const bestAfter = input.evalAfter.lines[0];
  const bestMoveUci = input.evalBefore.bestMove ?? bestBefore?.pv?.[0];
  const bestMoveSan = uciToSan(input.fenBefore, bestMoveUci);
  const playedIsBest = bestMoveUci === input.uci;

  const facts: string[] = [
    `Move played: ${moveLabel(input.fenBefore, input.san)} by ${colorName(mover)}`,
    `Position before the move (FEN): ${input.fenBefore}`,
    `Game phase: ${getGamePhase(input.fenBefore, input.plyIndex)}`,
  ];

  if (input.classification) {
    facts.push(
      `Engine classification: ${CLASSIFICATION_NAMES[input.classification]}`
    );
  }
  if (input.opening) facts.push(`Opening: ${input.opening}`);

  facts.push(`Evaluation before the move: ${describeEval(bestBefore)}`);
  facts.push(
    `Evaluation after the move: ${input.san.includes("#") ? "checkmate" : describeEval(bestAfter)}`
  );

  if (!playedIsBest && bestMoveSan && bestBefore?.pv?.length) {
    facts.push(
      `Engine's best move instead: ${bestMoveSan} (line: ${pvToSan(
        input.fenBefore,
        bestBefore.pv
      )})`
    );
    facts.push(
      `Evaluation if ${bestMoveSan} had been played: ${describeEval(bestBefore)}`
    );
    const bestEffects = describeMoveEffects(input.fenBefore, bestMoveUci);
    if (bestEffects.length) {
      facts.push(`What ${bestMoveSan} does: ${bestEffects.join("; ")}`);
    }
    const second = input.evalBefore.lines.find(
      (l) => l.pv[0] !== bestMoveUci && l.pv[0] !== input.uci
    );
    if (second?.pv?.length) {
      facts.push(
        `Another decent option: ${uciToSan(input.fenBefore, second.pv[0])} (${describeEval(second)})`
      );
    }
  } else if (playedIsBest) {
    facts.push("This was the engine's top choice.");
  }

  if (bestAfter?.pv?.length) {
    facts.push(
      `${colorName(opponent)}'s best reply and continuation: ${pvToSan(
        input.fenAfter,
        bestAfter.pv
      )}`
    );
  }

  const moverHanging = getHangingPieces(input.fenAfter, mover);
  if (moverHanging.length) {
    facts.push(
      `${colorName(mover)} pieces left en prise after the move: ${moverHanging.join(", ")}`
    );
  }
  const oppHangingBefore = getHangingPieces(input.fenBefore, opponent);
  if (oppHangingBefore.length) {
    facts.push(
      `${colorName(opponent)} pieces that were available to attack before the move: ${oppHangingBefore.join(", ")}`
    );
  }

  facts.push(`Material after the move: ${describeMaterial(input.fenAfter)}`);
  if (input.san.includes("#")) facts.push("The move delivers checkmate.");

  return facts;
};

const getTaskForClassification = (
  classification: MoveClassification | undefined,
  audience: MoveCoachInput["audience"],
  bestMoveSan: string | undefined
): string => {
  const who =
    audience === "player"
      ? 'Talk directly to the player who made the move ("you").'
      : "Refer to the sides as White and Black.";
  const better = bestMoveSan ?? "the engine's best move";
  const whyBest = `Then name ${better} and explain why it is the best move: what it wins, threatens, defends or improves, following the engine line and the facts about what it does.`;

  switch (classification) {
    case MoveClassification.Blunder:
    case MoveClassification.Mistake:
      return `${who} In 2-4 sentences: first explain what goes wrong after this move (what the opponent's best reply exploits). ${whyBest}`;
    case MoveClassification.Inaccuracy:
      return `${who} In 2-3 sentences: first say briefly why this move is imprecise (what it misses or allows). ${whyBest}`;
    case MoveClassification.Okay:
      return `${who} In 1-2 sentences say what this move does, then why ${better} was a bit more precise.`;
    case MoveClassification.Splendid:
    case MoveClassification.Perfect:
      return `${who} In 1-2 enthusiastic sentences explain why this move is so strong.`;
    case MoveClassification.Opening:
      return `${who} In 1-2 sentences explain the opening idea behind this book move.`;
    case MoveClassification.Forced:
      return `${who} In one sentence say this move was forced and why.`;
    default:
      return `${who} In 1-2 sentences explain the idea behind this good move.`;
  }
};

export const buildMoveExplanationMessages = (
  input: MoveCoachInput
): ChatMessage[] => {
  const bestMoveUci =
    input.evalBefore.bestMove ?? input.evalBefore.lines[0]?.pv?.[0];
  const bestMoveSan =
    bestMoveUci !== input.uci
      ? uciToSan(input.fenBefore, bestMoveUci)
      : undefined;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${buildMoveFacts(input).join("\n")}\n\nTask: ${getTaskForClassification(
        input.classification,
        input.audience,
        bestMoveSan
      )}`,
    },
  ];
};

export interface HintInput {
  fen: string;
  evalPosition: PositionEval;
  level: 1 | 2;
}

export const buildHintMessages = ({
  fen,
  evalPosition,
  level,
}: HintInput): ChatMessage[] => {
  const player = fen.split(" ")[1] as "w" | "b";
  const opponent = player === "w" ? "b" : "w";
  const best = evalPosition.lines[0];
  const bestUci = evalPosition.bestMove ?? best?.pv?.[0];
  const bestSan = uciToSan(fen, bestUci);
  const facts = [
    `The player (${colorName(player)}) is to move and asked for a hint.`,
    `Position (FEN): ${fen}`,
    `Current evaluation: ${describeEval(best)}`,
    `Engine's best move (SECRET, do not reveal): ${bestSan} (line: ${pvToSan(fen, best?.pv ?? [])})`,
  ];
  const oppHanging = getHangingPieces(fen, opponent);
  if (oppHanging.length)
    facts.push(
      `Opponent pieces that can be attacked: ${oppHanging.join(", ")}`
    );
  const playerHanging = getHangingPieces(fen, player);
  if (playerHanging.length)
    facts.push(
      `Player's pieces currently en prise: ${playerHanging.join(", ")}`
    );

  const task =
    level === 1
      ? 'Give a gentle nudge in ONE short sentence, talking to the player as "you". Point at the idea (a tactic, a threat to deal with, a weakness, a piece to improve) WITHOUT naming the best move, the piece that moves, or its destination square.'
      : 'Give a stronger hint in ONE short sentence, talking to the player as "you". You may say which piece to look at, but do NOT give the exact move or the destination square.';

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `${facts.join("\n")}\n\nTask: ${task}` },
  ];
};

export interface BotMoveInput {
  fenBefore: string;
  fenAfter: string;
  san: string;
  evalAfter: PositionEval;
  threatLine?: string[];
  threatFen?: string;
}

export const buildBotMoveMessages = (input: BotMoveInput): ChatMessage[] => {
  const bot = input.fenBefore.split(" ")[1] as "w" | "b";
  const player = bot === "w" ? "b" : "w";
  const facts = [
    `The bot (${colorName(bot)}) just played ${moveLabel(input.fenBefore, input.san)}.`,
    `The player is ${colorName(player)}.`,
    `Position after the move (FEN): ${input.fenAfter}`,
    `Evaluation now: ${describeEval(input.evalAfter.lines[0])}`,
  ];

  if (input.threatFen && input.threatLine?.length) {
    facts.push(
      `What the bot threatens if the player ignores it (engine line with the player passing): ${pvToSan(
        input.threatFen,
        input.threatLine,
        3
      )}`
    );
  }
  const playerHanging = getHangingPieces(input.fenAfter, player);
  if (playerHanging.length)
    facts.push(
      `Player's pieces currently en prise: ${playerHanging.join(", ")}`
    );

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${facts.join("\n")}\n\nTask: In 1-2 short sentences, talking to the player as "you", explain the idea of the bot's move and any threat to watch out for. Do NOT tell the player which move to play.`,
    },
  ];
};

export interface KeyMoment {
  label: string; // "14. Nxe5"
  color: "w" | "b";
  classification: MoveClassification;
  evalBefore: string;
  evalAfter: string;
  bestMove?: string;
  bestLine?: string;
  reply?: string;
}

export interface GameSummaryInput {
  white: string;
  black: string;
  result?: string;
  termination?: string;
  opening?: string;
  accuracy: { white: number; black: number };
  estimatedElo?: { white: number; black: number };
  counts: Record<"w" | "b", Partial<Record<MoveClassification, number>>>;
  keyMoments: KeyMoment[];
  movesSan: string;
}

export const buildGameSummaryMessages = (
  input: GameSummaryInput
): ChatMessage[] => {
  const countLine = (color: "w" | "b") =>
    Object.entries(input.counts[color])
      .filter(([, n]) => n)
      .map(([c, n]) => `${CLASSIFICATION_NAMES[c as MoveClassification]}: ${n}`)
      .join(", ");

  const facts = [
    `White: ${input.white}`,
    `Black: ${input.black}`,
    input.result ? `Result: ${input.result}` : "",
    input.termination ? `Termination: ${input.termination}` : "",
    input.opening ? `Opening: ${input.opening}` : "",
    `Accuracy: White ${input.accuracy.white.toFixed(1)}%, Black ${input.accuracy.black.toFixed(1)}%`,
    input.estimatedElo
      ? `Estimated game rating: White ${Math.round(input.estimatedElo.white)}, Black ${Math.round(input.estimatedElo.black)}`
      : "",
    `White move quality: ${countLine("w")}`,
    `Black move quality: ${countLine("b")}`,
    `Moves: ${input.movesSan}`,
    "",
    "Key moments (engine data):",
    ...input.keyMoments.map(
      (m) =>
        `- ${m.label} (${colorName(m.color)}): ${CLASSIFICATION_NAMES[m.classification]}. Eval before: ${m.evalBefore}; after: ${m.evalAfter}.${
          m.bestMove ? ` Best was ${m.bestMove} (${m.bestLine}).` : ""
        }${m.reply ? ` Best reply after the played move: ${m.reply}.` : ""}`
    ),
  ].filter((line) => line !== "");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${facts.join("\n")}

Task: Write a game review for these players, like chess.com's Game Review summary. Use this format (Markdown):
A short opening paragraph (2-3 sentences) on how the game went overall.
**Key moments** followed by 3-5 bullet points, each starting with the move in bold, saying what happened and why it mattered.
**What to work on** followed by 2-3 bullet points of practical, specific advice for each side based on their mistakes.
Keep the whole review under 250 words.`,
    },
  ];
};

export interface PuzzleCoachInput {
  /** Puzzle position, the player to move */
  fen: string;
  bestUci: string;
  /** Engine's best line from `fen` (starts with the best move) */
  bestLine?: string[];
  /** The move the player chose in their game, and the engine's punishment of it */
  playedUci: string;
  playedFenAfter?: string;
  punishLine?: string[];
  themes: string[];
  /** 1: nudge without naming the move. 3: reveal and explain the answer. */
  level: 1 | 3;
}

const PUZZLE_THEME_FACTS: Record<string, string> = {
  "missed-mate": "There is a forced checkmate for the player in this position.",
  "missed-capture":
    "The best move captures an opponent piece that is not properly defended.",
  "hung-piece":
    "In the game, the player's move left one of their pieces hanging.",
  "missed-punish":
    "The opponent's previous move was a mistake, and the best move punishes it.",
};

export const buildPuzzleCoachMessages = (
  input: PuzzleCoachInput
): ChatMessage[] => {
  const player = input.fen.split(" ")[1] as "w" | "b";
  const opponent = player === "w" ? "b" : "w";
  const bestSan = uciToSan(input.fen, input.bestUci) ?? input.bestUci;
  const playedSan = uciToSan(input.fen, input.playedUci) ?? input.playedUci;
  const secret = input.level === 1 ? " (SECRET, do not reveal)" : "";

  const facts = [
    `This is a puzzle from the player's own game. The player (${colorName(player)}) is to move.`,
    `Position (FEN): ${input.fen}`,
    `Engine's best move${secret}: ${bestSan}${
      input.bestLine?.length
        ? ` (line: ${pvToSan(input.fen, input.bestLine)})`
        : ""
    }`,
    `In the game the player played ${playedSan} instead.`,
  ];
  if (input.playedFenAfter && input.punishLine?.length) {
    facts.push(
      `${colorName(opponent)}'s best reply to ${playedSan}: ${pvToSan(
        input.playedFenAfter,
        input.punishLine,
        4
      )}`
    );
  }
  for (const theme of input.themes) {
    if (PUZZLE_THEME_FACTS[theme]) facts.push(PUZZLE_THEME_FACTS[theme]);
  }
  const oppHanging = getHangingPieces(input.fen, opponent);
  if (oppHanging.length) {
    facts.push(
      `Opponent pieces that can be attacked: ${oppHanging.join(", ")}`
    );
  }
  const playerHanging = getHangingPieces(input.fen, player);
  if (playerHanging.length) {
    facts.push(
      `Player's pieces currently en prise: ${playerHanging.join(", ")}`
    );
  }
  facts.push(`Material: ${describeMaterial(input.fen)}`);

  const task =
    input.level === 1
      ? 'The player is trying to solve the puzzle and got it wrong. Give a nudge in ONE short sentence, talking to the player as "you". Point at the idea (a tactic, an undefended piece, a weakness, a threat) WITHOUT naming the best move, the piece that moves, or its destination square.'
      : `Talking to the player as "you", explain in 2-3 short sentences why ${bestSan} is the right move (what it wins, threatens or prevents, following the engine line) and what went wrong with ${playedSan} in the game.`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `${facts.join("\n")}\n\nTask: ${task}` },
  ];
};

export interface WeaknessReportInput {
  games: number;
  score: number;
  accuracy?: number;
  /** Phase lines such as "middlegame: 3.1 blunders per 100 moves, accuracy 78%" */
  phases: string[];
  findings: { title: string; detail: string; severity: string }[];
  /** Other facts, such as blunder-check results from play mode */
  other?: string[];
}

export const buildWeaknessReportMessages = (
  input: WeaknessReportInput
): ChatMessage[] => {
  const facts = [
    `These statistics come from the engine analysis of ${input.games} of the player's own games.`,
    `Overall score: ${Math.round(input.score)}%${
      input.accuracy !== undefined
        ? `, average accuracy ${Math.round(input.accuracy)}%`
        : ""
    }.`,
    "By game phase:",
    ...input.phases.map((line) => `- ${line}`),
    "",
    "Findings (computed from the games, most important first):",
    ...(input.findings.length
      ? input.findings.map((f) => `- [${f.severity}] ${f.title}. ${f.detail}`)
      : ["- No clear weakness stands out yet."]),
    ...(input.other?.length
      ? ["", "Other facts:", ...input.other.map((line) => `- ${line}`)]
      : []),
  ];

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${facts.join("\n")}

Task: Talking to the player as "you", turn these findings into a short study plan (Markdown).
Start with 1-2 sentences on the biggest pattern. Then **This week** followed by 2-4 bullet points of specific practice, each tied to one finding above.
Use only the numbers given here; don't invent statistics, openings or games. The app has a puzzle trainer built from the player's own mistakes ("Train → Puzzles"), and each finding has a "Train these" button that drills its positions, so suggest those where they fit. Keep it under 180 words.`,
    },
  ];
};

export interface OpeningPlanInput {
  /** Position before the player's move, the player to move */
  fen: string;
  openingName?: string;
  /** Moves from the start position to `fen`, numbered ("1. e4 e5 2. Nf3") */
  movesSoFar: string;
  /** The repertoire move, and the engine's line after it */
  correctUci: string;
  correctLine?: string[];
  /** Why it's the repertoire move */
  source: "played" | "corrected" | "pinned";
  /** The player's usual move here, when the repertoire uses another one */
  usualSan?: string;
  /** The move the player tried in the drill, and the engine's reply to it */
  playedUci: string;
  refutation?: string[];
  /** Win chance (0-100) for the player after each move, from the engine */
  correctWin?: number;
  playedWin?: number;
}

const describeGap = (gap: number) =>
  gap >= 20
    ? "much worse (it throws away a large part of the advantage or the game)"
    : gap >= 10
      ? "clearly worse"
      : "a bit worse";

export const buildOpeningPlanMessages = (
  input: OpeningPlanInput
): ChatMessage[] => {
  const player = input.fen.split(" ")[1] as "w" | "b";
  const opponent = player === "w" ? "b" : "w";
  const correctSan = uciToSan(input.fen, input.correctUci) ?? input.correctUci;
  const playedSan = uciToSan(input.fen, input.playedUci) ?? input.playedUci;

  const afterCorrect = (() => {
    try {
      return new Chess(input.fen).move(uciMoveParams(input.correctUci)).after;
    } catch {
      return undefined;
    }
  })();
  const afterPlayed = (() => {
    try {
      return new Chess(input.fen).move(uciMoveParams(input.playedUci)).after;
    } catch {
      return undefined;
    }
  })();

  const facts = [
    `This is an opening drill from the player's own repertoire, built from their games. The player is ${colorName(player)}.`,
    input.openingName
      ? `Opening (from an opening database): ${input.openingName}`
      : "The opening has no name in the database.",
    `Moves so far: ${input.movesSoFar || "none (starting position)"}`,
    `Position (FEN): ${input.fen}`,
    `Repertoire move: ${correctSan}${
      input.source === "corrected"
        ? ` (the engine's choice; in their games the player usually played ${input.usualSan ?? "another move"} here, which loses a lot)`
        : input.source === "pinned"
          ? " (chosen by the player)"
          : " (the move the player usually plays here)"
    }`,
  ];
  if (input.correctLine?.length) {
    facts.push(
      `Engine line with the repertoire move: ${pvToSan(input.fen, [
        input.correctUci,
        ...input.correctLine,
      ])}`
    );
  }
  if (afterCorrect) {
    facts.push(`Pawns after ${correctSan}: ${describePawns(afterCorrect)}`);
  }
  facts.push(`In the drill the player played ${playedSan} instead.`);
  if (afterPlayed && input.refutation?.length) {
    facts.push(
      `${colorName(opponent)}'s best reply to ${playedSan} and continuation: ${pvToSan(
        afterPlayed,
        input.refutation
      )}`
    );
  }
  if (input.correctWin !== undefined && input.playedWin !== undefined) {
    const gap = input.correctWin - input.playedWin;
    facts.push(
      gap > 0
        ? `The engine rates ${playedSan} ${describeGap(gap)} than ${correctSan}.`
        : `The engine rates ${playedSan} about as good as ${correctSan}.`
    );
  }
  if (afterPlayed) {
    const hanging = getHangingPieces(afterPlayed, player);
    if (hanging.length) {
      facts.push(
        `Player's pieces left en prise after ${playedSan}: ${hanging.join(", ")}`
      );
    }
    facts.push(`Material after ${playedSan}: ${describeMaterial(afterPlayed)}`);
  }

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${facts.join("\n")}

Task: Talking to the player as "you", explain in 2-4 short sentences the plan or idea behind ${correctSan} in this opening, then what goes wrong with ${playedSan} (use the engine's reply).
You may use general opening knowledge here (typical plans, pawn breaks, where the pieces go), but every claim must agree with the engine lines and the pawn structure given. Don't name other variations or quote theory you aren't sure of; if the plan isn't clear from the data, say so plainly and keep it general.`,
    },
  ];
};

export interface BlunderCheckInput {
  /** Position before the player's candidate move, the player to move */
  fen: string;
  candidateUci: string;
  /** The reply the player found for the opponent */
  answerUci: string;
  grade: "correct" | "partial" | "missed";
  /** Engine's best line for the opponent after the candidate move */
  bestLine: string[];
  /** The candidate loses a lot of win chance against the best reply */
  candidateWasBad: boolean;
}

const GRADE_FACTS: Record<BlunderCheckInput["grade"], string> = {
  correct: "This is the engine's best reply (or just as good).",
  partial: "This is one of the engine's top replies, but not the best one.",
  missed: "This is not among the engine's top replies.",
};

export const buildBlunderCheckMessages = (
  input: BlunderCheckInput
): ChatMessage[] => {
  const player = input.fen.split(" ")[1] as "w" | "b";
  const opponent = player === "w" ? "b" : "w";
  const candidateSan =
    uciToSan(input.fen, input.candidateUci) ?? input.candidateUci;
  let fenAfter: string | undefined;
  try {
    fenAfter = new Chess(input.fen).move(
      uciMoveParams(input.candidateUci)
    ).after;
  } catch {
    fenAfter = undefined;
  }

  const facts = [
    `The player (${colorName(player)}) is about to play ${moveLabel(input.fen, candidateSan)}. Before committing, they were asked to find ${colorName(opponent)}'s best reply.`,
    `Position before the move (FEN): ${input.fen}`,
  ];
  if (fenAfter) {
    const answerSan = uciToSan(fenAfter, input.answerUci) ?? input.answerUci;
    const bestSan = uciToSan(fenAfter, input.bestLine[0]) ?? input.bestLine[0];
    facts.push(
      `The player's answer: ${answerSan}. ${GRADE_FACTS[input.grade]}`,
      `Engine's best reply for ${colorName(opponent)}: ${bestSan} (line: ${pvToSan(
        fenAfter,
        input.bestLine
      )})`
    );
    const hanging = getHangingPieces(fenAfter, player);
    if (hanging.length) {
      facts.push(
        `Player's pieces left en prise after ${candidateSan}: ${hanging.join(", ")}`
      );
    }
    facts.push(`Material after ${candidateSan}: ${describeMaterial(fenAfter)}`);
  }
  facts.push(
    input.candidateWasBad
      ? `Engine verdict: ${candidateSan} loses a lot against this reply.`
      : `Engine verdict: ${candidateSan} holds up against this reply.`
  );

  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `${facts.join("\n")}

Task: Talking to the player as "you", explain in 1-3 short sentences what the opponent's best reply does (what it attacks, wins or threatens), following the engine line. ${
        input.candidateWasBad
          ? `Say plainly that ${candidateSan} runs into it, so they should think again.`
          : `Say that ${candidateSan} holds up.`
      } Don't suggest a different move for the player.`,
    },
  ];
};
