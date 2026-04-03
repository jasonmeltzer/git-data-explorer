# Architecture

Git Data Explorer is a local-first full-stack TypeScript application. The frontend and backend run on the user's machine — there is no cloud deployment, no authentication service, and no external database.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (localhost:5173)                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │  React 19 SPA (Vite 8)                            │  │
│  │  ┌──────────┐ ┌────────┐ ┌──────┐ ┌───────────┐ ┌──────┐│  │
│  │  │Dashboard │ │Landing │ │Repos │ │Collection │ │Set-  ││  │
│  │  │(default) │ │ Page   │ │ Page │ │   Page    │ │tings ││  │
│  │  └──────────┘ └────────┘ └──────┘ └───────────┘ └──────┘│  │
│  │  Charts: CohortAreaChart, RampUpLineChart        │  │
│  │  FilterBar, RollingCards, ContributorTable        │  │
│  │  TanStack Query cache ──── shared query keys      │  │
│  └───────────────────────────────────────────────────┘  │
│                        │ HTTP /api/*                      │
└────────────────────────┼────────────────────────────────┘
                         │ (Vite proxy in dev)
┌────────────────────────┼────────────────────────────────┐
│  Hono Server (localhost:3001)                            │
│  ┌─────────────────────┼─────────────────────────────┐  │
│  │  Routes             │                              │  │
│  │  /api/health    /api/settings    /api/repos/*      │  │
│  │  /api/collection/*  /api/analytics/*               │  │
│  └─────────────────────┼─────────────────────────────┘  │
│  ┌─────────────────────┼─────────────────────────────┐  │
│  │  Services                                          │  │
│  │  token.ts  octokit.ts  github-repos.ts             │  │
│  │  repo-management.ts  collection-*.ts               │  │
│  │  analytics-config.ts  analytics-cohorts.ts         │  │
│  │  analytics-rampup.ts  analytics-rolling.ts         │  │
│  └─────────────────────┼─────────────────────────────┘  │
│                        │                                 │
│  ┌─────────────────────┼─────────────────────────────┐  │
│  │  SQLite (better-sqlite3)                           │  │
│  │  Drizzle ORM schema + migrations                   │  │
│  │  data/git-data-explorer.db                         │  │
│  └───────────────────────────────────────────────────┘  │
│                        │                                 │
│  ┌─────────────────────┼─────────────────────────────┐  │
│  │  GitHub API (@octokit/rest + throttling plugin)    │  │
│  │  Rate-limited, paginated, incremental collection   │  │
│  └───────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

### Frontend (`src/client/`)

Single-page React app using hash-based routing (`#/dashboard`, `#/landing`, `#/repos`, `#/collection`, `#/settings`). No React Router — a simple `useState` switch in `App.tsx` handles navigation. Default route (`#/`) goes to Dashboard. Full dark mode support via `useTheme` hook with localStorage persistence.

- **Pages:** Each page is a self-contained component that fetches its own data via TanStack Query hooks
- **Dashboard:** Primary view with FilterBar, 8 chart sections (Executive Summary, Cohort Trends, Ramp-Up Curves, Before/After Comparison, PR Turnaround, Rolling Comparisons, Bot vs Human Ratio, Contributor Table), stat callout boxes, rich help panels (coaching tone, concrete examples, Settings cross-references, privacy notes), filter scope badges, Chart|Table toggles on all 6 chart sections, and collapsible contributor table with 15 before/after AI delta columns
- **Hooks:** `useDashboardFilters` provides shared filter state (date range, repo selection, tenure mode) consumed by all chart sections. 12 analytics query hooks (`useCohortPrs`, `useCohortCommits`, `useRampUp`, `useRolling`, `useAiMarker`, `useContributors`, `useContributorBeforeAfter`, `useExecutiveSummary`, `useBeforeAfter`, `usePrTurnaround`, `useBotRatio`, `useCohortConfig`) wrap TanStack Query with typed API calls
- **Charts:** Built on Recharts via shadcn chart primitives. `CohortAreaChart` renders stacked areas with 3 cohort layers. `RampUpLineChart` renders per-join-period lines. `RollingCards` shows metric cards with change percentages. All 6 chart sections support icon-based Chart|Table toggle with sortable data tables via @tanstack/react-table
- **Data transforms:** `chartTransforms.ts` converts `CohortMetricsRow[]` to Recharts-compatible `ChartPoint[]` with zero-filled missing cohorts. `narratives.ts` generates direction+magnitude trend text
- **TanStack Query:** Manages all server state. Query keys like `['repos', 'tracked']` are shared across pages so navigation triggers instant cache hits rather than re-fetches
- **shadcn/ui:** Component primitives (Button, Checkbox, Input, Badge, AlertDialog, Chart, Table, Collapsible, Card, Skeleton, Select, Popover, Calendar, Tooltip, Command) copied into `src/shared/components/ui/`. Styled with Tailwind CSS 4
- **NavBar:** Persistent 4-link navigation (Dashboard, Repos, Collection, Settings) with active state indication and dark mode toggle (Moon/Sun icon)

### Backend (`src/server/`)

Hono HTTP server running on Node.js. Serves the API — does not serve the frontend (Vite handles that in dev, and in production the built SPA is static files).

**Routes** (`src/server/routes/`):
- `health.ts` — `GET /api/health` — DB connection check
- `settings.ts` — `GET/POST /api/settings/token`, `GET/PUT /api/settings` — PAT and app settings management
- `repositories.ts` — 7 endpoints for repo CRUD, GitHub browsing, stop/delete
- `collection.ts` — `POST /api/collection/start`, `POST /api/collection/stop`, `GET /api/collection/status`, `GET /api/collection/progress` (SSE) — data collection control and progress streaming
- `analytics.ts` — 13 analytics endpoints: `GET/POST /api/analytics/marker`, `GET /api/analytics/cohorts/commits`, `GET /api/analytics/cohorts/prs`, `GET /api/analytics/rampup`, `GET /api/analytics/rolling`, `GET /api/analytics/contributors`, `GET /api/analytics/contributors/before-after`, `GET /api/analytics/pr-turnaround`, `GET /api/analytics/bot-ratio`, `GET /api/analytics/summary`, `GET /api/analytics/before-after`, `GET/POST /api/analytics/cohort-config`

**Services** (`src/server/services/`):
- `analytics-utils.ts` — Shared analytics helpers: canonical `getCompleteRepoIds()` with integer safety guard (SEC-01), used by all analytics services
- `token.ts` — Reads/writes the GitHub PAT from `.env` file (no longer leaks PAT to `process.env`)
- `octokit.ts` — Creates Octokit client instances with throttling plugin. Reads token fresh per call (no stale singleton)
- `github-repos.ts` — Lists all repos accessible to the authenticated user via paginated API calls
- `repo-management.ts` — SQLite CRUD for tracked repos, including soft-delete (stop tracking) and hard-delete (remove all data + orphan author cleanup)
- `collection-state.ts` — Collection cursor management (per-repo, per-resource status tracking, depth settings)
- `collection-queue.ts` — Queue orchestration for incremental data collection with pause/resume
- `collection-engine.ts` — Reverse-chronological month-window GitHub API fetcher with rate-limit handling and SSE progress events
- `analytics-config.ts` — AI adoption marker date get/set/clear from `app_config`
- `analytics-cohorts.ts` — Cohort assignment engine: dynamic tenure bucketing (0-3mo, 3-12mo, 1yr+) with CASE WHEN epoch arithmetic, global and per-repo tenure modes, AI marker before/after split, bot exclusion
- `analytics-rampup.ts` — New developer ramp-up curves: weekly contribution trajectories (weeks 0-11) grouped by join period (quarter/half/year) for cross-cohort comparison
- `analytics-rolling.ts` — Rolling window comparisons: month-over-month and quarter-over-quarter with partial-period normalization to daily averages
- `analytics-pr-turnaround.ts` — Monthly median hours to merge for PRs with trend direction computation
- `analytics-bot-ratio.ts` — Monthly bot vs human commit ratio with trend direction computation
- `analytics-summary.ts` — Executive summary KPI tiles with before/after delta badges
- `analytics-before-after.ts` — Side-by-side before/after AI marker comparison for PR and commit metrics
- `cohort-config-service.ts` — Cohort boundary config get/set from `app_config`, uses shared `CohortConfig` types
- `first-commit-fetcher.ts` — GitHub API 2-call strategy to find an author's true earliest commit date across all repos (Link header page detection + oldest-page fetch)

### Shared (`src/shared/`)

Code imported by both frontend and backend:
- `types.ts` — TypeScript interfaces for API request/response shapes (GitHubRepo, TrackedRepo, CollectionRepoStatus, CohortMetricsRow, CohortMetricsParams, RampUpBucket, RampUpParams, RollingComparisonResult, ContributorBeforeAfterStats, ContributorRepoStats, ContributorRepoBeforeAfterStats, etc.)
- `cohort-config.ts` — Single source of truth for cohort boundary definitions: `CohortThreshold`, `CohortConfig`, `DEFAULT_COHORT_CONFIG` (3mo/12mo thresholds), `getThresholdSeconds()` for SQL CASE WHEN generation. Free of server-only or client-only imports.
- `components/ui/` — shadcn/ui primitives (used only by frontend, but placed in shared for the `@shared/*` path alias)
- `lib/utils.ts` — `cn()` helper for Tailwind class merging

### Database (`src/server/db/`)

SQLite via better-sqlite3 (synchronous API — no async complexity for a single-user local app).

**Schema** (Drizzle ORM):

| Table | Purpose |
|-------|---------|
| `app_config` | Key-value store for settings |
| `repositories` | Tracked GitHub repos with soft-delete via `removed_at` |
| `authors` | Contributors identified by `github_login`, with bot flag and first-commit date |
| `commits` | Commit data with line/file stats, indexed on `(repo_id, committed_at)` |
| `pull_requests` | PR data with size stats and state tracking |
| `collection_state` | Cursor tracking for incremental API collection — stores last page/SHA per repo per resource type, status (pending/in_progress/complete/paused/error) |

Migrations are applied synchronously at server startup via `runMigrations()` before any requests are accepted.

## Key Design Decisions

### Token per-call, not singleton
`createOctokit()` reads the PAT from disk on every call rather than caching it at module scope. This means a user can update their token in Settings without restarting the server.

### Shared TanStack Query keys
The ReposPage and LandingPage both query `['repos', 'tracked']`. When the user saves repo selections on the ReposPage, `queryClient.invalidateQueries({ queryKey: ['repos'] })` invalidates all repo-related queries. Navigating to the LandingPage then gets an instant cache hit or triggers a background refetch — no manual state coordination needed.

### Soft-delete for repos
Stopping tracking sets `removed_at` on the repository row. Commit and PR data is preserved. Only an explicit "Delete data" action removes the actual data rows, with a preview of what will be deleted shown in a confirmation dialog.

### Hash routing
Using `window.location.hash` instead of History API routing avoids the need for server-side catch-all routes. The app is a single `index.html` — any path works.

## Data Flow: Repo Selection

```
User checks repos → local state (Set<number>) →
  "Save Selection" click →
    1. Compute stop-delta (tracked but now unchecked → PATCH /api/repos/:id/stop)
    2. Save new selection (POST /api/repos with selected repos)
    3. Invalidate all ['repos'] query keys →
       LandingPage auto-updates via shared cache
```

## Data Collection Flow

```
User clicks "Start Collection" →
  POST /api/collection/start →
    collection-queue.ts builds ordered repo list →
      collection-engine.ts fetches commits/PRs per repo:
        - Reverse-chronological month-window strategy
        - Respects configurable depth (months of history)
        - Handles GitHub rate limits (429/403) with automatic backoff
        - Emits SSE progress events → frontend shows live progress
        - Stores cursor in collection_state for resume-on-interrupt
```

## Analytics Architecture

The analytics layer is a set of pure query services that read from the SQLite database. No writes, no side effects (except AI marker config).

```
API Request → analytics.ts route → Zod validation → service function → SQL query → response

Services:
┌─────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ analytics-cohorts.ts │  │ analytics-rampup.ts  │  │ analytics-rolling.ts │
│                     │  │                      │  │                      │
│ getCohortCommit     │  │ getRampUpCurves()    │  │ getRollingComparison()│
│   Metrics()         │  │                      │  │                      │
│ getCohortPrMetrics()│  │ SQL fetch + TS       │  │ MoM / QoQ with       │
│                     │  │ week bucketing       │  │ daily normalization  │
│ Dynamic tenure:     │  │ Weeks 0-11 per       │  │                      │
│ 0-3mo / 3-12mo /   │  │ new developer        │  │ pctChange() returns  │
│ 1yr+ via CASE WHEN  │  │                      │  │ null on zero-prior   │
│ epoch arithmetic    │  │ Join period grouping │  │                      │
└─────────────────────┘  └──────────────────────┘  └──────────────────────┘
         │                        │                         │
         └────────────────────────┼─────────────────────────┘
                                  │
                    ┌─────────────────────────┐
                    │  analytics-config.ts    │
                    │  AI marker date in      │
                    │  app_config table       │
                    │  Splits queries into    │
                    │  before/after periods   │
                    └─────────────────────────┘

Phase 07.1 additions:
┌──────────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ analytics-pr-turnaround  │  │ analytics-bot-ratio  │  │ analytics-summary    │
│                          │  │                      │  │                      │
│ Monthly median hours     │  │ Monthly bot % of     │  │ Executive KPI tiles: │
│ to merge (AVG approx)    │  │ total commits (CASE  │  │ total devs, avg PR   │
│ Trend: improving/        │  │ WHEN avoids WHERE    │  │ size, commit count,  │
│ worsening/stable         │  │ filter on is_bot)    │  │ before/after deltas  │
└──────────────────────────┘  └──────────────────────┘  └──────────────────────┘

┌──────────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ analytics-before-after   │  │ cohort-config-service│  │ first-commit-fetcher │
│                          │  │                      │  │                      │
│ Side-by-side PR+commit   │  │ GET/POST cohort      │  │ 2-API-call strategy: │
│ metric comparison        │  │ thresholds+labels    │  │ Link header page     │
│ keyed to AI marker date  │  │ from app_config      │  │ count, then fetch    │
│                          │  │ Shared CohortConfig  │  │ oldest page          │
└──────────────────────────┘  └──────────────────────┘  └──────────────────────┘

Phase 07.2 additions:
┌──────────────────────────────────────────────────────────────────────────────┐
│ contributors/before-after endpoint (analytics-contributors.ts)              │
│                                                                              │
│ Per-author before/after AI delta stats: 5 metrics (commits, lines_added,    │
│ lines_deleted, files_changed, prs) split by AI marker date.                 │
│ Returns pre-AI avg, post-AI avg, and pctDelta per contributor.              │
│                                                                              │
│ Client: useContributorBeforeAfter hook, ContributorTable 15 delta columns   │
│ Shared: deltaFormat.ts (pctDelta, formatNum) with 12 unit tests             │
└──────────────────────────────────────────────────────────────────────────────┘

Phase 07.3 additions:
┌──────────────────────────────────────────────────────────────────────────────┐
│ Per-repo contributor mode (analytics-contributors.ts)                        │
│                                                                              │
│ Per-repo mode returns one row per author-repo pair via GROUP BY (a.id,      │
│ c.repo_id). Uses correlated subquery for true first-commit-in-repo date    │
│ (not bounded by analysis window). Before/after stats use composite          │
│ authorLogin::repoId key in per-repo mode.                                   │
│                                                                              │
│ Types: ContributorRepoStats (extends ContributorStats with repoId,          │
│ repoFullName, firstCommitInRepoAt), ContributorRepoBeforeAfterStats        │
│                                                                              │
│ UI: ContributorTable per-repo row expansion — Repo column, ↳ row grouping, │
│ alternating bg bands, inline note, dynamic "First Commit (in repo)" header  │
│ HelpPanel per-repo explanations on cohort charts and contributor table      │
│                                                                              │
│ Seed: Senior personas get early tenure-anchor commits staggered across      │
│ repos so MIN(committed_at) per (author, repo) crosses 360-day threshold    │
│ 9 new tests (4 per-repo mode + 5 D-11 tenure regression tests)             │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **Cohort assignment is dynamic** — uses the data point's timestamp, not today's date. The same author appears in different cohorts depending on when the commit occurred.
- **Both global and per-repo tenure** — global uses `authors.firstCommitAt`; per-repo uses `MIN(commits.committedAt)` per (author, repo) pair via correlated subquery.
- **Only complete repos** — all analytics queries filter to repos where both commits and PRs have `collection_state.status = 'complete'`. The shared `getCompleteRepoIds()` in `analytics-utils.ts` is the single canonical implementation (SEC-01 integer guard included).
- **Bot exclusion** — all queries filter `authors.is_bot = 0`.
- **Partial period normalization** — rolling window comparisons normalize to daily averages so a 10-day current month is fairly compared to a full prior month.
- **SQL injection prevention** — all `sql.raw()` interpolation sites validate IDs are positive integers before interpolation (SEC-01). Route-level Zod schemas validate date string inputs (BUG-06).

## Seed Data (`scripts/seed.ts`)

A standalone TypeScript script (`npm run seed`) that generates a synthetic `data/seed.db` with realistic fake GitHub data for demo/testing:

- **3 repos** (acme-corp/platform 70%, mobile-app 20%, data-pipeline 10%)
- **31 contributors**: 5 seniors, 10 regulars, 5 pre-AI new devs, 5 post-AI new devs, 3 part-timers, 3 bots
- **~9000 commits, ~650 PRs** spanning 13 months (dynamic — ends yesterday, adjusts on each run)
- **Log-normal size distributions** (Box-Muller transform) with persona-tuned parameters
- **Weekday-weighted timestamps** with holiday blackout window
- **AI adoption inflection** at July 2025 with 2-month gradual ramp — post-AI new devs ramp 2x faster (3 weeks vs 6 weeks)
- **Idempotent** — wipes and recreates seed.db on each run
- **`npm run dev:seed`** starts the app against seed.db via `DB_PATH` env var

## What's Not Built Yet

- **Data Export** (Phase 8) — CSV/JSON export with optional contributor anonymization
- **Settings UI for AI marker** — Currently API-only (`POST /api/analytics/marker`); no date picker in Settings page yet (planned for a future phase)

## File Map

```
src/
├── client/
│   ├── main.tsx              # Entry point, QueryClientProvider wrapper
│   ├── App.tsx               # Hash router, NavBar, page switching (default: dashboard)
│   ├── components/
│   │   ├── NavBar.tsx        # Persistent top navigation
│   │   ├── TokenForm.tsx     # PAT entry form
│   │   ├── FilterBar.tsx     # Dashboard sticky filter bar (date presets, repo select, tenure mode)
│   │   ├── ContributorTable.tsx  # Collapsible sortable contributor table (TanStack Table); per-repo mode: author×repo rows, Repo column, row grouping
│   │   ├── StatCalloutBox.tsx    # Single KPI callout box with delta badge (min 44px touch height)
│   │   ├── StatCalloutRow.tsx    # Horizontal row of 2–4 StatCalloutBox components
│   │   ├── HelpPanel.tsx         # Expandable "What does this mean?" panel (chevron toggle)
│   │   ├── FilterScopeBadge.tsx  # "Filtered" / "All Data" badge with hover tooltip
│   │   ├── SectionHeader.tsx     # Section title + FilterScopeBadge row
│   │   ├── ExecutiveSummary.tsx  # Split layout: filtered metrics + AI Impact all-data metrics
│   │   ├── BeforeAfterComparison.tsx # Before/after/delta comparison table with units
│   │   ├── PrTurnaroundChart.tsx # Monthly median hours to merge line chart
│   │   ├── BotRatioChart.tsx     # Monthly bot vs human ratio line chart
│   │   └── charts/
│   │       ├── CohortAreaChart.tsx   # Stacked area chart with 3 cohort layers + AI marker
│   │       ├── RampUpLineChart.tsx   # Line chart per join-period cohort
│   │       ├── RollingCards.tsx      # Metric cards with change percentages
│   │       └── NarrativeCard.tsx     # Auto-generated trend insight text
│   ├── hooks/
│   │   ├── useTheme.ts              # Dark mode toggle with localStorage persistence
│   │   ├── useDashboardFilters.ts   # Shared filter state for all dashboard queries
│   │   ├── useCohortCommits.ts      # TanStack Query hook for cohort commit metrics
│   │   ├── useCohortPrs.ts          # TanStack Query hook for cohort PR metrics
│   │   ├── useRampUp.ts             # TanStack Query hook for ramp-up curves
│   │   ├── useRolling.ts            # TanStack Query hook for rolling comparisons
│   │   ├── useAiMarker.ts           # TanStack Query hook for AI marker date
│   │   ├── useContributors.ts       # TanStack Query hook for contributor stats
│   │   ├── useExecutiveSummary.ts   # TanStack Query hook for executive summary KPIs
│   │   ├── useBeforeAfter.ts        # TanStack Query hook for before/after comparison
│   │   ├── usePrTurnaround.ts       # TanStack Query hook for PR turnaround monthly data
│   │   ├── useBotRatio.ts           # TanStack Query hook for bot ratio monthly data
│   │   ├── useCohortConfig.ts       # TanStack Query hook for reading/writing cohort config
│   │   ├── useContributorBeforeAfter.ts # TanStack Query hook for contributor before/after AI delta data
│   │   └── useCollectionSSE.ts      # SSE connection for collection progress
│   ├── lib/
│   │   ├── chartTransforms.ts       # CohortMetricsRow[] → Recharts ChartPoint[]
│   │   ├── deltaFormat.ts           # pctDelta/formatNum utilities for before/after delta display
│   │   └── narratives.ts            # Trend narrative text generation
│   └── pages/
│       ├── DashboardPage.tsx  # Primary view: charts, filters, narratives
│       ├── LandingPage.tsx   # Setup status overview, "View Dashboard" CTA
│       ├── ReposPage.tsx     # Repo selection, search, management (status badges)
│       ├── CollectionPage.tsx # Data collection: depth slider, progress, start/stop
│       └── SettingsPage.tsx  # Token configuration, bot toggle
├── server/
│   ├── index.ts              # Hono app, CORS, route mounting
│   ├── db/
│   │   ├── schema.ts         # Drizzle table definitions
│   │   ├── client.ts         # DB connection singleton
│   │   └── migrate.ts        # Migration runner
│   ├── routes/
│   │   ├── health.ts         # GET /api/health
│   │   ├── settings.ts       # GET/POST /api/settings/token, GET/PUT /api/settings
│   │   ├── repositories.ts   # 7 repo endpoints
│   │   ├── collection.ts     # Collection start/stop/status/progress (SSE)
│   │   └── analytics.ts      # 6 analytics endpoints (marker, cohorts, rampup, rolling)
│   └── services/
│       ├── token.ts          # PAT read/write from .env
│       ├── octokit.ts        # Octokit factory with throttling
│       ├── github-repos.ts   # GitHub API repo listing
│       ├── repo-management.ts # SQLite repo CRUD
│       ├── collection-state.ts   # Collection cursor/status management
│       ├── collection-queue.ts   # Queue orchestration with pause/resume
│       ├── collection-engine.ts  # GitHub API fetcher with rate-limit handling
│       ├── analytics-config.ts   # AI marker date config
│       ├── analytics-utils.ts      # Shared: getCompleteRepoIds() with SEC-01 guard
│       ├── analytics-cohorts.ts   # Cohort assignment + metrics queries
│       ├── analytics-rampup.ts    # New developer ramp-up curves
│       ├── analytics-rolling.ts   # Rolling window MoM/QoQ comparisons
│       ├── analytics-contributors.ts  # Per-author aggregate stats + before/after AI delta stats; per-repo mode with GROUP BY (author, repo)
│       ├── analytics-pr-turnaround.ts # Monthly median hours to merge
│       ├── analytics-bot-ratio.ts     # Monthly bot vs human commit ratio
│       ├── analytics-summary.ts       # Executive summary KPI tiles
│       ├── analytics-before-after.ts  # Before/after AI marker comparison
│       ├── cohort-config-service.ts   # Cohort boundary config get/set from app_config
│       └── first-commit-fetcher.ts    # GitHub API true first-commit date finder
└── shared/
    ├── types.ts              # Shared TypeScript interfaces
    ├── cohort-config.ts      # CohortConfig, CohortThreshold, DEFAULT_COHORT_CONFIG, getThresholdSeconds()
    ├── lib/utils.ts          # cn() class merge helper
    └── components/ui/        # shadcn/ui primitives
scripts/
└── seed.ts                   # Synthetic data generator (npm run seed)
```
