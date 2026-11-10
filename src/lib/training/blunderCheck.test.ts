import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { TrainingLogEntry } from "@/types/training";
import {
  BlunderCheckLogData,
  gradeBlunderCheckAnswer,
  isSharpPosition,
  shouldBlunderCheck,
  summarizeBlunderChecks,
} from "./blunderCheck";
import { DAY_MS } from "./schedule";

const after = (fen: string, san: string) => new Chess(fen).move(san).after;

/** A quiet middlegame position: no captures or checks available */
const QUIET =
  "r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 9";

describe("isSharpPosition", () => {
  it("is sharp when the opponent has a check or a fair capture after your move", () => {
    // After 9. a3 Black's only capture, Nxd4, gives a knight for a pawn
    expect(isSharpPosition(QUIET, after(QUIET, "a3"))).toBe(false);
    // After 9. Bxh7+ Black can take back
    expect(isSharpPosition(QUIET, after(QUIET, "Bxh7+"))).toBe(true);
    // After 9. Ne5 Black can trade knights
    expect(isSharpPosition(QUIET, after(QUIET, "Ne5"))).toBe(true);
    // After 9. Qb3 Black still has only losing captures
    expect(isSharpPosition(QUIET, after(QUIET, "Qb3"))).toBe(false);
  });

  it("counts a capture of an undefended piece", () => {
    // After 3. Nh4 the knight is attacked by the queen and undefended
    const fen =
      "rnb1kbnr/pppp1ppp/8/4p1q1/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3";
    expect(isSharpPosition(fen, after(fen, "Nh4"))).toBe(true);
    // After 3. a3 the queen takes on d2 with check
    expect(isSharpPosition(fen, after(fen, "a3"))).toBe(true);
  });

  it("is sharp when you're in check", () => {
    const check = "4k3/8/8/8/8/8/4q3/4K3 w - - 0 1";
    expect(isSharpPosition(check, after(check, "Kxe2"))).toBe(true);
  });
});

describe("shouldBlunderCheck", () => {
  const never = () => 0.99;
  const always = () => 0;

  it("follows the mode", () => {
    const fenAfter = after(QUIET, "a3");
    const base = { fenBefore: QUIET, fenAfter };
    expect(shouldBlunderCheck({ ...base, mode: "off" })).toBe(false);
    expect(shouldBlunderCheck({ ...base, mode: "every", random: never })).toBe(
      true
    );
    // Quiet: only a random share in Smart mode
    expect(shouldBlunderCheck({ ...base, mode: "smart", random: never })).toBe(
      false
    );
    expect(shouldBlunderCheck({ ...base, mode: "smart", random: always })).toBe(
      true
    );
    // Sharp: always in Smart mode
    expect(
      shouldBlunderCheck({
        fenBefore: QUIET,
        fenAfter: after(QUIET, "Bxh7+"),
        mode: "smart",
        random: never,
      })
    ).toBe(true);
  });

  it("skips opening theory, forced moves and moves that end the game", () => {
    const start = new Chess().fen();
    expect(
      shouldBlunderCheck({
        mode: "every",
        fenBefore: start,
        fenAfter: after(start, "e4"),
      })
    ).toBe(false);

    const forced = "4k3/8/8/8/8/8/3q4/K7 w - - 0 1";
    expect(
      shouldBlunderCheck({
        mode: "every",
        fenBefore: forced,
        fenAfter: after(forced, "Kb1"),
      })
    ).toBe(false);

    const mateInOne = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
    expect(
      shouldBlunderCheck({
        mode: "every",
        fenBefore: mateInOne,
        fenAfter: after(mateInOne, "Ra8#"),
      })
    ).toBe(false);
  });
});

describe("gradeBlunderCheckAnswer", () => {
  const lines = [
    { uci: "e5d4", win: 70 },
    { uci: "f6e4", win: 67 },
    { uci: "c6b4", win: 50 },
  ];

  it("grades the reply you found", () => {
    expect(gradeBlunderCheckAnswer("e5d4", lines)).toBe("correct");
    // Within 5% of the best reply
    expect(gradeBlunderCheckAnswer("f6e4", lines)).toBe("correct");
    expect(gradeBlunderCheckAnswer("c6b4", lines)).toBe("partial");
    expect(gradeBlunderCheckAnswer("a7a6", lines)).toBe("missed");
    // Not in the top 3 but checked separately, and as good
    expect(gradeBlunderCheckAnswer("a7a6", lines, 68)).toBe("correct");
    expect(gradeBlunderCheckAnswer("a7a6", [])).toBe("missed");
  });
});

describe("summarizeBlunderChecks", () => {
  const entry = (
    at: number,
    data: Partial<BlunderCheckLogData>
  ): TrainingLogEntry => ({
    kind: "blunder-check",
    at,
    success: data.grade === "correct",
    data: {
      grade: "correct",
      fen: "",
      candidateUci: "",
      answerUci: "",
      bestReplyUci: "",
      candidateLoss: 0,
      candidateWasBad: false,
      changedMove: false,
      ...data,
    },
  });

  it("counts answers and the moves you saved", () => {
    const now = 100 * DAY_MS;
    const summary = summarizeBlunderChecks(
      [
        entry(now, {}),
        entry(now, { grade: "partial" }),
        entry(now, { grade: "missed", candidateWasBad: true }),
        entry(now - DAY_MS, { candidateWasBad: true, changedMove: true }),
        entry(now - 10 * DAY_MS, { candidateWasBad: true, changedMove: true }),
        { kind: "puzzle", at: now, success: true },
      ],
      now
    );
    expect(summary).toEqual({
      checks: 5,
      correct: 3,
      partial: 1,
      missed: 1,
      foundRate: 60,
      badCandidates: 3,
      saved: 2,
      savedThisWeek: 1,
      badKept: 1,
    });
  });
});
