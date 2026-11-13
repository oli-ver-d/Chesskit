import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid2 as Grid,
  Link as MuiLink,
  Stack,
  Typography,
} from "@mui/material";
import { Icon } from "@iconify/react";
import NextLink from "next/link";
import { Chess, Move } from "chess.js";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { CSSProperties, useEffect, useEffectEvent, useState } from "react";
import { Arrow } from "react-chessboard/dist/chessboard/types";
import Board from "@/components/board";
import { DEFAULT_ENGINE } from "@/constants";
import { useEngine } from "@/hooks/useEngine";
import { getDb, notifyDbChange } from "@/lib/db";
import { isWasmSupported } from "@/lib/engine/shared";
import { uciMoveParams } from "@/lib/chess";
import {
  colorName,
  describeEval,
  pvToSan,
  winChanceFor,
} from "@/lib/coach/facts";
import { useChessActions } from "@/hooks/useChessActions";
import { CoachInline } from "@/sections/coach/coachBubble";
import { buildPuzzleCoachMessages } from "@/lib/coach/prompts";
import { recordPuzzleAttempt } from "@/lib/training/puzzleStore";
import { TRAINING_THRESHOLDS } from "@/lib/training/thresholds";
import { useCoachLLM } from "@/sections/coach/useCoachLLM";
import { Color } from "@/types/enums";
import { CurrentPosition, PositionEval } from "@/types/eval";
import { Game } from "@/types/game";
import { Puzzle, PuzzleResult } from "@/types/training";
import {
  getPieceHint,
  getPuzzleContext,
  getStaticExplanation,
  getStaticNudge,
  THEME_LABELS,
} from "./puzzleFacts";

/** Depth for grading a move that isn't one of the stored answers */
const LIVE_DEPTH = 16;
/** Wrong tries before the answer is shown */
const MAX_WRONG = 3;

const ANSWER_COLOR = "#81b64c";
const REFUTATION_COLOR = "#e05b4b";
/** The expected reply to the best move, while playing on after the puzzle */
const REPLY_COLOR = "rgba(240, 160, 60, 0.75)";
const HINT_SQUARE_STYLE: CSSProperties = {
  boxShadow: "inset 0 0 0 4px rgba(59, 154, 198, 0.95)",
};

type Phase = "solving" | "checking" | "wrong" | "solved" | "revealed";

interface Attempt {
  uci: string;
  san: string;
  fenAfter: string;
  /** Engine's best reply line to the attempt */
  refutation?: string[];
}

interface Props {
  puzzle: Puzzle;
  onNext: () => void;
  onSkip: () => void;
}

const toUci = (move: Move) => move.from + move.to + (move.promotion ?? "");

export default function PuzzleSolver({ puzzle, onNext, onSkip }: Props) {
  const [gameAtom] = useState(() => atom(new Chess(puzzle.fen)));
  const [positionAtom] = useState(() => atom<CurrentPosition>({}));
  const game = useAtomValue(gameAtom);
  const setGame = useSetAtom(gameAtom);
  const setPosition = useSetAtom(positionAtom);
  const engine = useEngine(DEFAULT_ENGINE);
  const llm = useCoachLLM();

  const [savedGame, setSavedGame] = useState<Game | null>();
  const [phase, setPhase] = useState<Phase>("solving");
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [hintLevel, setHintLevel] = useState(0);
  const [attempt, setAttempt] = useState<Attempt>();
  const [solvedUci, setSolvedUci] = useState<string>();
  const [recorded, setRecorded] = useState(false);
  const [boardWidth, setBoardWidth] = useState(0);
  const [boardBox, setBoardBox] = useState<HTMLDivElement | null>(null);
  /** Evals of the positions reached while playing on after the puzzle */
  const [evals, setEvals] = useState<Record<string, PositionEval>>({});
  const { playMove, undoMove } = useChessActions(gameAtom);

  const context = getPuzzleContext(puzzle, savedGame ?? undefined);
  const { previousMove } = context;
  const myColor = puzzle.myColor;
  const opponentName = colorName(myColor === Color.White ? "b" : "w");

  useEffect(() => {
    let cancelled = false;
    getDb()
      .then((db) => db.get("games", puzzle.gameId))
      .then((saved) => !cancelled && setSavedGame(saved ?? null));
    return () => {
      cancelled = true;
    };
  }, [puzzle.gameId]);

  // Show the opponent's last move until you move
  useEffect(() => {
    if (previousMove) {
      setPosition((prev) =>
        prev.lastMove ? prev : { lastMove: previousMove }
      );
    }
  }, [previousMove, setPosition]);

  useEffect(() => {
    if (!boardBox) return;
    const observer = new ResizeObserver(([entry]) =>
      setBoardWidth(Math.floor(entry.contentRect.width))
    );
    observer.observe(boardBox);
    return () => observer.disconnect();
  }, [boardBox]);

  const coachInput = (level: 1 | 3) =>
    buildPuzzleCoachMessages({
      fen: puzzle.fen,
      bestUci: puzzle.bestUci,
      bestLine: context.bestLine,
      playedUci: puzzle.playedUci,
      playedFenAfter: context.playedFenAfter,
      punishLine: context.punishLine,
      themes: puzzle.themes,
      level,
    });
  const nudgeKey = `puzzle|${puzzle.id}|1`;
  const explainKey = `puzzle|${puzzle.id}|3`;

  const askNudge = () => {
    if (llm.hasKey) llm.ask(nudgeKey, coachInput(1), { maxTokens: 120 });
  };
  const askExplanation = () => {
    if (llm.hasKey) llm.ask(explainKey, coachInput(3), { maxTokens: 250 });
  };

  const record = (result: PuzzleResult, uci?: string) => {
    if (recorded) return;
    setRecorded(true);
    recordPuzzleAttempt(puzzle.id, result, {
      wrongAttempts,
      hintLevel,
      solvedUci: uci,
    })
      .then(() => notifyDbChange("puzzles"))
      .catch((error) =>
        console.error("Saving the puzzle attempt failed", error)
      );
  };

  const reveal = () => {
    setGame(new Chess(puzzle.fen));
    setPosition({ lastMove: previousMove });
    setAttempt(undefined);
    setHintLevel(MAX_WRONG);
    setPhase("revealed");
    record("failed");
    askExplanation();
  };

  const solve = (uci: string) => {
    setSolvedUci(uci);
    setPhase("solved");
    record(wrongAttempts === 0 && hintLevel === 0 ? "clean" : "hinted", uci);
  };

  const handleAttempt = async (move: Move) => {
    const uci = toUci(move);
    setPosition({ lastMove: move });
    if (puzzle.acceptUci.includes(uci)) return solve(uci);

    setPhase("checking");
    let refutation: string[] | undefined;
    let myWin: number | undefined;
    if (engine?.getIsReady()) {
      try {
        const result = await engine.analysePosition(move.after, LIVE_DEPTH);
        refutation = result.lines[0]?.pv;
        myWin = winChanceFor(result.lines[0], myColor);
      } catch (error) {
        console.error("Puzzle move check failed", error);
      }
    }

    // Any move about as good as the best one counts
    if (
      myWin !== undefined &&
      myWin >= puzzle.winBefore - TRAINING_THRESHOLDS.acceptMargin
    ) {
      return solve(uci);
    }

    const wrong = wrongAttempts + 1;
    setWrongAttempts(wrong);
    setAttempt({ uci, san: move.san, fenAfter: move.after, refutation });
    if (wrong >= MAX_WRONG) return reveal();
    setHintLevel((level) => Math.max(level, wrong));
    setPhase("wrong");
    if (wrong === 1) askNudge();
  };

  const onBoardMove = useEffectEvent((move: Move) => {
    handleAttempt(move);
  });

  // Effect events stay out of the deps; this eslint plugin predates useEffectEvent
  useEffect(() => {
    if (phase !== "solving") return;
    const [move] = game.history({ verbose: true });
    if (move) onBoardMove(move);
  }, [game, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const tryAgain = () => {
    setGame(new Chess(puzzle.fen));
    setPosition({ lastMove: previousMove });
    setAttempt(undefined);
    setPhase("solving");
  };

  const showHint = () => {
    const level = hintLevel + 1;
    if (level >= MAX_WRONG) return reveal();
    setHintLevel(level);
    if (level === 1) askNudge();
  };

  // Once the puzzle is over the board is free: play on for either side, with
  // the engine's eval and best moves shown for every position you reach.
  const done = phase === "solved" || phase === "revealed";
  const fen = game.fen();
  const history = game.history({ verbose: true });
  const lastPlayed = history.at(-1);
  const currentEval = done ? evals[fen] : undefined;
  const hasEval = !!evals[fen];

  useEffect(() => {
    if (!done || hasEval || !engine?.getIsReady()) return;
    engine
      .analysePosition(fen, LIVE_DEPTH)
      .then((result) => setEvals((prev) => ({ ...prev, [fen]: result })))
      .catch((error) => console.error("Puzzle follow-up eval failed", error));
  }, [done, hasEval, engine, fen]);

  useEffect(() => {
    if (!done) return;
    setPosition({ lastMove: lastPlayed ?? previousMove, eval: currentEval });
  }, [done, fen, currentEval, previousMove]); // eslint-disable-line react-hooks/exhaustive-deps

  // At the puzzle position the stored answer wins over a fresh search, so the
  // arrow always matches the solution text.
  const nextLine =
    history.length === 0
      ? (context.bestLine ?? [puzzle.bestUci])
      : (currentEval?.lines[0]?.pv ?? []);
  const evalLine = currentEval?.lines[0];
  const myWin = winChanceFor(evalLine, myColor);

  const playBest = () => {
    if (nextLine[0]) playMove(uciMoveParams(nextLine[0]));
  };

  const engineLoading = !engine && isWasmSupported();
  const canPlay = done
    ? true
    : phase === "solving" && !engineLoading && myColor;

  const arrows: Arrow[] = [];
  if (done && !game.isGameOver()) {
    const [best, reply] = nextLine;
    if (best) {
      arrows.push([best.slice(0, 2), best.slice(2, 4), ANSWER_COLOR] as Arrow);
    }
    if (reply) {
      arrows.push([reply.slice(0, 2), reply.slice(2, 4), REPLY_COLOR] as Arrow);
    }
  }
  if (phase === "wrong" && attempt?.refutation?.[0]) {
    const reply = attempt.refutation[0];
    arrows.push([
      reply.slice(0, 2),
      reply.slice(2, 4),
      REFUTATION_COLOR,
    ] as Arrow);
  }

  const squareStyles =
    hintLevel >= 2 && (phase === "solving" || phase === "wrong")
      ? { [puzzle.bestUci.slice(0, 2)]: HINT_SQUARE_STYLE }
      : undefined;

  const nudge = llm.hasKey ? llm.get(nudgeKey) : undefined;
  const nudgeText =
    nudge?.status === "done" && nudge.text
      ? nudge.text
      : getStaticNudge(puzzle);
  const explanation = llm.hasKey ? llm.get(explainKey) : undefined;

  const players = {
    white: savedGame?.white ?? { name: "White" },
    black: savedGame?.black ?? { name: "Black" },
  };
  const gameHref = `/?gameId=${puzzle.gameId}&ply=${puzzle.ply}`;
  const lossPoints = Math.round(puzzle.winBefore - puzzle.winAfter);

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 7 }} ref={setBoardBox}>
        {boardWidth > 0 && (
          <Board
            id="PuzzleBoard"
            canPlay={canPlay}
            gameAtom={gameAtom}
            boardSize={Math.min(boardWidth, 520)}
            whitePlayer={players.white}
            blackPlayer={players.black}
            boardOrientation={myColor}
            currentPositionAtom={positionAtom}
            extraArrows={arrows}
            showEvaluationBar={done}
            customSquareStyles={squareStyles}
          />
        )}
      </Grid>

      <Grid size={{ xs: 12, md: 5 }}>
        <Stack gap={2}>
          <Box>
            <Typography variant="h6">Find the move you missed</Typography>
            <Typography variant="body2" color="text.secondary">
              {colorName(myColor)} to move.{" "}
              {puzzle.kind === "blunder"
                ? `Your move here cost you ${lossPoints}% win chance.`
                : `You had a much stronger move here (${lossPoints}% more win chance).`}
            </Typography>
            <Stack direction="row" gap={0.5} flexWrap="wrap" mt={1}>
              <Chip
                size="small"
                color={puzzle.kind === "blunder" ? "error" : "warning"}
                label={puzzle.kind === "blunder" ? "Blunder" : "Missed chance"}
              />
              {puzzle.themes.map((theme) => (
                <Chip
                  key={theme}
                  size="small"
                  variant="outlined"
                  label={THEME_LABELS[theme] ?? theme}
                />
              ))}
            </Stack>
          </Box>

          {engineLoading && phase === "solving" && (
            <Stack direction="row" gap={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2">Loading the engine…</Typography>
            </Stack>
          )}

          {phase === "checking" && (
            <Stack direction="row" gap={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2">Checking your move…</Typography>
            </Stack>
          )}

          {phase === "wrong" && attempt && (
            <Alert severity="error">
              <strong>{attempt.san}</strong> isn't it.
              {attempt.refutation?.length
                ? ` ${opponentName} replies ${pvToSan(
                    attempt.fenAfter,
                    attempt.refutation,
                    4
                  )}.`
                : ""}
            </Alert>
          )}

          {(phase === "solving" || phase === "wrong" || phase === "checking") &&
            hintLevel >= 1 && (
              <Alert
                severity="info"
                icon={<Icon icon="mdi:lightbulb-outline" />}
              >
                {nudge?.status === "loading" ? (
                  "The coach is thinking…"
                ) : (
                  <CoachInline text={nudgeText} />
                )}
                {hintLevel >= 2 && <Box mt={1}>{getPieceHint(puzzle)}</Box>}
              </Alert>
            )}

          {phase === "solved" && solvedUci && (
            <Alert severity="success">
              {puzzle.acceptUci.includes(solvedUci) ? (
                <>
                  <strong>Correct!</strong>{" "}
                  {solvedUci === puzzle.bestUci
                    ? ""
                    : `The engine's top move was ${context.bestSan}, but this works too.`}
                </>
              ) : (
                <>
                  <strong>This also works.</strong> The engine's top move was{" "}
                  {context.bestSan}.
                </>
              )}
            </Alert>
          )}

          {phase === "revealed" && (
            <Alert severity="warning">
              The answer was <strong>{context.bestSan}</strong>. This puzzle
              comes back in a few days.
            </Alert>
          )}

          {(phase === "solved" || phase === "revealed") && (
            <Stack gap={1}>
              <Typography variant="body2">
                In the game you played <strong>{context.playedSan}</strong>.{" "}
                <MuiLink component={NextLink} href={gameHref}>
                  See it in your game
                </MuiLink>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {explanation?.status === "done" && explanation.text ? (
                  <CoachInline text={explanation.text} />
                ) : explanation?.status === "loading" ? (
                  "The coach is thinking…"
                ) : (
                  getStaticExplanation(puzzle, context)
                )}
              </Typography>
              {llm.hasKey && !explanation && (
                <Box>
                  <Button
                    size="small"
                    startIcon={<Icon icon="mdi:message-text-outline" />}
                    onClick={askExplanation}
                  >
                    Ask the coach why
                  </Button>
                </Box>
              )}
            </Stack>
          )}

          {done && (
            <Box
              sx={{
                borderRadius: 1,
                border: 1,
                borderColor: "divider",
                px: 1.5,
                py: 1,
              }}
            >
              <Typography variant="subtitle2">Play it out</Typography>
              <Typography variant="body2">
                {game.isCheckmate()
                  ? "Checkmate."
                  : game.isGameOver()
                    ? "The game is drawn here."
                    : evalLine
                      ? `${describeEval(evalLine)}${
                          myWin !== undefined && evalLine.mate === undefined
                            ? `, ${Math.round(myWin)}% win chance for you`
                            : ""
                        }.`
                      : "Evaluating…"}
              </Typography>
              {!game.isGameOver() && nextLine.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  Best line: {pvToSan(fen, nextLine)}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                Move either side on the board. Green is the best move, orange
                the expected reply.
              </Typography>
              <Stack direction="row" gap={1} mt={0.5}>
                <Button
                  size="small"
                  startIcon={<Icon icon="mdi:undo" />}
                  disabled={history.length === 0}
                  onClick={undoMove}
                >
                  Back
                </Button>
                <Button
                  size="small"
                  endIcon={<Icon icon="mdi:chevron-right" />}
                  disabled={!nextLine[0] || game.isGameOver()}
                  onClick={playBest}
                >
                  Play best move
                </Button>
              </Stack>
            </Box>
          )}

          <Stack direction="row" gap={1} flexWrap="wrap">
            {phase === "wrong" && (
              <Button variant="contained" onClick={tryAgain}>
                Try again
              </Button>
            )}
            {(phase === "solving" || phase === "wrong") && (
              <>
                <Button
                  variant="outlined"
                  startIcon={<Icon icon="mdi:lightbulb-on-outline" />}
                  onClick={showHint}
                >
                  Hint
                </Button>
                <Button variant="outlined" onClick={reveal}>
                  Show solution
                </Button>
                {wrongAttempts === 0 && hintLevel === 0 && (
                  <Button color="inherit" onClick={onSkip}>
                    Skip
                  </Button>
                )}
              </>
            )}
            {(phase === "solved" || phase === "revealed") && (
              <Button
                variant="contained"
                endIcon={<Icon icon="mdi:arrow-right" />}
                onClick={onNext}
              >
                Next puzzle
              </Button>
            )}
          </Stack>
        </Stack>
      </Grid>
    </Grid>
  );
}
