import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";
import { Move } from "chess.js";
import { Square } from "react-chessboard/dist/chessboard/types";
import { DEFAULT_ENGINE } from "@/constants";
import { useEngine } from "@/hooks/useEngine";
import { useChessActions } from "@/hooks/useChessActions";
import { PositionEval } from "@/types/eval";
import { MoveClassification } from "@/types/enums";
import { getMovesClassification } from "@/lib/engine/helpers/moveClassification";
import {
  BAD_CLASSIFICATIONS,
  buildBotMoveMessages,
  buildHintMessages,
  buildMoveExplanationMessages,
  GREAT_CLASSIFICATIONS,
} from "@/lib/coach/prompts";
import {
  getNullMoveFen,
  moveLabel,
  pieceOnSquare,
  uciToSan,
  winChanceFor,
} from "@/lib/coach/facts";
import { useCoachLLM } from "@/sections/coach/useCoachLLM";
import {
  playCoachEnabledAtom,
  playCoachTakebacksAtom,
  playCoachVerbosityAtom,
} from "@/sections/coach/states";
import {
  gameAtom,
  gameDataAtom,
  isGameInProgressAtom,
  playerColorAtom,
} from "../states";
import {
  CoachMessage,
  coachMessagesAtom,
  hintArrowsAtom,
  hintLevelAtom,
} from "./states";

const COACH_DEPTH = 14;
const THREAT_DEPTH = 10;
/** Win-chance gain (in %) for the bot if the player "passes" to count as a threat */
const THREAT_THRESHOLD = 12;
const HINT_ARROW_COLOR = "#3B9AC6";

const toUci = (move: Move) => `${move.from}${move.to}${move.promotion ?? ""}`;

export const usePlayCoach = () => {
  const game = useAtomValue(gameAtom);
  const playerColor = useAtomValue(playerColorAtom);
  const isGameInProgress = useAtomValue(isGameInProgressAtom);
  const enabled = useAtomValue(playCoachEnabledAtom);
  const verbosity = useAtomValue(playCoachVerbosityAtom);
  const takebacks = useAtomValue(playCoachTakebacksAtom);
  const setMessages = useSetAtom(coachMessagesAtom);
  const setGameData = useSetAtom(gameDataAtom);
  const setHintArrows = useSetAtom(hintArrowsAtom);
  const [hintLevel, setHintLevel] = useAtom(hintLevelAtom);
  const { goToMove } = useChessActions(gameAtom);
  const engine = useEngine(DEFAULT_ENGINE);
  const llm = useCoachLLM();

  const llmRef = useRef(llm);
  llmRef.current = llm;
  const gameRef = useRef(game);
  gameRef.current = game;
  const settingsRef = useRef({ verbosity, takebacks, playerColor });
  settingsRef.current = { verbosity, takebacks, playerColor };

  const processedRef = useRef<string[]>([]);
  const evalCache = useRef(new Map<string, Promise<PositionEval>>());

  const getEval = useCallback(
    (fen: string, depth = COACH_DEPTH): Promise<PositionEval> => {
      const key = `${depth}|${fen}`;
      const cached = evalCache.current.get(key);
      if (cached) return cached;
      if (!engine?.getIsReady()) {
        return Promise.reject(new Error("Engine not ready"));
      }
      const promise = engine.analysePosition(fen, depth).then((res) => {
        if (!res.lines.length) throw new Error("Empty evaluation");
        return res;
      });
      promise.catch(() => evalCache.current.delete(key));
      evalCache.current.set(key, promise);
      return promise;
    },
    [engine]
  );

  const isStillCurrent = (lineSans: string[]) =>
    gameRef.current.history().slice(0, lineSans.length).join() ===
    lineSans.join();

  const updateMessage = useCallback(
    (id: string, patch: Partial<CoachMessage>) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
      ),
    [setMessages]
  );

  const handlePlayerMove = useCallback(
    async (move: Move, ply: number, lineSans: string[]) => {
      const id = `player-${ply}-${move.after}`;
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== id),
        { id, kind: "player", ply, title: moveLabel(move.before, move.san) },
      ]);

      let before: PositionEval, after: PositionEval;
      try {
        [before, after] = await Promise.all([
          getEval(move.before),
          getEval(move.after),
        ]);
      } catch {
        return;
      }
      if (!isStillCurrent(lineSans)) return;

      const uci = toUci(move);
      const classification = getMovesClassification(
        [before, after],
        [uci],
        [move.before, move.after]
      )[1]?.moveClassification;

      const { verbosity, takebacks } = settingsRef.current;
      const { hasKey, ask } = llmRef.current;
      const isBad =
        !!classification && BAD_CLASSIFICATIONS.includes(classification);
      const isGreat =
        !!classification && GREAT_CLASSIFICATIONS.includes(classification);
      const shouldExplain =
        hasKey &&
        (verbosity === "all" || (verbosity === "key" && (isBad || isGreat)));

      let textKey: string | undefined;
      let text: string | undefined;

      if (shouldExplain) {
        textKey = `play-move|${move.before}|${uci}`;
        ask(
          textKey,
          buildMoveExplanationMessages({
            fenBefore: move.before,
            fenAfter: move.after,
            san: move.san,
            uci,
            evalBefore: before,
            evalAfter: after,
            classification,
            plyIndex: ply - 1,
            audience: "player",
          })
        );
      } else if (isBad) {
        const best = uciToSan(
          move.before,
          before.bestMove ?? before.lines[0]?.pv?.[0]
        );
        if (best) text = `${best} was better.`;
      }

      updateMessage(id, {
        classification,
        textKey,
        text,
        canTakeback:
          takebacks &&
          (classification === MoveClassification.Mistake ||
            classification === MoveClassification.Blunder),
      });

      setGameData((prev) =>
        prev.lastMove?.after === move.after
          ? {
              ...prev,
              eval: { lines: after.lines, moveClassification: classification },
            }
          : prev
      );
    },
    [getEval, setMessages, updateMessage, setGameData] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleBotMove = useCallback(
    async (move: Move, ply: number, lineSans: string[]) => {
      const { verbosity } = settingsRef.current;
      const { hasKey, ask } = llmRef.current;
      if (verbosity === "off" || !hasKey) return;

      let after: PositionEval;
      let threat: PositionEval | undefined;
      const nullFen = getNullMoveFen(move.after);
      try {
        after = await getEval(move.after);
        if (nullFen)
          threat = await getEval(nullFen, THREAT_DEPTH).catch(() => undefined);
      } catch {
        return;
      }
      if (!isStillCurrent(lineSans)) return;

      const now = winChanceFor(after.lines[0], move.color);
      const ifIgnored = winChanceFor(threat?.lines[0], move.color);
      const hasThreat =
        now !== undefined &&
        ifIgnored !== undefined &&
        ifIgnored - now > THREAT_THRESHOLD;

      if (verbosity === "key" && !hasThreat) return;

      const textKey = `play-bot|${move.before}|${toUci(move)}`;
      ask(
        textKey,
        buildBotMoveMessages({
          fenBefore: move.before,
          fenAfter: move.after,
          san: move.san,
          evalAfter: after,
          threatFen: hasThreat ? nullFen : undefined,
          threatLine: hasThreat ? threat?.lines[0]?.pv : undefined,
        })
      );

      const id = `bot-${ply}-${move.after}`;
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== id),
        {
          id,
          kind: "bot",
          ply,
          title: hasThreat
            ? `Watch out after ${moveLabel(move.before, move.san)}`
            : `Bot played ${moveLabel(move.before, move.san)}`,
          textKey,
        },
      ]);
    },
    [getEval, setMessages] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // React to moves, undos and new games
  useEffect(() => {
    setHintArrows([]);
    if (!enabled || !engine) return;

    const history = game.history({ verbose: true });
    const sans = history.map((m) => m.san);
    const processed = processedRef.current;

    let common = 0;
    while (
      common < processed.length &&
      common < sans.length &&
      processed[common] === sans[common]
    ) {
      common++;
    }

    if (common < processed.length || sans.length === 0) {
      setMessages((prev) =>
        prev.filter((m) => m.ply <= common && sans.length > 0)
      );
    }
    processedRef.current = sans;

    history.slice(common).forEach((move, i) => {
      const ply = common + i + 1;
      // Only comment on the latest couple of moves (e.g. not a whole loaded game)
      if (ply < sans.length - 1) return;
      const lineSans = sans.slice(0, ply);
      if (move.color === settingsRef.current.playerColor) {
        handlePlayerMove(move, ply, lineSans);
      } else {
        handleBotMove(move, ply, lineSans);
      }
    });

    // Pre-compute the evaluation of the player's position for hints and
    // to classify their next move faster.
    if (isGameInProgress && game.turn() === playerColor && !game.isGameOver()) {
      getEval(game.fen()).catch(() => undefined);
    }
  }, [game, engine, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentPly = game.history().length;
  const currentHintLevel = hintLevel.ply === currentPly ? hintLevel.level : 0;
  const canHint =
    enabled &&
    !!engine &&
    isGameInProgress &&
    game.turn() === playerColor &&
    !game.isGameOver() &&
    currentHintLevel < 3;

  const requestHint = useCallback(async () => {
    const fen = game.fen();
    const ply = game.history().length;
    const level = Math.min(
      3,
      (hintLevel.ply === ply ? hintLevel.level : 0) + 1
    );
    setHintLevel({ ply, level });

    const { hasKey, ask } = llmRef.current;
    const id = `hint-${ply}-${level}`;
    setMessages((prev) => [
      ...prev,
      {
        id,
        kind: "hint",
        ply,
        title: level === 3 ? "Best move" : `Hint ${level}`,
      },
    ]);

    let evaluation: PositionEval;
    try {
      evaluation = await getEval(fen);
    } catch {
      updateMessage(id, {
        text: "The engine is still loading, try again in a second.",
      });
      return;
    }
    if (gameRef.current.fen() !== fen) return;

    const bestUci = evaluation.bestMove ?? evaluation.lines[0]?.pv?.[0];
    if (!bestUci) return;
    const from = bestUci.slice(0, 2);
    const to = bestUci.slice(2, 4);
    // Without an API key, skip the AI nudge and go straight to the piece hint.
    const effectiveLevel = hasKey ? level : level + 1;

    if (effectiveLevel >= 3) {
      setHintArrows([[from as Square, to as Square, HINT_ARROW_COLOR]]);
      updateMessage(id, {
        title: "Best move",
        text: `The engine's choice here is ${uciToSan(fen, bestUci)}.`,
      });
      if (!hasKey) setHintLevel({ ply, level: 3 });
      return;
    }

    if (!hasKey) {
      updateMessage(id, {
        text: `Look at your ${pieceOnSquare(fen, from) ?? "piece"} on ${from}.`,
      });
      return;
    }

    const textKey = `hint|${fen}|${level}`;
    ask(
      textKey,
      buildHintMessages({
        fen,
        evalPosition: evaluation,
        level: level as 1 | 2,
      })
    );
    updateMessage(id, { textKey });
  }, [
    game,
    hintLevel,
    getEval,
    setHintLevel,
    setMessages,
    updateMessage,
    setHintArrows,
  ]);

  const takeback = useCallback(
    (message: CoachMessage) => {
      const current = gameRef.current;
      if (message.ply < 1 || current.history().length < message.ply) return;
      goToMove(message.ply - 1, current);
    },
    [goToMove]
  );

  return {
    engineReady: !!engine,
    canHint,
    hintLevel: currentHintLevel,
    requestHint,
    takeback,
  };
};
