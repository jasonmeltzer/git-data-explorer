# Architecture

Git Data Explorer is a local-first full-stack TypeScript application. The frontend and backend run on the user's machine — there is no cloud deployment, no authentication service, and no external database.

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (localhost:5173)                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │  React 19 SPA (Vite 8)                            │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────────────┐ │  │
│  │  │ Landing  │ │  Repos   │ │     Settings       │ │  │
│  │  │  Page    │ │  Page    │ │  Page (PAT+depth)  │ │  │
│  │  └─────────┘ └──────────┘ └────────────────────┘ │  │
│  │  Collection progress (SSE) on Landing page       │  │
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

Single-page React app using hash-based routing (`#/`, `#/repos`, `#/settings`). No React Router — a simple `useState` switch in `App.tsx` handles navigation.

- **Pages:** Each page is a self-contained component that fetches its own data via TanStack Query hooks
- **TanStack Query:** Manages all server state. Query keys like `['repos', 'tracked']` are shared across pages so navigation triggers instant cache hits rather than re-fetches
- **shadcn/ui:** Component primitives (Button, Checkbox, Input, Badge, AlertDialog) copied into `src/shared/components/ui/`. Styled with Tailwind CSS 4
- **NavBar:** Persistent navigation across all pages with active state indication

### Backend (`src/server/`)

Hono HTTP server running on Node.js. Serves the API — does not serve the frontend (Vite handles that in dev, and in production the built SPA is static files).

**Routes** (`src/server/routes/`):
- `health.ts` — `GET /api/health` — DB connection check
- `settings.ts` — `GET/POST /api/settings/token`, `GET/PUT /api/settings` — PAT and app settings management
- `repositories.ts` — 7 endpoints for repo CRUD, GitHub browsing, stop/delete
- `collection.ts` — `POST /api/collection/start`, `POST /api/collection/stop`, `GET /api/collection/status`, `GET /api/collection/progress` (SSE) — data collection control and progress streaming
- `analytics.ts` — 6 analytics endpoints: `GET/POST /api/analytics/marker`, `GET /api/analytics/cohorts/commits`, `GET /api/analytics/cohorts/prs`, `GET /api/analytics/rampup`, `GET /api/analytics/rolling`

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

### Shared (`src/shared/`)

Code imported by both frontend and backend:
- `types.ts` — TypeScript interfaces for API request/response shapes (GitHubRepo, TrackedRepo, CollectionRepoStatus, CohortMetricsRow, CohortMetricsParams, RampUpBucket, RampUpParams, RollingComparisonResult, etc.)
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
```

**Key design decisions:**
- **Cohort assignment is dynamic** — uses the data point's timestamp, not today's date. The same author appears in different cohorts depending on when the commit occurred.
- **Both global and per-repo tenure** — global uses `authors.firstCommitAt`; per-repo uses `MIN(commits.committedAt)` per (author, repo) pair via correlated subquery.
- **Only complete repos** — all analytics queries filter to repos where both commits and PRs have `collection_state.status = 'complete'`. The shared `getCompleteRepoIds()` in `analytics-utils.ts` is the single canonical implementation (SEC-01 integer guard included).
- **Bot exclusion** — all queries filter `authors.is_bot = 0`.
- **Partial period normalization** — rolling window comparisons normalize to daily averages so a 10-day current month is fairly compared to a full prior month.
- **SQL injection prevention** — all `sql.raw()` interpolation sites validate IDs are positive integers before interpolation (SEC-01). Route-level Zod schemas validate date string inputs (BUG-06).

## What's Not Built Yet

- **Dashboard UI** (Phase 5) — No charts or trend visualization yet. The analytics API is complete and ready for frontend consumption

## File Map

```
src/
├── client/
│   ├── main.tsx              # Entry point, QueryClientProvider wrapper
│   ├── App.tsx               # Hash router, NavBar, page switching
│   ├── components/
│   │   ├── NavBar.tsx        # Persistent top navigation
│   │   └── TokenForm.tsx     # PAT entry form
│   └── pages/
│       ├── LandingPage.tsx   # Status overview, CTAs
│       ├── ReposPage.tsx     # Repo selection, search, management
│       └── SettingsPage.tsx  # Token configuration
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
│       └── analytics-rolling.ts   # Rolling window MoM/QoQ comparisons
└── shared/
    ├── types.ts              # Shared TypeScript interfaces
    ├── lib/utils.ts          # cn() class merge helper
    └── components/ui/        # shadcn/ui primitives
```
