# AGENTS.md — FireIta

FireIta is a client-side FIRE (Financial Independence, Retire Early) calculator for the Italian tax regime. It is a **Svelte 5 + TypeScript + Vite** single-page app with a pure-TypeScript Monte Carlo simulation engine. There is no backend: all computation runs in the browser (heavy simulations inside a Web Worker).

## Commands

```bash
npm run dev       # Vite dev server
npm run build     # production build -> dist/
npm run check     # svelte-check type checking (tsconfig: ./tsconfig.json)
npm test          # vitest run (all engine tests)
```

- Run a single test file: `npx vitest run src/lib/engine/__tests__/tax.test.ts`
- There is **no lint script** and no formatter configured; do not add one unless asked.
- After changing engine logic, run `npm test` and `npm run check`.

## Architecture

Data flow (one direction):

```
Plan (types.ts)
  -> persistence.ts sanitizePlan / createDefaultPlan
  -> stores/plan.svelte.ts (reactive source of truth, debounce + worker orchestration)
  -> engine/montecarlo.ts (generates return/inflation paths, calls runProjection)
  -> engine/projection.ts (year-by-year simulation on a single path)
  -> engine/stats.ts (aggregates runs into percentiles/bands/rates)
  -> engine/deflate.ts (nominal <-> real value transform)
  -> Svelte components (read planStore.stats, planStore.plan)
```

- **`src/lib/engine/`** — pure, DOM-free TypeScript. Everything must stay testable in Node/Vitest. No Svelte imports here.
- **`src/lib/stores/plan.svelte.ts`** — the single global store (`planStore`). Uses Svelte 5 runes (`$state`, `$derived`). Owns the Web Worker and the debounce/commit lifecycle.
- **`src/lib/components/`** — Svelte 5 components. Use runes API and the new event syntax (`onclick={...}`, `class:active={...}`), not the legacy `on:click`.
- **`src/App.svelte`** — orchestrates `planStore.plan` via an `$effect` that calls `planStore.notifyPlanChanged(...)` and writes to `localStorage`.

### Engine modules

| File | Responsibility |
| --- | --- |
| `types.ts` | `Plan`, `YearState`, `SimResult`, and all config unions. **Source of truth for the data model.** |
| `projection.ts` | `runProjection(plan, returns, inflations?)` — one path, returns `YearState[]`. Also `horizonYears`, `effectiveStopYear`, `computeVpwRate`. |
| `montecarlo.ts` | Seeded RNG (`mulberry32`), log-normal sampling, Cholesky 3x3, historical rolling + block bootstrap, `runMonteCarlo`. |
| `tax.ts` | `sellWithTax`, `applyStampDuty`, `effectiveCapitalGainsTaxRate`, `pensionFundTaxRate`, `WHITELIST_TAX_RATE`. |
| `allocation.ts` | Multi-asset buckets, glidepath target weights, tax-aware rebalancing. |
| `stats.ts` | `computeStats`, percentile helpers, `compareSimRuns`. |
| `deflate.ts` | `ValueMode`, nominal->real transforms for stats and year states. |
| `goalSeek.ts` | Inverse solver (bisection) for retirement age / expenses / income / initial portfolio. |
| `sensitivity.ts` | Retirement-age x expenses heatmap grid. |
| `historicalData.ts` | Hardcoded historical datasets (`usa`, `italia`). |
| `chart-helpers.ts` | SVG path helpers for charts. |
| `worker.ts` | Web Worker entry; message protocol (`SIMULATE`, `GOAL_SEEK`). |

## Conventions and gotchas

- **Language**: All code comments, UI strings, test descriptions, and docs are in **Italian**. Keep new comments/UI text in Italian to match.
- **Svelte 5 runes only**: `$state`, `$derived`, `$effect`, `$props`. The store lives in a `.svelte.ts` file so runes work outside components. Access state via getters exposed by the store object.
- **Simulation is non-blocking**: `planStore` debounces plan edits by `DEBOUNCE_MS = 300`, then commits and posts to the worker. The worker (or a sync fallback when `Worker` is unavailable, e.g. SSR/Vitest) returns `SIMULATE_DONE`. `requestId` guards against stale responses — always check `msg.requestId === latestRequestId`.
- **Optional features = optional fields**: Features like pension fund, cash buffer, multi-asset, and stochastic inflation add **optional** fields to `Plan`/`YearState` (e.g. `bucket?`, `pensionFundBalance?`). When a feature is off the field is `undefined`; guard accordingly and spread conditionally in transforms (see `deflate.ts`).
- **Sanitization is mandatory**: Anything loaded from `localStorage`, URL params, or JSON import must pass through `sanitizePlan` (persistence.ts). `replacePlan` also uses it. Never trust raw parsed input.
- **Seeded / CRN simulations**: `montecarlo.ts` uses `mulberry32(plan.seed)`. `goalSeek` and `sensitivity` rely on common random numbers (same seed) so comparisons are deterministic. Preserve this when touching RNG usage.
- **Persistence keys**: `fireita.plan.v1` (`STORAGE_KEY`) and `fireita.baseline.v1` (`BASELINE_STORAGE_KEY`). URL shares the plan via the `?plan=` param.
- **Doc drift**: `doc/12-engine-webworker-goalseek.md` references `src/lib/workers/sim.worker.ts`, but the worker actually lives at `src/lib/engine/worker.ts`.

## Testing

- Tests live in `src/lib/engine/__tests__/*.test.ts` (Vitest; `vitest.config`/vite config includes only `src/**/*.test.ts`).
- Tests are **unit tests of pure engine functions**; store and components are not directly tested. Prefer adding engine tests for new logic, using `describe`/`it`/`expect` with Italian descriptions and `toBeCloseTo` for floats.
- There is no component/e2e test harness.

## Project docs

`doc/` holds Italian design documents for each implemented feature (01–12) plus `improvements.md` (the roadmap/checklist, all items done). Read the relevant numbered doc before changing a feature area; each contains the intent, math model, implementation steps, and a test plan.
