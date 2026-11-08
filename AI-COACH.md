# Chesskit AI Coach

This fork adds a chess.com-style AI coach on top of Chesskit's Stockfish analysis.
Stockfish judges every move; an LLM (any model on [OpenRouter](https://openrouter.ai))
explains it in plain English. The LLM is only given engine-verified facts
(evaluations, best lines, the opponent's best reply, pieces left en prise), so it
explains the engine rather than calculating chess itself.

## Bring your own key

Click the robot icon in the top bar, paste an OpenRouter key
(https://openrouter.ai/settings/keys) and pick a model. The key is stored only in
the user's browser (localStorage) and sent straight to OpenRouter. There is no
server, so hosting costs nothing extra. Setting a credit limit on the key is a good
idea.

## Game review (Analysis page)

- After **Analyze**, a coach bubble under the move info explains the current move
  (blunders: what the reply exploits and what was better; good moves: the idea).
- Moves are explained automatically as you step through (debounced). You can turn
  this off in the coach settings and use the **Explain this move** button instead.
- **AI game summary** writes a short game review: overview, key moments and what
  to work on.
- Moves off the main line can be explained too, once the engine has reached depth 10.

## Coach play mode (Play page)

- Every one of your moves is graded by Stockfish and shown on the board and in the
  coach feed.
- **Take back & retry** appears on mistakes and blunders.
- **Hint** → **Bigger hint** → **Show best move**: two AI nudges, then an arrow
  showing the move.
- Bot moves are explained, and the coach warns you when the bot creates a threat
  (found with a null-move search).
- Options (the slider icon in the Coach header): *Explain every move*,
  *Key moments* (the default: mistakes, great moves and threats) or *Hints only*,
  plus a toggle for takebacks.
- Without an API key, the coach still grades your moves and gives piece and
  best-move hints.

## Running and deploying

```
npm i
npm run dev        # http://localhost:3000
npm run build      # static site in ./out
```

`./out` is a plain static site. You can deploy it to Cloudflare Pages, Netlify,
Vercel or GitHub Pages (the engines folder is large, so check the host's file
size limits).

Licence: Chesskit is AGPL-3.0, so if you host a modified version publicly, you
must publish its source too.

## Code map

- `src/lib/coach/openrouter.ts`: OpenRouter client and model list
- `src/lib/coach/facts.ts`: engine facts (SAN lines, hanging pieces, material, threats)
- `src/lib/coach/prompts.ts`: prompts for move explanations, hints, bot moves and the summary
- `src/sections/coach/*`: settings dialog, shared state, the coach bubble UI
- `src/sections/analysis/panelBody/analysisTab/{coachComment,gameSummary}.tsx`: review coach
- `src/sections/play/coach/*`: play mode coach (hook and panel)
- `src/lib/engine/uciEngine.ts`: `analysePosition()`, a non-cancelling evaluation used by the coach
- `src/lib/engine/helpers/moveClassification.ts`: a dubious "named opening" move
  (for example a losing gambit) is no longer labelled a book move
