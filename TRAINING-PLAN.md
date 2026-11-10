# Training features plan

This plan covers five features: **chess.com auto-import**, **puzzles from your mistakes**, a **weakness report**, an **opening trainer** and **blunder-check training**.

The app has no backend, so everything here runs in the browser. Data lives in IndexedDB, Stockfish runs in Web Workers, and the LLM is called through OpenRouter with the user's own key (see `AI-COACH.md`). The coach rule still applies: Stockfish finds the facts, and the LLM only explains them. Every feature must still work without an API key, with plainer text.

---

## 1. What the code does today

These are the gaps the plan has to fill:

| Fact | Where | Consequence |
|---|---|---|
| The app has no notion of "me". Saved games store `white`/`black` names only. | `src/types/game.ts` | Nothing can tell your mistakes from your opponent's. We need a profile. |
| A game is analyzed only when it's opened on the Analysis page, and the eval is saved only if the game came from the DB (`gameFromUrl`). | `analyzeButton.tsx` | Most saved games have no `eval`. We need a background analysis queue. |
| The IndexedDB schema is version 1, with one `games` store, no indexes and no external id. | `useGameDatabase.ts` | We need a v2 migration (new fields, an index and new stores). Without an external id we can't dedupe imports. |
| chess.com loading fetches only the last 1–2 months, for manual picking. | `lib/chessCom.ts` | We need an archive-based incremental sync. |
| A stored `PositionEval` already includes `moveClassification`, `bestMove`, the top lines (multiPv ≥ 2) and `opening`. | `types/eval.ts` | Puzzles, the report and the repertoire can all be derived from stored evals with no re-analysis. |
| `Board` plays the move immediately through `useChessActions.playMove` (drop and click paths). | `components/board/index.tsx` | Blunder-check needs a hook to intercept a move before it's played. |
| The Analysis page has no deep link to a ply (`?gameId=` only). | `pages/index.tsx` | Puzzle and report evidence can't link to a position. We'll add `&ply=`. |
| `[%clk]` parsing already exists. | `components/board/playerHeader.tsx` | We can lift it into `lib/` for time-trouble stats. |
| There's no test runner. | — | Most new logic is pure functions, so adding one is worth it (see 0.4). |

---

## 2. Shared foundation (milestone 0): DONE

> **Status (2026-11-10):** built and tested in the browser. Where it differs from the plan below:
> - The Profile UI is a card at the top of the Train page, not in the coach dialog.
> - `myColor` is recomputed from the usernames on every daemon pass, so no identity key is needed.
> - Pre-v2 games get their fields backfilled by the daemon, not in the migration.
> - The digest has no `winBest` field, since it always equals `winBefore`. `hungPiece` ignores even trades.
> - Not built yet: the "Re-analyze" action on the Database page, and the source and "mine" columns (moved to milestone 1).
> - Pausing while a Play game is in progress is implemented but hasn't been tested in the browser.

Every feature depends on this, so it comes first.

### 0.1 Profile / identity
- Add a `profileAtom` (`atomWithStorage`): `{ chessComUsername?, lichessUsername?, autoSync: boolean, autoAnalyze: boolean }`.
- Add a "Profile" section to settings. It can sit in the existing coach settings dialog or a new one.
- Add a helper `getMyColor(game, profile): Color | undefined` that matches usernames case-insensitively. The result is stored on the game at import time (`myColor`), so it isn't recomputed everywhere.

### 0.2 IndexedDB v2 migration
Bump `openDB("games", 2, { upgrade(db, oldVersion, _, tx) })` and branch on `oldVersion`.

- **`games` store** gets new optional fields: `origin: GameOrigin`, `externalId?: string` (the chess.com game URL), `endTime?: number` (ms), `myColor?: Color`, `timeClass?: string`, `rated?: boolean`, `openingName?: string` (from the chess.com `ECOUrl`, or lichess `Opening`) and `eco?: string`.
  - Index `by-externalId` (unique; skips undefined) for dedupe.
  - Index `by-endTime` for sorting.
- **New stores:**
  - `digests`: the per-game derived data, keyed by `gameId` (see 0.3).
  - `puzzles`: keyed by `"${gameId}:${ply}"`, with an index on `dueAt`.
  - `repertoire`: keyed by `"${color}:${fenKey}"`.
  - `trainingLog`: an append-only log of attempts (puzzle, opening drill, blunder-check), used for stats.
  - `meta`: key/value data such as the sync cursor and schema info.
- Move the DB open into a single shared module, `lib/db.ts`, that returns a typed `IDBPDatabase`. Make `useGameDatabase` and the new hooks use it. Today the hook opens its own connection on each mount.
- Existing v1 games keep working: every new field is optional, and the background job backfills `myColor` and `openingName`.

### 0.3 Background analysis queue and game digest
- Add a `<TrainingDaemon />` mounted in `sections/layout` so it survives page changes. It:
  1. Picks analyzed games with no digest and builds the digest. This is cheap: pure JS, no engine.
  2. If `autoAnalyze` is on, picks unanalyzed games with `myColor` (newest first, capped at, say, the last 100). It runs `UciEngine.evaluateGame` with a batch preset: Stockfish 18 *lite*, depth 12–14, multiPv 3, and about half the recommended workers. Then it saves the eval and builds the digest.
  3. Pauses while `/play` has a game in progress or the Analysis page is evaluating, to avoid fighting over the CPU. The user can also pause or resume it by hand.
- Show progress as a small indicator in the NavBar ("Analyzing 3/27") with a pause button.
- **`GameDigest`** (`lib/training/digest.ts`, pure) is computed once per analyzed game, from the PGN, eval and `myColor`. Puzzles, the report and the repertoire all read it, so nothing re-walks PGNs:
  ```ts
  interface MoveDigest {
    ply: number; moveNumber: number; color: Color; isMine: boolean;
    fenBefore: string; uci: string; san: string;
    classification?: MoveClassification;
    winBefore: number; winAfter: number;      // for the mover, 0–100
    winBest: number; bestUci?: string;
    secondBestGap?: number;                    // best minus 2nd-best win%, puzzle uniqueness
    phase: "opening" | "middlegame" | "endgame"; // facts.getGamePhase
    clockAfter?: number;                       // seconds, from [%clk]
    hungPiece?: string;                        // facts.getHangingPieces after my move, if the reply wins it
    missedMate?: boolean;                      // best line had mate, played move didn't
    opponentErredPrev?: boolean;               // prev opponent move was mistake/blunder ("missed chance")
  }
  interface GameDigest { gameId; version; myColor; accuracy; openingName?; moves: MoveDigest[]; leftRepertoireAtPly?: number }
  ```
  Store a `version` so a change to digest logic re-derives digests without re-running the engine.

### 0.4 Test runner (recommended)
Add `vitest` as a dev dependency with an `npm test` script, covering `src/lib/training/**`. It tests the digest, puzzle extraction, scheduling, report rules and the repertoire tree builder. These are pure, fiddly and easy to break, and they're the core of the feature set. Add a single-file command to `CLAUDE.md`: `npx vitest run src/lib/training/puzzles.test.ts`.

### 0.5 Deep links and navigation
- Support `?gameId=X&ply=N` on the Analysis page: after the game loads, call `goToMove(N)`.
- Add a **Train** page (`src/pages/train.tsx`) with tabs: Puzzles / Openings / Insights (`?tab=`).
- Add it to `NavMenu` and to `pagePaths` in `cdk/app.ts`. One hub keeps the nav and CDK list short.

---

## 3. Chess.com auto-import (milestone 1): DONE

> **Status (2026-11-10):** built and tested in the browser against the live chess.com API. Where it differs from the plan below:
> - The first-sync range is a "Games to import" setting on the Train page (last 1 / 3 / 6 / 12 months / all, default 3), not a one-time prompt. Raising it later imports the older months on the next sync.
> - The cursor records each archive fetched after its month ended (`completeArchives`); those are never refetched. The current month is refetched on every sync.
> - Games are saved straight from the archive JSON and PGN headers, without parsing the moves with chess.js. That keeps big imports fast. A PGN the engine can't read is skipped by the background analysis.
> - The sync runs from `useChessComSync`, called inside `TrainingDaemon`. Status lives in `chessComSyncStatusAtom`, and "Sync now" buttons bump `chessComSyncRequestAtom`.
> - chess960 isn't imported; there's no flag for it.
> - "Re-analyze" on the Database page queues the game in `analysisPriorityAtom`. The daemon analyzes those games first, even past the "games to analyze" limit, and replaces an existing eval. The queue lives in memory only.
> - The Database page also gained pagination. It was hidden before, and the free DataGrid shows at most 100 rows per page.
> - Ratings from `/stats` are stored in `meta` (`chessComRatings`) and shown as chips on the Train page. They aren't used for bot Elo or coach level yet.

**Module:** `lib/sync/chessComSync.ts` (pure fetch and transform), plus a `useChessComSync` hook used by `TrainingDaemon`.

1. `GET https://api.chess.com/pub/player/{user}/games/archives` returns the monthly archive URLs.
2. Read the sync cursor from `meta`: `{ username, lastArchive, lastEndTime }`.
   - **First sync:** ask how far back to go (1 / 3 / 6 / 12 months / all) and import oldest → newest.
   - **Incremental:** refetch only the cursor's month and any newer ones.
3. For each game: skip it if `rules !== "chess"` (allow `chess960` behind a flag), if it has no `pgn`, or if its `url` already exists (`by-externalId`). Map it to `Game`: `externalId = url`, `endTime`, `timeClass`, `rated`, `openingName` (from the `ECOUrl` slug), `myColor`, and both players' ratings.
4. Fetch serially. chess.com allows unlimited serial requests but returns 429 on parallel bursts. On 429, back off exponentially (the same pattern as the recent lichess 429 fix).
5. Also fetch `/pub/player/{user}/stats` for current ratings by time class. The ratings go in `meta`, for the hub header and to pick sensible bot Elo and coach level.
6. **When it runs:** on app load if the last sync was more than 1 h ago, every 30 min while a tab is open, and from a "Sync now" button on the Database page and the Train hub. True background sync with the app closed would need a server or Periodic Background Sync (installed Chromium PWAs only), so that's out of scope.
7. New games flow into the analysis queue (0.3), then into the digest, puzzles, report and repertoire. That's what keeps everything "up to date".
8. **Database page:** add a source column, a "mine" filter, and a "Re-analyze" action.

> **DEFERRED: lichess auto-import isn't done yet; come back to it later.** It has the same shape as the chess.com sync: `GET https://lichess.org/api/games/user/{u}?since=<ms>&pgnInJson=true&clocks=true&opening=true` with `Accept: application/x-ndjson`, deduped on `externalId = https://lichess.org/{id}`. Milestone 0 already stores `profile.lichessUsername` and the `origin`/`externalId` fields for it, so it should be about half a day of work once chess.com sync is in.

---

## 4. Puzzles from your mistakes (milestone 2): DONE

> **Status (2026-11-10):** built and tested in the browser on real chess.com games. Where it differs from the plan below:
> - Extraction reads only the digest. The digest gained `altUci` (other stored engine moves within 3% of the best one; `DIGEST_VERSION` 3), which becomes the puzzle's `acceptUci`.
> - `kind` is "blunder" when your move left you under 45% win chance, otherwise "missed-chance". `missed-punish` is a theme rather than a kind.
> - Puzzles are regenerated inside the daemon whenever a game's digest changes, in the same transaction as the digest. Bumping `PUZZLE_VERSION` regenerates every game's puzzles. A regenerated puzzle keeps its box and history; one that no longer qualifies is deleted.
> - Thresholds live in `TRAINING_THRESHOLDS` (`lib/training/thresholds.ts`).
> - Grading: a move in `acceptUci` is correct at once. Any other move is checked live at depth 16 and accepted if your win chance stays within 3% of the stored best.
> - Hints escalate per wrong try or "Hint" press: 1 = nudge (LLM `buildPuzzleCoachMessages` level 1, or a static theme hint), 2 = the piece to move is outlined, 3 = the answer is shown (counts as failed). "Show solution" jumps straight to 3.
> - The queue skips a new puzzle whose position is already queued (the same mistake in another game). "Keep going" ignores the daily cap of 10 new puzzles.
> - Not built: multi-move puzzles (optional v2).

### Extraction (`lib/training/puzzles.ts`, pure, runs on each new digest)
A move `m` with `isMine` becomes a puzzle at `fenBefore` when all of these hold:
- `winBest - winAfter >= 15`. This covers both blunders and **missed chances**. A missed chance is tagged when `winBefore` was already fine but a much better move existed, or when `opponentErredPrev` is true and you didn't punish it.
- **Uniqueness:** `secondBestGap >= 8`, or the best line has mate. Otherwise many moves are fine, and it makes a poor puzzle.
- **Not hopeless:** `winBefore >= 10`. This skips already-lost positions unless the best move saves the game.
- It isn't a book move or a forced move.

Themes are computed from digest facts: `hung-piece`, `missed-mate`, `missed-capture` (best move is a capture of an undefended piece), `missed-punish` (`opponentErredPrev`), plus the phase. The report reuses these themes.

```ts
interface Puzzle {
  id: string; gameId: number; ply: number; fen: string; myColor: Color;
  bestUci: string; acceptUci: string[];      // stored lines within 3% of best
  playedUci: string; kind: "blunder" | "missed-chance"; themes: string[];
  box: number; dueAt: number; createdAt: number;
}
```

### Solving UI (Train → Puzzles)
- Reuse `Board` with a puzzle-local `gameAtom`, and show the prompt "Find the move you missed".
- **Grading:** the attempt is correct if it's in `acceptUci`. Otherwise, evaluate it live with `engine.analysePosition` (depth 16), and accept any move within 3% of best. Alternative solutions count, like lichess's "this also works".
- **Wrong answer:** show the engine's refutation of your attempt (its PV). The coach nudge then escalates by level:
  1. An LLM nudge with no move named ("look at the undefended piece on…"). This reuses the `buildHintMessages` style with a new `buildPuzzleNudgeMessages` (facts: what refutes your try, hanging pieces, themes).
  2. Highlight the piece to move.
  3. Show the answer arrow and an LLM explanation.
  - **Without a key:** a static theme hint, then the piece, then the arrow.
- **After solving:** show "In the game you played X" with a link to `/?gameId=&ply=`.
- **Optional v2:** multi-move puzzles that continue while the best line stays "only-move".

### Spaced repetition (`lib/training/schedule.ts`, pure)
Use Leitner boxes with intervals `[0, 1, 3, 7, 14, 30, 60]` days.
- **Solved first try, no hints:** move up one box.
- **Solved with hints:** stay in the same box and come back in 1 day.
- **Failed:** drop to box 1 and come back in **3 days** ("comes back after a few days").

The queue order is due puzzles (oldest due first), then new puzzles (newest game first), with a daily new-puzzle cap (default 10). Every attempt is logged to `trainingLog`.

---

## 5. Weakness report (milestone 3)

### Stats (`lib/training/insights.ts`, pure, over all digests where `myColor` is set)
Each stat is split by segment:
- **Phase** (opening / middlegame / endgame): accuracy, blunders per 100 moves, hung pieces per game.
- **Move-number buckets** (1–10, 11–20, 21–30, 31–40, 41+): average win% loss per move. This finding is the "accuracy drops after move 30" kind.
- **Opening** (`openingName`, grouped to family level like "Sicilian Defense") × colour: score %, accuracy, games.
- **Colour, time class, and result after reaching a winning position** (conversion rate: how often a win% ≥ 80 position actually became a win).
- **Clock** (when `[%clk]` is present): blunder rate with less than 30 s / 60 s left versus more.
- **Themes from puzzles:** what you miss most often (`hung-piece`, `missed-punish`, …), and the puzzle solve rate per theme.
- **Blunder-check results** (§7): how often you spot the opponent's best reply.

### Findings
Each rule compares a segment to your own baseline, with a minimum sample (for example ≥ 8 games or ≥ 40 moves in the segment). The rule emits `{ id, title, detail, severity, metric, baseline, evidence: {gameId, ply}[] }` and findings are ranked by effect size × sample confidence. Example rules:
- `phaseBlunders`: blunders per 100 moves in a phase ≥ 1.5× the overall rate → "You hang pieces most in the middlegame".
- `lateGameDrop`: win% loss per move for move 31+ ≥ 1.5× moves 11–30 → "Your accuracy drops sharply after move 30".
- `openingScore`: score in an opening family ≤ baseline − 15 pts, with ≥ 6 games → "You struggle against the Sicilian".
- `conversion`, `timeTrouble`, `theme` rules work the same way.

The evidence for each finding is its worst 5–10 positions. They link to `/?gameId=&ply=`, plus "Train these" (a puzzle set filtered to that finding).

### UI (Train → Insights)
- Finding cards with an evidence list, plus Recharts charts (accuracy by move bucket and by phase, score by opening) using the `dataviz` skill palette.
- **Optional "Coach's read":** one LLM call with only the computed findings and numbers as facts (`buildWeaknessReportMessages`). It turns them into a short study plan and is cached by a hash of the findings.
- Recompute when digests change. This runs in memory and stays cheap for hundreds of games. Memoize on digest count and version.

---

## 6. Opening trainer (milestone 4)

### Building the repertoire (`lib/training/repertoire.ts`, pure)
- For each colour, walk your games' first 16 plies (configurable) into a tree keyed by `fenKey` (FEN without the move counters).
  - **Nodes where you move:** the counts of each move you played, plus that move's stored eval and classification.
  - **Nodes where the opponent moves:** the counts of their replies. Keep replies seen ≥ 2 times, or the top 3.
- **Your move at a node:** your most frequent move, *unless* the engine marks it a mistake or blunder or it loses ≥ 8 win%. In that case, use the engine's best move and flag it "corrected". This puts your known mistakes into the drill.
- Persist the tree to `repertoire` with user overrides (pin a move, delete a branch, add a move from the board). Rebuilding merges new games but never overwrites user-pinned nodes.
- Name lines with `data/openings.ts` (FEN → name) or the game's `openingName`.
- *Optional later:* suggest common opponent replies you haven't faced from the lichess opening explorer. Check its current auth and CORS rules before relying on it.

### Drilling (Train → Openings)
- Pick a colour and a line. The opponent's moves are played automatically, weighted by how often you face them. You must play your repertoire move.
- Each node where you move gets its own Leitner box (same scheduler as puzzles), so the lines you get wrong come up more often.
- **When you play a different move (leaving theory)**, don't just mark it wrong:
  1. Evaluate both moves (stored or live `analysePosition`).
  2. If your move is about as good (within 3%), accept it as an alternative and offer "add to repertoire".
  3. Otherwise, call the LLM with `buildOpeningPlanMessages`. Its facts are the opening name, the correct move and its PV, your move and the engine's refutation, the pawn structure and material from `facts.ts`, and the moves so far. The prompt asks for the *plan/idea* behind the correct move.
     - Opening plans are the one place the LLM will draw on general knowledge, so the prompt must tie each claim to the engine line it's given, and say "not sure" rather than invent theory.
  - **Without a key:** show the correct move, the engine line and the opening name.
- **Review link:** each digest records `leftRepertoireAtPly`. The game review and the report can then say "You left your repertoire on move 7 (played …, repertoire …)".

---

## 7. Blunder-check habit training (milestone 5, independent)

This needs none of milestones 0–4, so it can be built at any point.

### Board change
- Add an optional `onMoveIntercept?: (move: {from,to,promotion}) => boolean` prop to `components/board/index.tsx`. All three move paths (drop, click-to-move and the promotion dialog) call it before `playMove`. If it returns `true`, the board doesn't play the move.
- Expose `stagedMove` and `overrideFen` props so the board can show a candidate move without committing it to `gameAtom`.

### Flow in play mode (`sections/play/coach/useBlunderCheck.ts`)
1. You make a move. If the check triggers, the move is **staged**, not played. The board shows the position after your move with the opponent to move, and the coach asks: *"Before you commit: what's their best reply? Play it on the board."*
2. You play a move for the opponent's side. It's graded against `analysePosition(fenAfterCandidate)` with multiPv 3:
   - **Correct:** your answer is the top reply, or within 5% win of it.
   - **Partial:** your answer is in the top 3.
   - **Missed:** anything else. The coach shows the real best reply (an arrow) and what it does. This uses the LLM via `buildBlunderCheckMessages` (facts: the reply's PV, hanging pieces, eval swing), or static text without a key.
3. Then two buttons, **Confirm move** or **Change move**. If your candidate loses ≥ 15 win% to that reply, the coach says so after your answer. That's the habit loop: look, find the threat, reconsider.
4. Log `{ found: boolean, candidateWasBad: boolean, changedMove: boolean }` to `trainingLog`. These feed the report ("you spot the opponent's threat 42% of the time", "blunder-checks saved 6 moves this week").

### When it triggers
Setting: *Off / Smart / Every move*.

**Smart** must not leak whether your move is bad. If it fired only on blunders, the prompt itself would be the hint. So it triggers on:
- every move in "sharp" positions (where you're in check, or the opponent has a capture or check available after your candidate), and
- a random ~25% of other moves.

It skips the opening book phase and only-legal-move positions.

### How it fits with what's there
- It runs before `usePlayCoach`'s post-move grading. Grading still happens after you confirm.
- Hints and takebacks are unchanged.
- The bot doesn't move while a move is staged.

---

## 8. New LLM prompts (`lib/coach/prompts.ts`)
- `buildPuzzleNudgeMessages(level)`
- `buildWeaknessReportMessages`
- `buildOpeningPlanMessages`
- `buildBlunderCheckMessages`

They all use the existing `useCoachLLM` cache (stable keys such as `puzzle|${id}|${level}`), keep to the facts-only rule, and have static fallbacks when there's no key.

---

## 9. Order of work

| # | Milestone | Depends on | Size |
|---|---|---|---|
| 0 | Foundation: profile, DB v2 + `lib/db.ts`, digest, analysis queue, `?ply=`, Train page shell, vitest | — | L |
| 1 | Chess.com auto-import | 0 | M |
| 2 | Puzzles from your mistakes + scheduler | 0 (1 for volume) | L |
| 3 | Weakness report | 0, 2 (themes) | M |
| 4 | Opening trainer | 0 | L |
| 5 | Blunder-check | — | M |

Milestone 5 can start in parallel with 0, because it touches only `components/board` and `sections/play`. After milestone 0, milestones 1, 2 and 4 touch mostly separate files and can also run in parallel.

## 10. Deferred / to revisit
- **Lichess auto-import** (see §3). Not started; chess.com comes first.

## 11. Risks / open questions
- **CPU:** batch analysis of many games is heavy on phones. Default `autoAnalyze` to "last 50 games", use the lite engine, and pause while playing.
- **Thresholds:** the 15% swing, 8% uniqueness and 1.5× report ratios are starting values. Tune them against real games, and keep them in one `TRAINING_THRESHOLDS` constant.
- **Opening plans** are the weakest link for the facts-only rule (see §6.3). Keep them tightly grounded in the engine line, or label them as general ideas.
- **Digest/eval drift:** re-analysis replaces the eval. The puzzle id (`gameId:ply`) stays stable, but `bestUci` may change, so regenerate the puzzle and keep its box.
- **Storage:** each eval is about 10–30 KB. A thousand games is fine for IndexedDB, but add a "delete evals older than N" option if needed.
