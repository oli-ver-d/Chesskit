# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Chesskit is a client-only chess web app (Next.js pages router, React 19, MUI, TypeScript) that plays, analyzes and reviews games with Stockfish compiled to WASM and running in Web Workers. This repo is a fork (`oli-ver-d/Chesskit`) of `GuillaumeSD/Chesskit` that adds an LLM "AI coach". See `AI-COACH.md` for the coach's features and code map.

## Commands

Requires Node.js 22.11 or newer.

```bash
npm i
npm run dev      # http://localhost:3000
npm run lint     # eslint on src/ AND `tsc --noEmit`; this is the only type-check
npm test         # vitest, src/**/*.test.ts (pure logic only, node environment)
npx vitest run src/lib/training/digest.test.ts   # a single test file
npm run build    # static export to ./out
npm run deploy   # lint + build + `cdk deploy` (AWS, upstream's chesskit.org stack)
```

Tests cover only pure functions (`src/lib/gameMeta.ts`, `src/lib/training/**`, `src/lib/sync/**`). There are no component tests, so check UI changes in the browser.

Docker alternative: `HOST_UID=$(id -u) HOST_GID=$(id -g) COMMAND=dev docker compose -f ./docker/docker-compose-dev.yml up` (use `COMMAND=lint` to lint). Production self-hosting: `docker compose -f ./docker/docker-compose-prod.yml up`.

## Architecture

**No backend.** `next.config.ts` sets `output: "export"` only for production builds, so the app must stay fully static: no API routes, `getServerSideProps`, or server-only code. All external calls (chess.com and lichess APIs, OpenRouter, Firebase analytics, Sentry) happen in the browser. Pages are `src/pages/index.tsx` (analysis), `play.tsx` and `database.tsx`. If you add a page, also add it to `pagePaths` in `cdk/app.ts`, which renames the exported `.html` files for S3 and CloudFront.

**Layout:** `src/pages` holds thin page shells. UI for each feature lives in `src/sections/<feature>/` (analysis, play, coach, loadGame, engineSettings, layout). Each section keeps its Jotai atoms in a local `states.ts`. Reusable logic lives in `src/lib`, hooks in `src/hooks`, shared types in `src/types`. Import through the `@/` alias, which maps to `src/`.

**State:** Jotai atoms. Persisted settings use `atomWithStorage` or `useAtomLocalStorage` (localStorage). React Query is used only for fetching chess.com and lichess data.

**IndexedDB** (`idb`, database `games`). Open it only through `getDb()` in `src/lib/db.ts`. That file holds the typed schema and the versioned `upgrade()` migration; add new stores or indexes there by bumping `DB_VERSION` and adding an `oldVersion < N` branch. Stores: `games`, `digests`, `puzzles`, `repertoire`, `trainingLog`, `meta`. After writing, call `notifyDbChange(store)` so open views (`useGameDatabase`, the Train page) reload. `formatGameToDatabase` fills the v2 game fields (`origin`, `externalId`, `endTime`, `timeClass`, `openingName`, `eco`) from PGN headers via `src/lib/gameMeta.ts`.

**Training pipeline** (the fork's training features; plan and milestones in `TRAINING-PLAN.md`):
- The profile (`profileAtom` in `sections/training/states.ts`) holds your chess.com and lichess usernames. `getMyColor` uses them to set each game's `myColor`; games played against the bot on the Play page (`Site "Chesskit.org"`, player "You") count as yours too.
- chess.com auto-import (`lib/sync/chessComSync.ts`, driven by `sections/training/useChessComSync.ts`) runs on load if the last sync is over an hour old, every 30 minutes, and from "Sync now". Its cursor is in `meta` (`chessComSyncCursor`). Games are deduped on `externalId` (the game URL) through the unique `by-externalId` index. Fetch chess.com serially: parallel requests get 429s.
- `<TrainingDaemon />` is mounted in the layout. It loops over `refreshTrainingData` (backfills pre-v2 game fields, syncs `myColor`, rebuilds stale digests) and `analyzeSavedGame`, which analyzes your N newest unanalyzed games one at a time with Stockfish 18 lite (depth 14, multiPv 3). Games queued in `analysisPriorityAtom` (the Database page's Re-analyze action) go first and replace any existing eval.
  - It pauses while a Play game is in progress, while the Analysis page is evaluating, or when you pause it from the NavBar indicator.
  - A game already being analyzed always finishes, because `evaluateGame` can't be cancelled safely.
- A `GameDigest` (`lib/training/digest.ts`) holds per-move facts from your point of view: win chance before and after the move, best move, gap to the second-best move, phase, clock, hung piece, missed mate. Puzzles, insights and the repertoire should read digests rather than re-parse PGNs. Bump `DIGEST_VERSION` when digest logic changes; stored digests then rebuild from the saved evals without re-running the engine.
- Puzzles (`lib/training/puzzles.ts`, `schedule.ts`, `puzzleStore.ts`; UI in `sections/training/puzzles/`) are extracted from digests whenever a digest changes, in the same transaction. Bump `PUZZLE_VERSION` when extraction logic changes; regenerated puzzles keep their Leitner box. Thresholds are in `TRAINING_THRESHOLDS` (`lib/training/thresholds.ts`). Every attempt is logged to `trainingLog`.
- Deep link: `/?gameId=X&ply=N` opens a saved game at the position after N half-moves. `ply` in a digest is the index of the move, so `ply=digest.ply` shows the position before that move.

**Engine pipeline:**
- Engine binaries are static files under `public/engines/stockfish-*/` (Stockfish 11 is `public/stockfish-11.js`). They are large and served with immutable caching.
- `src/lib/engine/stockfish*.ts` are thin factories that pick a binary path, often in a "lite" variant, and call `UciEngine.create`. To add an engine version, update `EngineName` in `src/types/enums.ts`, `isEngineSupported` in `lib/engine/shared.ts` and `pickEngine` in `hooks/useEngine.ts`.
- `src/lib/engine/uciEngine.ts` manages a pool of Web Workers that speak UCI (`worker.ts`), with a job queue. Key methods:
  - `evaluateGame`: full-game analysis, parallel across workers. It then runs accuracy (`helpers/accuracy.ts`), move classification (`helpers/moveClassification.ts`) and Elo estimate (`helpers/estimateElo.ts`).
  - `evaluatePositionWithUpdate`: live analysis that streams partial results. It tries the lichess cloud eval first (`lib/lichess.ts`), and new requests cancel running jobs.
  - `analysePosition`: a non-cancelling evaluation, added for the coach so it doesn't fight with live analysis.
- `useEngine(engineName)` owns the engine lifecycle. Always `shutdown()` engines you replace, or workers leak.

**AI coach (fork-specific):** Stockfish produces facts (`lib/coach/facts.ts`: SAN lines, hanging pieces, material, threats found with a null-move search). Prompts (`lib/coach/prompts.ts`) ask an OpenRouter model (`lib/coach/openrouter.ts`) to explain those facts, never to calculate chess itself. Keep that rule when changing prompts. The user's OpenRouter key is stored only in localStorage and sent straight to OpenRouter. The coach UI is split across `sections/coach/` (shared settings, state, bubble), `sections/analysis/panelBody/analysisTab/{coachComment,gameSummary}.tsx` and `sections/play/coach/`.

## Conventions

- Prettier settings: double quotes, 2 spaces, semicolons, `trailingComma: "es5"`. ESLint enforces them, along with no unused vars and no deprecated APIs. `tsconfig` is strict, including `noUnusedLocals`, `noUnusedParameters` and `noImplicitReturns`.
- The React Compiler is enabled (`reactCompiler: true`), so code must follow the Rules of React.
- The build prerenders pages in Node, so browser-only APIs (`window`, `Worker`, `localStorage`, IndexedDB) must stay inside effects or event handlers. `navigator` does exist in Node 22, which is why the module-scope `getRecommendedWorkersNb()` call in `sections/analysis/states.ts` works.
- License is AGPL-3.0, so a publicly hosted modified version must publish its source.
