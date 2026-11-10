import { Color, MoveClassification } from "@/types/enums";
import {
  GameDigest,
  GamePhase,
  MoveDigest,
  Puzzle,
  PuzzleTheme,
  TrainingLogEntry,
} from "@/types/training";
import { BlunderCheckSummary, summarizeBlunderChecks } from "./blunderCheck";
import { getPuzzleId } from "./puzzles";
import { INSIGHT_THRESHOLDS } from "./thresholds";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-move stats for a set of your moves */
export interface MoveStats {
  moves: number;
  games: number;
  blunders: number;
  mistakes: number;
  hungPieces: number;
  /** Average win chance lost per move, 0–100 */
  avgLoss: number;
  /** Average per-move accuracy (lichess formula), 0–100 */
  accuracy: number;
  blundersPer100: number;
  hungPerGame: number;
}

/** Per-game stats for a set of your games */
export interface GameStats {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Points per game as a percentage: win 1, draw ½ */
  score: number;
  /** Average game accuracy, or undefined if no game has one */
  accuracy?: number;
}

export interface PhaseInsight extends MoveStats {
  phase: GamePhase;
}

export interface MoveBucketInsight extends MoveStats {
  key: string;
  label: string;
  from: number;
  to?: number;
}

export interface OpeningInsight extends GameStats {
  family: string;
  color: Color;
}

export interface SegmentInsight extends GameStats {
  key: string;
  moves: number;
  blundersPer100: number;
}

export interface ClockInsight extends MoveStats {
  key: "low" | "short" | "comfortable";
  label: string;
}

export interface ConversionInsight extends GameStats {
  /** Win chance that counts as a winning position */
  threshold: number;
}

export interface ThemeInsight {
  theme: PuzzleTheme;
  puzzles: number;
  /** Share of all your puzzles, 0–1 */
  share: number;
  attempts: number;
  solved: number;
  /** Solved attempts as a percentage, if attempted */
  solveRate?: number;
}

/** One position behind a finding, for "see the positions" */
export interface InsightEvidence {
  gameId: number;
  ply: number;
  moveNumber: number;
  color: Color;
  san: string;
  /** Win chance lost by the move */
  loss: number;
  openingName?: string;
  endTime?: number;
}

export type FindingSeverity = "high" | "medium" | "low";

export interface Finding {
  id: string;
  title: string;
  detail: string;
  severity: FindingSeverity;
  /** Ranking score: effect size × sample confidence */
  score: number;
  /** The segment's number and your baseline it was compared with */
  metric: number;
  baseline: number;
  unit: "%" | "per100" | "loss" | "share";
  /** Size of the segment (moves or games) */
  sample: number;
  evidence: InsightEvidence[];
  /** Your puzzles from this segment, for "Train these" */
  puzzleIds: string[];
}

export interface Insights {
  games: number;
  moves: number;
  overall: GameStats & MoveStats;
  byPhase: PhaseInsight[];
  byMoveBucket: MoveBucketInsight[];
  byOpening: OpeningInsight[];
  byColor: SegmentInsight[];
  byTimeClass: SegmentInsight[];
  conversion: ConversionInsight;
  /** Empty when your games have no clock comments */
  byClock: ClockInsight[];
  themes: ThemeInsight[];
  /** Overall puzzle solve rate, if you've attempted any */
  puzzleSolveRate?: number;
  /** Blunder checks in play mode */
  blunderChecks: BlunderCheckSummary;
  findings: Finding[];
}

export interface InsightsInput {
  digests: GameDigest[];
  puzzles: Puzzle[];
  /** Training log entries: puzzle attempts and blunder checks are used */
  log?: TrainingLogEntry[];
  /** For "this week" counts */
  now?: number;
}

// ---------------------------------------------------------------------------
// Samples and stats
// ---------------------------------------------------------------------------

/** One of your moves, with the game it's from */
interface MoveSample {
  digest: GameDigest;
  move: MoveDigest;
  loss: number;
  /** Your clock before the move (your previous move's clock), seconds */
  clockBefore?: number;
}

/** Time classes whose clocks don't measure thinking time at the board */
const UNTIMED = ["daily", "correspondence"];

const PHASES: GamePhase[] = ["opening", "middlegame", "endgame"];

export const MOVE_BUCKETS = [
  { key: "1-10", label: "1–10", from: 1, to: 10 },
  { key: "11-20", label: "11–20", from: 11, to: 20 },
  { key: "21-30", label: "21–30", from: 21, to: 30 },
  { key: "31-40", label: "31–40", from: 31, to: 40 },
  { key: "41+", label: "41+", from: 41 },
] as const;

export const THEME_NAMES: Record<string, string> = {
  "hung-piece": "hanging pieces",
  "missed-mate": "missed checkmates",
  "missed-capture": "missed free pieces",
  "missed-punish": "unpunished mistakes",
};

const TACTIC_THEMES = Object.keys(THEME_NAMES) as PuzzleTheme[];

/** Lichess's per-move accuracy from the win chance lost */
const moveAccuracy = (loss: number) =>
  Math.min(
    100,
    Math.max(
      0,
      103.1668100711649 * Math.exp(-0.04354415386753951 * loss) -
        3.166924740191411 +
        1
    )
  );

const round1 = (n: number) => Math.round(n * 10) / 10;

const collectMoves = (digests: GameDigest[]): MoveSample[] =>
  digests.flatMap((digest) => {
    let lastClock: number | undefined;
    const samples: MoveSample[] = [];
    for (const move of digest.moves) {
      if (!move.isMine) continue;
      // A daily game's clock counts days, so it's never "time trouble"
      const clockBefore = UNTIMED.includes(digest.timeClass ?? "")
        ? undefined
        : lastClock;
      lastClock = move.clockAfter ?? lastClock;
      if (move.classification === MoveClassification.Forced) continue;
      samples.push({
        digest,
        move,
        loss: Math.max(0, move.winBefore - move.winAfter),
        clockBefore,
      });
    }
    return samples;
  });

const moveStats = (samples: MoveSample[]): MoveStats => {
  const moves = samples.length;
  const games = new Set(samples.map((s) => s.digest.gameId)).size;
  let blunders = 0;
  let mistakes = 0;
  let hungPieces = 0;
  let loss = 0;
  let accuracy = 0;
  for (const s of samples) {
    if (s.move.classification === MoveClassification.Blunder) blunders++;
    if (s.move.classification === MoveClassification.Mistake) mistakes++;
    if (s.move.hungPiece) hungPieces++;
    loss += s.loss;
    accuracy += moveAccuracy(s.loss);
  }
  return {
    moves,
    games,
    blunders,
    mistakes,
    hungPieces,
    avgLoss: moves ? loss / moves : 0,
    accuracy: moves ? accuracy / moves : 0,
    blundersPer100: moves ? (blunders / moves) * 100 : 0,
    hungPerGame: games ? hungPieces / games : 0,
  };
};

const gameStats = (digests: GameDigest[]): GameStats => {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  const accuracies: number[] = [];
  for (const d of digests) {
    if (d.result === "win") wins++;
    else if (d.result === "draw") draws++;
    else if (d.result === "loss") losses++;
    if (d.accuracy !== undefined) accuracies.push(d.accuracy);
  }
  const decided = wins + draws + losses;
  return {
    games: digests.length,
    wins,
    draws,
    losses,
    score: decided ? ((wins + draws / 2) / decided) * 100 : 0,
    accuracy: accuracies.length
      ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length
      : undefined,
  };
};

const FAMILY_ENDINGS = [
  "Defense",
  "Defence",
  "Opening",
  "Game",
  "Gambit",
  "Attack",
  "System",
];

/**
 * "Sicilian Defense Old Sicilian" → "Sicilian Defense",
 * "Ruy Lopez: Berlin Defense" → "Ruy Lopez"
 */
export const getOpeningFamily = (name: string | undefined): string => {
  const base = name?.split(":")[0].trim();
  if (!base) return "Unknown opening";
  const words = base.split(/\s+/);
  const end = words.findIndex((word) => FAMILY_ENDINGS.includes(word));
  return end === -1
    ? words.slice(0, 3).join(" ")
    : words.slice(0, end + 1).join(" ");
};

const toEvidence = (s: MoveSample): InsightEvidence => ({
  gameId: s.digest.gameId,
  ply: s.move.ply,
  moveNumber: s.move.moveNumber,
  color: s.move.color,
  san: s.move.san,
  loss: round1(s.loss),
  openingName: s.digest.openingName,
  endTime: s.digest.endTime,
});

/** The worst positions in `samples`, biggest loss first */
const worstMoves = (samples: MoveSample[], minLoss = 1) =>
  [...samples]
    .filter((s) => s.loss >= minLoss)
    .sort((a, b) => b.loss - a.loss)
    .slice(0, INSIGHT_THRESHOLDS.evidence)
    .map(toEvidence);

const puzzleIdsFor = (samples: MoveSample[], puzzleIds: Set<string>) =>
  samples
    .map((s) => getPuzzleId(s.digest.gameId, s.move.ply))
    .filter((id) => puzzleIds.has(id));

/** Effect size × confidence; about 0.5 for a finding that just qualifies */
const rank = (effect: number, sample: number, minSample: number) => {
  const confidence = sample / (sample + minSample);
  return effect * confidence * 2;
};

const severityOf = (score: number): FindingSeverity =>
  score >= 1 ? "high" : score >= 0.6 ? "medium" : "low";

const finding = (
  f: Omit<Finding, "severity" | "metric" | "baseline"> & {
    metric: number;
    baseline: number;
  }
): Finding => ({
  ...f,
  metric: round1(f.metric),
  baseline: round1(f.baseline),
  score: round1(f.score * 100) / 100,
  severity: severityOf(f.score),
});

const colorLabel = (color: Color) =>
  color === Color.White ? "White" : "Black";
const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const pct = (n: number) => `${Math.round(n)}%`;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface RuleContext {
  samples: MoveSample[];
  digests: GameDigest[];
  puzzles: Puzzle[];
  puzzleIds: Set<string>;
  insights: Omit<Insights, "findings">;
}

const T = INSIGHT_THRESHOLDS;
const ratioEffect = (ratio: number) => ((ratio - 1) / (T.ratio - 1)) * 0.5;

/** Blunders per 100 moves in a phase ≥ 1.5× the rest of your moves */
const phaseBlunders = ({ samples, puzzleIds }: RuleContext): Finding[] =>
  PHASES.flatMap((phase) => {
    const inPhase = samples.filter((s) => s.move.phase === phase);
    const rest = moveStats(samples.filter((s) => s.move.phase !== phase));
    const stats = moveStats(inPhase);
    if (
      stats.moves < T.minMoves ||
      rest.moves < T.minMoves ||
      stats.blunders < T.minBlunders
    ) {
      return [];
    }
    const ratio = rest.blundersPer100
      ? stats.blundersPer100 / rest.blundersPer100
      : T.ratio * 2;
    if (ratio < T.ratio) return [];

    const hung = stats.hungPieces
      ? ` ${stats.hungPieces} of your moves there left a piece hanging.`
      : "";
    return [
      finding({
        id: `phaseBlunders:${phase}`,
        title: `You blunder most in the ${phase}`,
        detail: `${fmt(stats.blundersPer100)} blunders per 100 moves in the ${phase}, against ${fmt(rest.blundersPer100)} in the rest of your games.${hung}`,
        score: rank(ratioEffect(ratio), stats.moves, T.minMoves),
        metric: stats.blundersPer100,
        baseline: rest.blundersPer100,
        unit: "per100",
        sample: stats.moves,
        evidence: worstMoves(
          inPhase.filter(
            (s) => s.move.classification === MoveClassification.Blunder
          )
        ),
        puzzleIds: puzzleIdsFor(inPhase, puzzleIds),
      }),
    ];
  });

/** Win chance lost per move after move 30 ≥ 1.5× moves 11–30 */
const lateGameDrop = ({ samples, puzzleIds }: RuleContext): Finding[] => {
  const late = samples.filter((s) => s.move.moveNumber >= 31);
  const middle = samples.filter(
    (s) => s.move.moveNumber >= 11 && s.move.moveNumber <= 30
  );
  const lateStats = moveStats(late);
  const midStats = moveStats(middle);
  if (lateStats.moves < T.minMoves || midStats.moves < T.minMoves) return [];
  if (!midStats.avgLoss) return [];
  const ratio = lateStats.avgLoss / midStats.avgLoss;
  if (ratio < T.ratio) return [];

  return [
    finding({
      id: "lateGameDrop",
      title: "Your play gets worse after move 30",
      detail: `After move 30 you lose ${fmt(lateStats.avgLoss)} points of win chance per move, against ${fmt(midStats.avgLoss)} in moves 11–30. Accuracy: ${pct(lateStats.accuracy)} against ${pct(midStats.accuracy)}.`,
      score: rank(ratioEffect(ratio), lateStats.moves, T.minMoves),
      metric: lateStats.avgLoss,
      baseline: midStats.avgLoss,
      unit: "loss",
      sample: lateStats.moves,
      evidence: worstMoves(late, 10),
      puzzleIds: puzzleIdsFor(late, puzzleIds),
    }),
  ];
};

/** Score in an opening family (one colour) ≤ your overall score − 15 */
const openingScore = ({
  samples,
  puzzleIds,
  insights,
}: RuleContext): Finding[] =>
  insights.byOpening.flatMap((opening) => {
    if (opening.games < T.minOpeningGames) return [];
    const baseline = insights.overall.score;
    const gap = baseline - opening.score;
    if (gap < T.openingScoreGap) return [];

    const inOpening = samples.filter(
      (s) =>
        s.digest.myColor === opening.color &&
        getOpeningFamily(s.digest.openingName) === opening.family
    );
    // The early moves of the games you didn't win
    const early = inOpening.filter((s) => s.move.moveNumber <= 20);
    const accuracy =
      opening.accuracy !== undefined
        ? ` Your accuracy in these games: ${pct(opening.accuracy)}.`
        : "";
    return [
      finding({
        id: `openingScore:${opening.color}:${opening.family}`,
        title: `You struggle in the ${opening.family} as ${colorLabel(opening.color)}`,
        detail: `You score ${pct(opening.score)} in ${opening.games} games (${opening.wins} won, ${opening.draws} drawn, ${opening.losses} lost), against ${pct(baseline)} overall.${accuracy}`,
        score: rank(
          (gap / T.openingScoreGap) * 0.5,
          opening.games,
          T.minOpeningGames
        ),
        metric: opening.score,
        baseline,
        unit: "%",
        sample: opening.games,
        evidence: worstMoves(
          early.filter((s) => s.digest.result !== "win"),
          5
        ),
        puzzleIds: puzzleIdsFor(early, puzzleIds),
      }),
    ];
  });

/** Game accuracy in a colour or time class ≤ the rest of your games − 5 */
const segmentAccuracy = ({
  samples,
  digests,
  puzzleIds,
  insights,
}: RuleContext): Finding[] => {
  const segments = [
    ...insights.byColor.map((s) => ({
      ...s,
      matches: (d: GameDigest) => d.myColor === s.key,
      title: `You play worse as ${colorLabel(s.key as Color)}`,
      name: `as ${colorLabel(s.key as Color)}`,
    })),
    ...insights.byTimeClass.map((s) => ({
      ...s,
      matches: (d: GameDigest) => d.timeClass === s.key,
      title: `Your accuracy drops in ${s.key}`,
      name: `in ${s.key}`,
    })),
  ];

  return segments.flatMap((segment) => {
    const rest = gameStats(digests.filter((d) => !segment.matches(d)));
    if (
      segment.games < T.minGames ||
      rest.games < T.minGames ||
      segment.accuracy === undefined ||
      rest.accuracy === undefined
    ) {
      return [];
    }
    const gap = rest.accuracy - segment.accuracy;
    if (gap < T.accuracyGap) return [];

    const inSegment = samples.filter((s) => segment.matches(s.digest));
    return [
      finding({
        id: `segmentAccuracy:${segment.key}`,
        title: segment.title,
        detail: `Your accuracy ${segment.name} is ${pct(segment.accuracy)} over ${segment.games} games, against ${pct(rest.accuracy)} in your other games. You score ${pct(segment.score)} against ${pct(rest.score)}.`,
        score: rank((gap / T.accuracyGap) * 0.5, segment.games, T.minGames),
        metric: segment.accuracy,
        baseline: rest.accuracy,
        unit: "%",
        sample: segment.games,
        evidence: worstMoves(inSegment, 10),
        puzzleIds: puzzleIdsFor(inSegment, puzzleIds),
      }),
    ];
  });
};

/** First ply of yours where your win chance reached the winning threshold */
const reachedWinningAt = (digest: GameDigest): number | undefined =>
  digest.moves.find((m) => m.isMine && m.winAfter >= T.winningPosition)?.ply;

/** Score from winning positions ≤ 85 − 15 */
const conversion = ({
  samples,
  digests,
  puzzleIds,
  insights,
}: RuleContext): Finding[] => {
  const { conversion: stats } = insights;
  if (stats.games < T.minWinningGames) return [];
  const expected = T.conversionExpected;
  const gap = expected - stats.score;
  if (gap < T.conversionGap) return [];

  const thrown = new Map(
    digests
      .filter((d) => d.result !== "win")
      .map((d): [number, number | undefined] => [d.gameId, reachedWinningAt(d)])
      .filter((entry): entry is [number, number] => entry[1] !== undefined)
  );
  // Your moves after reaching the winning position, in games you didn't win
  const afterWinning = samples.filter((s) => {
    const at = thrown.get(s.digest.gameId);
    return at !== undefined && s.move.ply > at;
  });
  // The biggest slip of each game
  const worstPerGame = [...thrown.keys()].flatMap((gameId) => {
    const worst = afterWinning
      .filter((s) => s.digest.gameId === gameId)
      .sort((a, b) => b.loss - a.loss)[0];
    return worst ? [worst] : [];
  });

  return [
    finding({
      id: "conversion",
      title: "You let winning positions slip",
      detail: `You reached a winning position (${T.winningPosition}%+ win chance) in ${stats.games} games but won only ${stats.wins} of them: ${stats.draws} drawn, ${stats.losses} lost.`,
      score: rank(
        (gap / T.conversionGap) * 0.5,
        stats.games,
        T.minWinningGames
      ),
      metric: stats.score,
      baseline: expected,
      unit: "%",
      sample: stats.games,
      evidence: worstMoves(worstPerGame, 5),
      puzzleIds: puzzleIdsFor(afterWinning, puzzleIds),
    }),
  ];
};

/** Blunder rate under 30 s (or 60 s) ≥ 1.5× the rate with 60 s or more */
const timeTrouble = ({ samples, puzzleIds }: RuleContext): Finding[] => {
  const comfortable = moveStats(
    samples.filter(
      (s) => s.clockBefore !== undefined && s.clockBefore >= T.comfortableClock
    )
  );
  if (comfortable.moves < T.minMoves) return [];

  for (const limit of [T.lowClock, T.comfortableClock]) {
    const low = samples.filter(
      (s) => s.clockBefore !== undefined && s.clockBefore < limit
    );
    const stats = moveStats(low);
    if (stats.moves < T.minLowClockMoves || stats.blunders < T.minBlunders) {
      continue;
    }
    const ratio = comfortable.blundersPer100
      ? stats.blundersPer100 / comfortable.blundersPer100
      : T.ratio * 2;
    if (ratio < T.ratio) continue;

    return [
      finding({
        id: "timeTrouble",
        title: "You blunder when you're short of time",
        detail: `With less than ${limit} seconds on your clock you blunder ${fmt(stats.blundersPer100)} times per 100 moves, against ${fmt(comfortable.blundersPer100)} with a minute or more.`,
        score: rank(ratioEffect(ratio), stats.moves, T.minLowClockMoves),
        metric: stats.blundersPer100,
        baseline: comfortable.blundersPer100,
        unit: "per100",
        sample: stats.moves,
        evidence: worstMoves(
          low.filter(
            (s) => s.move.classification === MoveClassification.Blunder
          )
        ),
        puzzleIds: puzzleIdsFor(low, puzzleIds),
      }),
    ];
  }
  return [];
};

const THEME_TITLES: Record<string, string> = {
  "hung-piece": "You often leave pieces hanging",
  "missed-mate": "You miss checkmates",
  "missed-capture": "You miss free pieces",
  "missed-punish": "You don't punish your opponent's mistakes",
};

const puzzleEvidence = (
  puzzles: Puzzle[],
  digests: Map<number, GameDigest>
): InsightEvidence[] =>
  [...puzzles]
    .sort((a, b) => b.winBefore - b.winAfter - (a.winBefore - a.winAfter))
    .flatMap((p) => {
      const digest = digests.get(p.gameId);
      const move = digest?.moves[p.ply];
      if (!digest || !move) return [];
      return [
        toEvidence({
          digest,
          move,
          loss: Math.max(0, move.winBefore - move.winAfter),
        }),
      ];
    })
    .slice(0, T.evidence);

/** Your most common puzzle theme, and themes you solve much less often */
const themes = ({ digests, puzzles, insights }: RuleContext): Finding[] => {
  const byId = new Map(digests.map((d) => [d.gameId, d]));
  const results: Finding[] = [];

  const top = insights.themes
    .filter((t) => t.puzzles >= T.minThemePuzzles && t.share >= T.themeShare)
    .sort((a, b) => b.share - a.share)[0];
  if (top) {
    const themed = puzzles.filter((p) => p.themes.includes(top.theme));
    results.push(
      finding({
        id: `theme:${top.theme}`,
        title: THEME_TITLES[top.theme],
        detail: `${top.puzzles} of your ${puzzles.length} puzzles come from ${THEME_NAMES[top.theme]}: it's the mistake you make most.`,
        score: rank(
          (top.share / T.themeShare) * 0.5,
          top.puzzles,
          T.minThemePuzzles
        ),
        metric: top.share * 100,
        baseline: T.themeShare * 100,
        unit: "share",
        sample: top.puzzles,
        evidence: puzzleEvidence(themed, byId),
        puzzleIds: themed.map((p) => p.id),
      })
    );
  }

  const overallRate = insights.puzzleSolveRate;
  if (overallRate !== undefined) {
    for (const theme of insights.themes) {
      if (
        theme.solveRate === undefined ||
        theme.attempts < T.minThemeAttempts
      ) {
        continue;
      }
      const gap = overallRate - theme.solveRate;
      if (gap < T.themeSolveGap) continue;
      const themed = puzzles.filter((p) => p.themes.includes(theme.theme));
      results.push(
        finding({
          id: `themeSolve:${theme.theme}`,
          title: `Puzzles with ${THEME_NAMES[theme.theme]} are your hardest`,
          detail: `You solve ${pct(theme.solveRate)} of them (${theme.solved} of ${theme.attempts} tries), against ${pct(overallRate)} of all your puzzles.`,
          score: rank(
            (gap / T.themeSolveGap) * 0.5,
            theme.attempts,
            T.minThemeAttempts
          ),
          metric: theme.solveRate,
          baseline: overallRate,
          unit: "%",
          sample: theme.attempts,
          evidence: puzzleEvidence(themed, byId),
          puzzleIds: themed.map((p) => p.id),
        })
      );
    }
  }

  return results;
};

const RULES = [
  phaseBlunders,
  lateGameDrop,
  openingScore,
  segmentAccuracy,
  conversion,
  timeTrouble,
  themes,
];

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const segmentStats = (
  key: string,
  digests: GameDigest[],
  samples: MoveSample[]
): SegmentInsight => {
  const { moves, blundersPer100 } = moveStats(samples);
  return { key, moves, blundersPer100, ...gameStats(digests) };
};

/** The weakness report: stats by segment, and findings ranked by importance */
export const computeInsights = ({
  digests,
  puzzles,
  log = [],
  now = Date.now(),
}: InsightsInput): Insights => {
  const samples = collectMoves(digests);
  const overall = { ...moveStats(samples), ...gameStats(digests) };

  const byPhase = PHASES.map((phase) => ({
    phase,
    ...moveStats(samples.filter((s) => s.move.phase === phase)),
  }));

  const byMoveBucket = MOVE_BUCKETS.map((bucket) => ({
    ...bucket,
    ...moveStats(
      samples.filter(
        (s) =>
          s.move.moveNumber >= bucket.from &&
          ("to" in bucket ? s.move.moveNumber <= bucket.to : true)
      )
    ),
  }));

  const openingGroups = new Map<string, GameDigest[]>();
  for (const d of digests) {
    const key = `${d.myColor}|${getOpeningFamily(d.openingName)}`;
    openingGroups.set(key, [...(openingGroups.get(key) ?? []), d]);
  }
  const byOpening = [...openingGroups.entries()]
    .map(([key, group]) => {
      const [color, family] = key.split("|");
      return { family, color: color as Color, ...gameStats(group) };
    })
    .sort((a, b) => b.games - a.games || a.family.localeCompare(b.family));

  const byColor = [Color.White, Color.Black]
    .map((color) =>
      segmentStats(
        color,
        digests.filter((d) => d.myColor === color),
        samples.filter((s) => s.digest.myColor === color)
      )
    )
    .filter((s) => s.games > 0);

  const timeClasses = [
    ...new Set(digests.flatMap((d) => (d.timeClass ? [d.timeClass] : []))),
  ];
  const byTimeClass = timeClasses
    .map((timeClass) =>
      segmentStats(
        timeClass,
        digests.filter((d) => d.timeClass === timeClass),
        samples.filter((s) => s.digest.timeClass === timeClass)
      )
    )
    .sort((a, b) => b.games - a.games);

  const conversion = {
    threshold: T.winningPosition,
    ...gameStats(digests.filter((d) => reachedWinningAt(d) !== undefined)),
  };

  const timed = samples.filter((s) => s.clockBefore !== undefined);
  const byClock: ClockInsight[] = timed.length
    ? [
        {
          key: "low" as const,
          label: `Under ${T.lowClock}s`,
          ...moveStats(timed.filter((s) => s.clockBefore! < T.lowClock)),
        },
        {
          key: "short" as const,
          label: `${T.lowClock}–${T.comfortableClock}s`,
          ...moveStats(
            timed.filter(
              (s) =>
                s.clockBefore! >= T.lowClock &&
                s.clockBefore! < T.comfortableClock
            )
          ),
        },
        {
          key: "comfortable" as const,
          label: `${T.comfortableClock}s or more`,
          ...moveStats(
            timed.filter((s) => s.clockBefore! >= T.comfortableClock)
          ),
        },
      ]
    : [];

  const attempts = log.filter((entry) => entry.kind === "puzzle");
  const puzzleThemes = new Map(puzzles.map((p) => [p.id, p.themes]));
  const themes = TACTIC_THEMES.map((theme): ThemeInsight => {
    const count = puzzles.filter((p) => p.themes.includes(theme)).length;
    const tries = attempts.filter((entry) => {
      const entryThemes =
        (entry.data?.themes as PuzzleTheme[] | undefined) ??
        (entry.refId ? puzzleThemes.get(entry.refId) : undefined);
      return entryThemes?.includes(theme);
    });
    const solved = tries.filter((entry) => entry.success).length;
    return {
      theme,
      puzzles: count,
      share: puzzles.length ? count / puzzles.length : 0,
      attempts: tries.length,
      solved,
      solveRate: tries.length ? (solved / tries.length) * 100 : undefined,
    };
  }).sort((a, b) => b.puzzles - a.puzzles);

  const insights = {
    games: digests.length,
    moves: samples.length,
    overall,
    byPhase,
    byMoveBucket,
    byOpening,
    byColor,
    byTimeClass,
    conversion,
    byClock,
    themes,
    puzzleSolveRate: attempts.length
      ? (attempts.filter((entry) => entry.success).length / attempts.length) *
        100
      : undefined,
    blunderChecks: summarizeBlunderChecks(log, now),
  };

  const context: RuleContext = {
    samples,
    digests,
    puzzles,
    puzzleIds: new Set(puzzles.map((p) => p.id)),
    insights,
  };
  const findings = RULES.flatMap((rule) => rule(context)).sort(
    (a, b) => b.score - a.score
  );

  return { ...insights, findings };
};

/** Stable key for a set of findings, to cache the coach's read of them */
export const getFindingsKey = (insights: Insights) =>
  [
    insights.games,
    ...insights.findings.map((f) => `${f.id}=${f.metric}/${f.baseline}`),
  ].join("|");
