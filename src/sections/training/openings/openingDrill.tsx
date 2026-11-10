import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid2 as Grid,
  Stack,
  Typography,
} from "@mui/material";
import { Icon } from "@iconify/react";
import { Chess, Move } from "chess.js";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useEffectEvent, useState } from "react";
import { Arrow } from "react-chessboard/dist/chessboard/types";
import Board from "@/components/board";
import { DEFAULT_ENGINE } from "@/constants";
import { useEngine } from "@/hooks/useEngine";
import { uciMoveParams } from "@/lib/chess";
import { colorName, pvToSan, winChanceFor } from "@/lib/coach/facts";
import { buildOpeningPlanMessages } from "@/lib/coach/prompts";
import { isWasmSupported } from "@/lib/engine/shared";
import { getFenKey } from "@/lib/training/puzzles";
import {
  countReachable,
  formatSanPath,
  getPositionName,
  isEntryDue,
  pickDrillReply,
  Repertoire,
  RepertoireEntry,
  RepertoireLine,
} from "@/lib/training/repertoire";
import {
  recordOpeningAttempt,
  updateRepertoireNode,
} from "@/lib/training/repertoireStore";
import { TRAINING_THRESHOLDS } from "@/lib/training/thresholds";
import { useCoachLLM } from "@/sections/coach/useCoachLLM";
import { Color } from "@/types/enums";
import { CurrentPosition } from "@/types/eval";
import { PuzzleResult } from "@/types/training";

/** Depth for comparing a move outside the repertoire with the repertoire move */
const CHECK_DEPTH = 14;
/** Pause before the opponent's move, so you can see it coming */
const OPPONENT_DELAY_MS = 500;

const ANSWER_COLOR = "#81b64c";
const REFUTATION_COLOR = "#e05b4b";

type Phase =
  | "opponent"
  | "yourMove"
  | "checking"
  | "alternative"
  | "wrong"
  | "lineDone";

interface OffBook {
  entry: RepertoireEntry;
  uci: string;
  san: string;
  fenAfter: string;
  /** Engine's reply line to your move */
  refutation?: string[];
  /** Engine's line after the repertoire move */
  correctLine?: string[];
  playedWin?: number;
  correctWin?: number;
}

interface Feedback {
  severity: "success" | "info";
  text: string;
}

interface Props {
  repertoire: Repertoire;
  /** Drill one line; the whole repertoire for the colour when undefined */
  line?: RepertoireLine;
  onEnd: () => void;
}

const toUci = (move: Move) => move.from + move.to + (move.promotion ?? "");

const chessFromPath = (path: string[]): Chess => {
  const chess = new Chess();
  for (const uci of path) chess.move(uciMoveParams(uci));
  return chess;
};

const withMove = (chess: Chess, uci: string): Chess => {
  const next = chessFromPath(chess.history({ verbose: true }).map(toUci));
  next.move(uciMoveParams(uci));
  return next;
};

const lastMoveOf = (chess: Chess): Move | undefined =>
  chess.history({ verbose: true }).at(-1);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Where the repertoire move comes from, for the explanation */
export const describeSource = (entry: RepertoireEntry): string => {
  switch (entry.source) {
    case "corrected":
      return `It's the engine's move: you usually play ${entry.usual?.san} here, which loses ${Math.round(
        entry.usual?.avgLoss ?? 0
      )}% win chance on average.`;
    case "pinned":
      return "You chose this move for your repertoire.";
    default: {
      const count = entry.moves.find((m) => m.uci === entry.uci)?.count ?? 0;
      return `You played it in ${count} of your ${plural(entry.games, "game")} from this position.`;
    }
  }
};

/** Train → Openings drill: play your repertoire moves; the opponent's are played for you */
export default function OpeningDrill({ repertoire, line, onEnd }: Props) {
  const startPath = line?.startPath ?? [];
  const [gameAtom] = useState(() => atom(chessFromPath(startPath)));
  const [positionAtom] = useState(() => atom<CurrentPosition>({}));
  const game = useAtomValue(gameAtom);
  const setGame = useSetAtom(gameAtom);
  const setPosition = useSetAtom(positionAtom);
  const engine = useEngine(DEFAULT_ENGINE);
  const llm = useCoachLLM();

  const { color } = repertoire;
  const [phase, setPhase] = useState<Phase>("opponent");
  const [entryKey, setEntryKey] = useState<string>();
  /** Moves on the board when your move is awaited */
  const [awaitPly, setAwaitPly] = useState(0);
  const [pendingReply, setPendingReply] = useState<string>();
  const [offBook, setOffBook] = useState<OffBook>();
  const [feedback, setFeedback] = useState<Feedback>();
  /** Positions graded this session (each counts once per session) */
  const [doneKeys, setDoneKeys] = useState<string[]>([]);
  const [lineStats, setLineStats] = useState({ right: 0, wrong: 0 });
  const [totals, setTotals] = useState({ right: 0, wrong: 0, lines: 0 });
  const [started, setStarted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [boardWidth, setBoardWidth] = useState(0);
  const [boardBox, setBoardBox] = useState<HTMLDivElement | null>(null);

  const lineKeys = line ? new Set(line.entries.map((e) => e.key)) : undefined;
  const within = (entry: RepertoireEntry) =>
    !lineKeys || lineKeys.has(entry.key);
  const toDrill = (entry: RepertoireEntry, done: string[], now: number) =>
    within(entry) && isEntryDue(entry, now) && !done.includes(entry.key);

  const entry = entryKey ? repertoire.byKey[entryKey] : undefined;

  useEffect(() => {
    if (!boardBox) return;
    const observer = new ResizeObserver(([e]) =>
      setBoardWidth(Math.floor(e.contentRect.width))
    );
    observer.observe(boardBox);
    return () => observer.disconnect();
  }, [boardBox]);

  /** Decides what happens in the position on the board */
  const advance = (chess: Chess, done: string[]) => {
    const key = getFenKey(chess.fen());
    if (chess.turn() === color) {
      const next = repertoire.byKey[key];
      // A line's drill ends where the line does
      if (next && !next.excluded && within(next)) {
        setEntryKey(key);
        setAwaitPly(chess.history().length);
        setPhase("yourMove");
      } else {
        setPhase("lineDone");
      }
      return;
    }
    const now = Date.now();
    const reply = pickDrillReply(
      repertoire,
      key,
      (e) => toDrill(e, done, now),
      within
    );
    if (!reply) {
      setPhase("lineDone");
      return;
    }
    setPendingReply(reply.uci);
    setPhase("opponent");
  };

  const startLine = (done: string[]) => {
    setNow(Date.now());
    const chess = chessFromPath(startPath);
    setGame(chess);
    setPosition({ lastMove: lastMoveOf(chess) });
    setOffBook(undefined);
    setFeedback(undefined);
    setLineStats({ right: 0, wrong: 0 });
    advance(chess, done);
  };

  const onStart = useEffectEvent(() => startLine([]));
  useEffect(() => {
    if (started) return;
    setStarted(true);
    onStart();
  }, [started]); // eslint-disable-line react-hooks/exhaustive-deps

  const playReply = useEffectEvent((uci: string) => {
    const chess = withMove(game, uci);
    setGame(chess);
    setPosition({ lastMove: lastMoveOf(chess) });
    setPendingReply(undefined);
    advance(chess, doneKeys);
  });

  useEffect(() => {
    if (phase !== "opponent" || !pendingReply) return;
    const timer = setTimeout(() => playReply(pendingReply), OPPONENT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [phase, pendingReply]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Saves the first answer in a position this session */
  const grade = (
    graded: RepertoireEntry,
    result: PuzzleResult,
    playedUci: string,
    alternative = false
  ): string[] => {
    if (doneKeys.includes(graded.key)) return doneKeys;
    const done = [...doneKeys, graded.key];
    setDoneKeys(done);
    const right = result !== "failed";
    setLineStats((s) => ({
      right: s.right + (right ? 1 : 0),
      wrong: s.wrong + (right ? 0 : 1),
    }));
    setTotals((s) => ({
      ...s,
      right: s.right + (right ? 1 : 0),
      wrong: s.wrong + (right ? 0 : 1),
    }));
    recordOpeningAttempt(color, graded.key, result, {
      playedUci,
      expectedUci: graded.uci,
      alternative,
    }).catch((error) =>
      console.error("Saving the opening attempt failed", error)
    );
    return done;
  };

  /** Back to the position before your move, then the repertoire move */
  const continueWithRepertoireMove = (done: string[]) => {
    if (!entry) return;
    const chess = withMove(chessFromPath(entry.path), entry.uci);
    setGame(chess);
    setPosition({ lastMove: lastMoveOf(chess) });
    setOffBook(undefined);
    advance(chess, done);
  };

  const planKey = (o: OffBook) => `opening|${color}|${o.entry.key}|${o.uci}`;
  const askPlan = (o: OffBook) => {
    if (!llm.hasKey) return;
    llm.ask(
      planKey(o),
      buildOpeningPlanMessages({
        fen: o.entry.fen,
        openingName: getPositionName(o.entry.fen) ?? o.entry.openingName,
        movesSoFar: formatSanPath(o.entry.sanPath),
        correctUci: o.entry.uci,
        correctLine: o.correctLine,
        source: o.entry.source,
        usualSan: o.entry.usual?.san,
        playedUci: o.uci,
        refutation: o.refutation,
        correctWin: o.correctWin,
        playedWin: o.playedWin,
      }),
      { maxTokens: 300 }
    );
  };

  const handleMove = async (move: Move) => {
    if (!entry) return;
    const uci = toUci(move);
    setPosition({ lastMove: move });

    if (phase === "wrong") {
      // You must play the repertoire move to go on
      if (entry.accepted.includes(uci)) {
        setOffBook(undefined);
        advance(game, doneKeys);
      } else {
        setGame(chessFromPath(entry.path));
        setPosition({ lastMove: undefined });
      }
      return;
    }

    if (entry.accepted.includes(uci)) {
      const done = grade(entry, "clean", uci);
      setFeedback({
        severity: "success",
        text:
          uci === entry.uci
            ? `${move.san} is right.`
            : `${move.san} is one of your accepted moves here.`,
      });
      advance(game, done);
      return;
    }

    setPhase("checking");
    setFeedback(undefined);
    const correctFen = withMove(chessFromPath(entry.path), entry.uci).fen();
    let refutation: string[] | undefined;
    let correctLine: string[] | undefined;
    let playedWin: number | undefined;
    let correctWin: number | undefined;
    if (engine?.getIsReady()) {
      try {
        const played = await engine.analysePosition(move.after, CHECK_DEPTH);
        const correct = await engine.analysePosition(correctFen, CHECK_DEPTH);
        refutation = played.lines[0]?.pv;
        correctLine = correct.lines[0]?.pv;
        playedWin = winChanceFor(played.lines[0], color);
        correctWin = winChanceFor(correct.lines[0], color);
      } catch (error) {
        console.error("Opening move check failed", error);
      }
    }

    const result: OffBook = {
      entry,
      uci,
      san: move.san,
      fenAfter: move.after,
      refutation,
      correctLine,
      playedWin,
      correctWin,
    };
    setOffBook(result);

    if (
      playedWin !== undefined &&
      correctWin !== undefined &&
      playedWin >= correctWin - TRAINING_THRESHOLDS.acceptMargin
    ) {
      setPhase("alternative");
      return;
    }

    grade(entry, "failed", uci);
    setGame(chessFromPath(entry.path));
    setPosition({ lastMove: undefined });
    setPhase("wrong");
    askPlan(result);
  };

  const onBoardMove = useEffectEvent((move: Move) => {
    handleMove(move);
  });

  useEffect(() => {
    if (phase !== "yourMove" && phase !== "wrong") return;
    if (game.history().length !== awaitPly + 1) return;
    const move = lastMoveOf(game);
    if (move) onBoardMove(move);
  }, [game, phase, awaitPly]); // eslint-disable-line react-hooks/exhaustive-deps

  const acceptAlternative = () => {
    if (!offBook) return;
    const { uci, san } = offBook;
    updateRepertoireNode(color, offBook.entry.key, (node) => ({
      ...node,
      extraUci: [...new Set([...(node.extraUci ?? []), uci])],
    })).catch((error) => console.error("Saving the move failed", error));
    const done = grade(offBook.entry, "clean", uci, true);
    setFeedback({
      severity: "success",
      text: `${san} added to your repertoire as another good move here. The drill goes on with ${offBook.entry.san}.`,
    });
    continueWithRepertoireMove(done);
  };

  const skipAlternative = () => {
    if (!offBook) return;
    const done = grade(offBook.entry, "hinted", offBook.uci, true);
    setFeedback({
      severity: "info",
      text: `Going on with your repertoire move, ${offBook.entry.san}.`,
    });
    continueWithRepertoireMove(done);
  };

  const nextLine = () => {
    setTotals((s) => ({ ...s, lines: s.lines + 1 }));
    startLine(doneKeys);
  };

  const engineLoading = !engine && isWasmSupported();
  const canPlay =
    (phase === "yourMove" || phase === "wrong") && !engineLoading
      ? color
      : false;

  const arrows: Arrow[] = [];
  if (phase === "wrong" && offBook) {
    arrows.push([
      offBook.entry.uci.slice(0, 2),
      offBook.entry.uci.slice(2, 4),
      ANSWER_COLOR,
    ] as Arrow);
  }
  if (phase === "alternative" && offBook?.refutation?.[0]) {
    const reply = offBook.refutation[0];
    arrows.push([
      reply.slice(0, 2),
      reply.slice(2, 4),
      REFUTATION_COLOR,
    ] as Arrow);
  }

  const history = game.history({ verbose: true });
  const name =
    history
      .map((move) => getPositionName(move.after))
      .filter(Boolean)
      .at(-1) ?? line?.family;
  const remaining = countReachable(repertoire, repertoire.rootKey, (e) =>
    toDrill(e, doneKeys, now)
  );

  const plan = offBook && llm.hasKey ? llm.get(planKey(offBook)) : undefined;
  const me = { name: "You" };
  const opponent = { name: "Opponent" };

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 7 }} ref={setBoardBox}>
        {boardWidth > 0 && (
          <Board
            id="OpeningBoard"
            canPlay={canPlay}
            gameAtom={gameAtom}
            boardSize={Math.min(boardWidth, 520)}
            whitePlayer={color === Color.White ? me : opponent}
            blackPlayer={color === Color.Black ? me : opponent}
            boardOrientation={color}
            currentPositionAtom={positionAtom}
            extraArrows={arrows}
          />
        )}
      </Grid>

      <Grid size={{ xs: 12, md: 5 }}>
        <Stack gap={2}>
          <Box>
            <Typography variant="h6">
              {name ?? `Your ${colorName(color)} repertoire`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {history.length
                ? formatSanPath(history.map((move) => move.san))
                : "Starting position"}
            </Typography>
          </Box>

          {feedback && phase !== "wrong" && phase !== "alternative" && (
            <Alert severity={feedback.severity}>{feedback.text}</Alert>
          )}

          {engineLoading && (
            <Stack direction="row" gap={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2">Loading the engine…</Typography>
            </Stack>
          )}

          {phase === "opponent" && (
            <Typography variant="body2" color="text.secondary">
              Your opponent is moving…
            </Typography>
          )}

          {phase === "yourMove" && entry && (
            <Typography variant="body2">
              <strong>Your move.</strong> Play your repertoire move. You've
              reached this position in {plural(entry.games, "game")}.
            </Typography>
          )}

          {phase === "checking" && (
            <Stack direction="row" gap={1} alignItems="center">
              <CircularProgress size={16} />
              <Typography variant="body2">
                That's not your repertoire move. Checking it…
              </Typography>
            </Stack>
          )}

          {phase === "alternative" && offBook && (
            <Alert severity="info">
              <strong>{offBook.san}</strong> isn't your repertoire move (
              {offBook.entry.san}), but the engine rates it about as good.
              <Stack direction="row" gap={1} mt={1} flexWrap="wrap">
                <Button
                  size="small"
                  variant="contained"
                  onClick={acceptAlternative}
                >
                  Add {offBook.san} to my repertoire
                </Button>
                <Button size="small" color="inherit" onClick={skipAlternative}>
                  Keep {offBook.entry.san}
                </Button>
              </Stack>
            </Alert>
          )}

          {phase === "wrong" && offBook && (
            <>
              <Alert severity="error">
                <strong>{offBook.san}</strong> isn't it. Your repertoire move
                here is <strong>{offBook.entry.san}</strong>.{" "}
                {describeSource(offBook.entry)}
              </Alert>
              <Typography variant="body2" color="text.secondary">
                {plan?.status === "done" && plan.text
                  ? plan.text
                  : plan?.status === "loading"
                    ? "The coach is thinking…"
                    : staticExplanation(offBook)}
              </Typography>
              <Typography variant="body2">
                Play {offBook.entry.san} to go on.
              </Typography>
            </>
          )}

          {phase === "lineDone" && (
            <Alert severity="success" icon={<Icon icon="mdi:flag-checkered" />}>
              <strong>End of the line.</strong>{" "}
              {lineStats.right + lineStats.wrong
                ? `${lineStats.right} of ${lineStats.right + lineStats.wrong} moves right.`
                : "Every position here was already drilled this session."}{" "}
              {remaining
                ? `${plural(remaining, "position")} still to drill${line ? " in this line" : ""}.`
                : "Nothing left to drill today; more lines are just practice."}
            </Alert>
          )}

          <Stack direction="row" gap={1} flexWrap="wrap">
            {phase === "lineDone" && (
              <Button
                variant="contained"
                endIcon={<Icon icon="mdi:arrow-right" />}
                onClick={nextLine}
              >
                Next line
              </Button>
            )}
            <Button color="inherit" onClick={onEnd}>
              End drill
            </Button>
          </Stack>

          {totals.right + totals.wrong > 0 && (
            <Typography variant="caption" color="text.secondary">
              This session: {totals.right} right, {totals.wrong} wrong over{" "}
              {plural(totals.lines + 1, "line")}.
            </Typography>
          )}
        </Stack>
      </Grid>
    </Grid>
  );
}

/** Explanation without an API key: the right move, its engine line and the refutation */
const staticExplanation = (offBook: OffBook): string => {
  const { entry } = offBook;
  const parts: string[] = [];
  if (offBook.correctLine?.length) {
    parts.push(
      `The engine's line: ${pvToSan(entry.fen, [entry.uci, ...offBook.correctLine])}.`
    );
  }
  if (offBook.refutation?.length) {
    parts.push(
      `After ${offBook.san} it replies ${pvToSan(offBook.fenAfter, offBook.refutation, 4)}.`
    );
  }
  return parts.join(" ");
};
