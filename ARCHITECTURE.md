# Architecture

Git Data Explorer is a local-first full-stack TypeScript application organized as an npm workspaces monorepo. The frontend and backend run on the user's machine — there is no cloud deployment, no authentication service, and no external database.

## Monorepo Structure

```
git-data-explorer/
├── packages/
│   ├── main/        # Main app — GitHub API collection, SQLite, dashboard UI
│   ├── shared/      # Shared types, UI components, utilities (used by both main + research)
│   └── research/    # Research tool — import bundles, cross-org analysis
├── package.json     # Workspace root (npm workspaces)
└── drizzle.config.ts  # Drizzle config for main app migrations
```

**Package aliases:**
- `@git-data-explorer/main` — main app
- `@git-data-explorer/shared` — shared code (imported as `@shared/*`)
- `@git-data-explorer/research` — research tool

## System Overview

### Main App (packages/main/)

```
┌─────────────────────────────────────────────────────────┐
│  Browser (localhost:5173)                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │  React 19 SPA (Vite 8)                            │  │
│  │  Dashboard │ Landing │ Repos │ Collection │Settings│  │
│  │  Charts: CohortAreaChart, RampUpLineChart          │  │
│  │  FilterBar, RollingCards, ContributorTable         │  │
│  │  TanStack Query cache ──── shared query keys       │  │
│  └───────────────────────────────────────────────────┘  │
│                        │ HTTP /api/*                      │
└────────────────────────┼────────────────────────────────┘
                         │ (Vite proxy in dev)
┌────────────────────────┼────────────────────────────────┐
│  Hono Server (localhost:3001)                            │
│  Routes: /api/health, /api/settings, /api/repos/*        │
│          /api/collection/*, /api/analytics/*             │
│          /api/export, /api/share/*                       │
│  Services: collection engine, analytics, export          │
│                        │                                 │
│  SQLite (better-sqlite3) — data/git-data-explorer.db    │
│  Drizzle ORM schema + migrations                         │
│                        │                                 │
│  GitHub API (@octokit/rest + throttling plugin)          │
└──────────────────────────────────────────────────────────┘
```

### Research Tool (packages/research/)

```
┌─────────────────────────────────────────────────────────┐
│  Browser (localhost:5174)                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │  React 19 SPA (Vite 8)                            │  │
│  │  ImportPage │ OrgDashboard │ CrossOrgPage          │  │
│  │  NavBar — hash-based routing (#/import, #/org/:id)│  │
│  │  TanStack Query cache                             │  │
│  └───────────────────────────────────────────────────┘  │
│                        │ HTTP /api/*                      │
└────────────────────────┼────────────────────────────────┘
                         │ (Vite proxy in dev)
┌────────────────────────┼────────────────────────────────┐
│  Hono Server (localhost:3002)                            │
│  Routes: /api/health, /api/import/*, /api/orgs/*         │
│          /api/analytics/cross-org/*                      │
│  Services: import pipeline, org service, aggregation     │
│  NO GitHub API — all data from imported ExportBundles    │
│                        │                                 │
│  SQLite (better-sqlite3) — data/research.db             │
│  Drizzle ORM schema (8 tables)                          │
└──────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

### Main App Frontend (`packages/main/src/client/`)

Single-page React app using hash-based routing (`#/dashboard`, `#/landing`, `#/repos`, `#/collection`, `#/settings`). Default route (`#/`) goes to Dashboard. Full dark mode support via `useTheme` hook with localStorage persistence.

- **Pages:** Each page is a self-contained component that fetches its own data via TanStack Query hooks
- **Dashboard:** Primary view with FilterBar, 8 chart sections (Executive Summary, Cohort Trends, Ramp-Up Curves, Before/After Comparison, PR Turnaround, Rolling Comparisons, Bot vs Human Ratio, Contributor Table), stat callout boxes, rich help panels, filter scope badges, Chart|Table toggles on all 6 chart sections, and collapsible contributor table with 15 before/after AI delta columns
- **Charts:** Built on Recharts via shadcn chart primitives. `CohortAreaChart` renders stacked areas with 3 cohort layers. `RampUpLineChart` renders per-join-period lines. `RollingCards` shows metric cards with change percentages. All 6 chart sections support icon-based Chart|Table toggle with sortable data tables via @tanstack/react-table
- **TanStack Query:** Manages all server state. Query keys like `['repos', 'tracked']` are shared across pages so navigation triggers instant cache hits rather than re-fetches
- **shadcn/ui:** Component primitives (Button, Checkbox, Input, Badge, AlertDialog, Chart, Table, Collapsible, Card, Skeleton, Select, Popover, Calendar, Tooltip, Command) copied into `packages/shared/components/ui/`. Styled with Tailwind CSS 4

### Main App Backend (`packages/main/src/server/`)

Hono HTTP server running on Node.js. Serves the API — does not serve the frontend (Vite handles that in dev, built SPA is static files in production).

**Routes** (`src/server/routes/`):
- `health.ts` — `GET /api/health`
- `settings.ts` — `GET/POST /api/settings/token`, `GET/PUT /api/settings`, sharing consent endpoints
- `repositories.ts` — 7 endpoints for repo CRUD, GitHub browsing, stop/delete
- `collection.ts` — `POST /api/collection/start`, `POST /api/collection/stop`, `GET /api/collection/status`, `GET /api/collection/progress` (SSE)
- `analytics.ts` — 13 analytics endpoints: marker, cohorts, rampup, rolling, contributors, contributors/before-after, pr-turnaround, bot-ratio, summary, before-after, cohort-config
- `export.ts` — `POST /api/export` → builds ExportBundle (all 8 analytics sections)
- `share.ts` — `POST /api/share/gist`, `POST /api/share/http`, `GET /api/share/reachability`

### Research Tool Frontend (`packages/research/client/`)

Single-page React app using hash-based routing. Three pages:

- **ImportPage** (`#/import`) — 4-tab import source selector: Local File (ZIP/JSON drag-drop), GitHub Gist URL, HTTP/Cloud URL, Batch Directory path
- **OrgDashboard** (`#/org/:orgId`) — Per-org trend charts using imported snapshot data; sidebar shows all imported orgs with snapshot counts; "Imported" badge on data sections
- **CrossOrgPage** (`#/cross-org`) — Checkbox org selector, aggregated charts across selected orgs, Weighted vs Equal Weight mode toggle

### Research Tool Backend (`packages/research/server/`)

Hono HTTP server. No GitHub API dependency — all data from imported ExportBundle files.

**Routes** (`server/routes/`):
- `health.ts` — `GET /api/health`
- `import.ts` — `POST /api/import/file`, `POST /api/import/url`, `POST /api/import/batch`
- `orgs.ts` — `GET /api/orgs`, `GET /api/orgs/:id`, `PATCH /api/orgs/:id`, `DELETE /api/orgs/:id`, `DELETE /api/orgs/:orgId/snapshots/:snapshotId`, `GET /api/orgs/:orgId/snapshots/:snapshotId/data`
- `analytics.ts` — `GET /api/analytics/cross-org/cohort-metrics`, `GET /api/analytics/cross-org/ramp-up`, `GET /api/analytics/cross-org/comparison`

**Services** (`server/services/`):
- `import-service.ts` — ZIP parsing (fflate), bundle validation, org auto-creation, DB insertion, duplicate detection by SHA-256 content hash
- `validation.ts` — Zod schema for ExportBundle; validates shape, warns on null/empty optional sections; backward-compatible with old toolVersion bundles
- `org-service.ts` — Org and snapshot CRUD (create, list, get, update, delete with cascade)
- `aggregation.ts` — Cross-org aggregation engine: `getAggregatedCohortMetrics`, `getAggregatedRampUp`, `getOrgComparisonTable`; uses latest snapshot per org
- `test-data-generator.ts` — Synthetic ExportBundle generator (small startup, mid-size company, pre-AI baseline); used by tests

### Shared Package (`packages/shared/`)

Code imported by both main and research frontends:
- `types.ts` — TypeScript interfaces (GitHubRepo, TrackedRepo, CohortMetricsRow, RampUpBucket, ContributorBeforeAfterStats, etc.)
- `export-types.ts` — ExportBundle, ExportMetadata, PrTurnaroundRow, BotRatioRow, ExecutiveSummary, BeforeAfterComparison
- `cohort-config.ts` — Single source of truth for cohort boundary definitions: `CohortThreshold`, `CohortConfig`, `DEFAULT_COHORT_CONFIG` (3mo/12mo thresholds), `getThresholdSeconds()` for SQL CASE WHEN generation
- `components/ui/` — shadcn/ui primitives (used only by frontend, but placed in shared for the `@shared/*` path alias)
- `lib/utils.ts` — `cn()` helper for Tailwind class merging

## Database Schemas

### Main App DB (`data/git-data-explorer.db`)

SQLite via better-sqlite3. Drizzle ORM schema.

| Table | Purpose |
|-------|---------|
| `app_config` | Key-value store for settings (AI marker, cohort config, sharing consent) |
| `repositories` | Tracked GitHub repos with soft-delete via `removed_at` |
| `authors` | Contributors identified by `github_login`, with bot flag and first-commit date |
| `commits` | Commit data with line/file stats, indexed on `(repo_id, committed_at)` |
| `pull_requests` | PR data with size stats and state tracking |
| `collection_state` | Cursor tracking for incremental API collection — stores last page/SHA per repo per resource type |

### Research DB (`data/research.db`)

Separate SQLite database. 8 tables.

| Table | Purpose |
|-------|---------|
| `orgs` | One row per imported org. `label`, `size_category`, `industry`, `ai_tool`, `import_source` |
| `snapshots` | One row per imported bundle. Links to `orgs`. Stores `metadata_json`, `content_hash` (SHA-256 for dedup), `contributor_count`, `repo_count`, `ai_marker_date` |
| `cohort_metrics` | Per-cohort, per-period, per-month metrics rows. `metric_type` = 'commits' or 'prs'. Linked to snapshot + org |
| `ramp_up` | New developer ramp-up data: `week_index`, `avg_lines_changed`, `join_period`. Per snapshot |
| `rolling_comparisons` | Rolling window comparison JSON blob (MoM/QoQ). One row per snapshot |
| `contributors` | Per-contributor before/after stats. `pre_json` and `post_json` store ContributorStats as JSON |
| `pr_turnaround` | Monthly PR merge time data. `avg_hours_to_merge`, `median_hours_to_merge`, `pr_count` |
| `bot_ratio` | Monthly bot vs human commit ratio data |

## Cross-Org Aggregation Engine

The aggregation engine (`packages/research/server/services/aggregation.ts`) reads from the research DB and supports two modes:

```
Two aggregation modes:

WEIGHTED MODE                         NORMALIZED MODE
Each org contributes proportionally   Each org counts equally regardless
to its contributor count.             of size (simple average).

Useful when:                          Useful when:
- Large orgs should dominate the      - You want to compare org-level
  aggregate (reflects real-world)       behavior without size bias

getAggregatedCohortMetrics(           getAggregatedCohortMetrics(
  'weighted', orgIds, 'commits'         'normalized', orgIds, 'commits'
)                                     )
```

**Key design decisions:**
- **Latest snapshot per org** — `getLatestSnapshotIds()` always picks the most recent import per org using `MAX(import_timestamp)`. Old snapshots are retained for history but not included in cross-org aggregation.
- **Empty result for zero orgs** — all functions return `[]` when `orgIds` is empty (safe for UI rendering)
- **COALESCE for zero contributors** — weighted division uses `NULLIF(SUM(contributor_count), 0)` with `COALESCE(..., 0)` to avoid NaN when contributor_count=0

## Import Pipeline

```
User provides source (file/URL/Gist/batch)
  → parseZipBundle() or JSON.parse()
      → validateBundle() (Zod schema check)
          → importBundle()
              → Auto-create org (if orgId=null)
              → SHA-256 content hash (dedup detection)
              → db.transaction():
                  → INSERT INTO snapshots
                  → INSERT INTO cohort_metrics (N rows)
                  → INSERT INTO ramp_up (N rows)
                  → INSERT INTO rolling_comparisons (1 row)
                  → INSERT INTO contributors (N rows)
                  → INSERT INTO pr_turnaround (N rows)
                  → INSERT INTO bot_ratio (N rows)
              → Return { orgId, snapshotId, warnings, isDuplicate }
```

**Dedup behavior:** If the same content hash is imported twice for the same org, `isDuplicate=true` is returned with a warning, but the import proceeds and creates a new snapshot. This preserves history while flagging the duplicate.

## Export & Sharing Layer (Main App)

Added in Phase 8.

```
Export flow:
FilterBar "Export Data" button
  → ExportModal (format selection, anonymization toggle, 5-row preview)
      → POST /api/export { startDate, endDate, repoIds, tenureMode, rollingGranularity }
          → buildExportBundle (server: aggregates all 8 analytics sections)
              → ExportBundle returned to client
                  → anonymizeBundle (client-side: buildPseudonymMap + buildRepoMap)
                      → fflate zipSync → ZIP blob download
                          → onExportComplete callback → check heuristic → SharingPrompt

Sharing flow (post-export):
SharingPrompt AlertDialog
  → tier selection (summary = metadata+executiveSummary+rolling, full = entire bundle)
  → destination selection:
      HTTP → POST /api/share/http { data }
      Gist → POST /api/share/gist { tier, data } → Octokit gist create → { gistUrl }
      Manual → blob download with instructions text prepended
  → Decline → PUT /api/settings/sharing/decline (permanent suppression)
```

## Analytics Architecture (Main App)

The analytics layer is a set of pure query services that read from the SQLite database. No writes, no side effects (except AI marker config).

**Cohort assignment is dynamic** — uses the data point's timestamp, not today's date. The same author appears in different cohorts depending on when the commit occurred.

**Only complete repos** — all analytics queries filter to repos where both commits and PRs have `collection_state.status = 'complete'`. The shared `getCompleteRepoIds()` in `analytics-utils.ts` is the single canonical implementation (SEC-01 integer guard included).

**SQL injection prevention** — all `sql.raw()` interpolation sites validate IDs are positive integers before interpolation (SEC-01). Route-level Zod schemas validate date string inputs (BUG-06).

## What's Not Built Yet

- **Settings UI for AI marker** — Currently API-only (`POST /api/analytics/marker`); no date picker in Settings page yet
- **Research tool: persisted org charts** — OrgDashboard renders aggregated data from the latest snapshot; time-series comparison across snapshots not yet implemented

## File Map

```
packages/
├── main/
│   ├── src/
│   │   ├── client/
│   │   │   ├── main.tsx              # Entry point, QueryClientProvider
│   │   │   ├── App.tsx               # Hash router, NavBar, page switching
│   │   │   ├── components/
│   │   │   │   ├── NavBar.tsx
│   │   │   │   ├── FilterBar.tsx     # Dashboard sticky filter bar + Export button
│   │   │   │   ├── ExportModal.tsx   # CSV/JSON export dialog
│   │   │   │   ├── SharingPrompt.tsx # Post-export sharing AlertDialog
│   │   │   │   ├── ContributorTable.tsx
│   │   │   │   ├── StatCalloutBox.tsx / StatCalloutRow.tsx
│   │   │   │   ├── HelpPanel.tsx
│   │   │   │   ├── ExecutiveSummary.tsx
│   │   │   │   ├── BeforeAfterComparison.tsx
│   │   │   │   ├── PrTurnaroundChart.tsx
│   │   │   │   ├── BotRatioChart.tsx
│   │   │   │   └── charts/
│   │   │   │       ├── CohortAreaChart.tsx
│   │   │   │       ├── RampUpLineChart.tsx
│   │   │   │       └── RollingCards.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useDashboardFilters.ts
│   │   │   │   ├── useCohortCommits.ts / useCohortPrs.ts
│   │   │   │   ├── useRampUp.ts / useRolling.ts
│   │   │   │   ├── useContributors.ts / useContributorBeforeAfter.ts
│   │   │   │   ├── useExport.ts / useSharingStatus.ts
│   │   │   │   └── useCollectionSSE.ts
│   │   │   ├── lib/
│   │   │   │   ├── anonymizer.ts     # Client-side contributor pseudonymization
│   │   │   │   ├── csv-serializer.ts # RFC 4180 CSV serialization
│   │   │   │   ├── chartTransforms.ts
│   │   │   │   ├── deltaFormat.ts    # pctDelta/formatNum utilities
│   │   │   │   └── narratives.ts
│   │   │   └── pages/
│   │   │       ├── DashboardPage.tsx
│   │   │       ├── LandingPage.tsx
│   │   │       ├── ReposPage.tsx
│   │   │       ├── CollectionPage.tsx
│   │   │       └── SettingsPage.tsx
│   │   └── server/
│   │       ├── index.ts              # Hono app, CORS, route mounting
│   │       ├── db/
│   │       │   ├── schema.ts         # Drizzle table definitions (6 tables)
│   │       │   ├── client.ts         # DB singleton
│   │       │   └── migrate.ts        # Migration runner
│   │       ├── routes/
│   │       │   ├── health.ts / settings.ts / repositories.ts
│   │       │   ├── collection.ts / analytics.ts
│   │       │   ├── export.ts / share.ts
│   │       └── services/
│   │           ├── collection-queue.ts / collection-engine.ts
│   │           ├── analytics-cohorts.ts / analytics-rampup.ts
│   │           ├── analytics-rolling.ts / analytics-contributors.ts
│   │           ├── analytics-pr-turnaround.ts / analytics-bot-ratio.ts
│   │           ├── analytics-summary.ts / analytics-before-after.ts
│   │           ├── analytics-config.ts / analytics-utils.ts
│   │           ├── cohort-config-service.ts
│   │           ├── export-service.ts # buildExportBundle (8 analytics sections)
│   │           └── first-commit-fetcher.ts
│   └── scripts/
│       └── seed.ts                   # Synthetic data generator (npm run seed)
│
├── shared/
│   ├── types.ts                      # Shared TypeScript interfaces
│   ├── export-types.ts               # ExportBundle, ExportMetadata, etc.
│   ├── cohort-config.ts              # CohortConfig, DEFAULT_COHORT_CONFIG
│   ├── lib/utils.ts                  # cn() class merge helper
│   └── components/ui/               # shadcn/ui primitives
│
└── research/
    ├── client/
    │   ├── main.tsx                  # Entry point
    │   ├── App.tsx                   # Hash router + NavBar
    │   ├── components/
    │   │   └── NavBar.tsx
    │   └── pages/
    │       ├── ImportPage.tsx        # 4-tab import source selector
    │       ├── OrgDashboard.tsx      # Per-org trend charts + snapshot history
    │       └── CrossOrgPage.tsx      # Multi-org comparison with mode toggle
    └── server/
        ├── index.ts                  # Hono app (port 3002)
        ├── db/
        │   ├── schema.ts             # Drizzle table definitions (8 tables)
        │   ├── client.ts             # DB singleton (data/research.db)
        │   └── migrate.ts            # Migration runner
        ├── routes/
        │   ├── health.ts / import.ts / orgs.ts / analytics.ts
        └── services/
            ├── import-service.ts     # ZIP/JSON ingestion, validation, DB write
            ├── validation.ts         # Zod ExportBundle schema
            ├── org-service.ts        # Org/snapshot CRUD
            ├── aggregation.ts        # Weighted/normalized cross-org aggregation
            └── test-data-generator.ts  # Synthetic org bundle generator
```
