# Architecture

Git Data Explorer is a local-first full-stack TypeScript application organized as an npm workspaces monorepo. The frontend and backend run on the user's machine — there is no cloud deployment, no authentication service, and no external database.

## Monorepo Structure

```
git-data-explorer/
├── packages/
│   ├── main/        # Main app — GitHub API collection, SQLite, dashboard UI
│   ├── shared/      # Shared types, UI components, utilities (used by both main + research)
│   └── research/    # Research tool — import bundles, cross-org analysis
├── eslint.config.js   # ESLint flat config (typescript-eslint, asChild ban)
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
│  Drizzle ORM schema (12 tables)                         │
└──────────────────────────────────────────────────────────┘
```

## Layer Responsibilities

### Main App Frontend (`packages/main/src/client/`)

Single-page React app using hash-based routing (`#/dashboard`, `#/landing`, `#/repos`, `#/collection`, `#/settings`). Default route (`#/`) goes to Dashboard. Full dark mode support via `useTheme` hook with localStorage persistence.

- **Pages:** Each page is a self-contained component that fetches its own data via TanStack Query hooks
- **Dashboard:** Primary view with FilterBar, 9 chart sections (Executive Summary, Team Distribution, Cohort Trends, **Contribution Patterns**, Ramp-Up Curves, Before/After Comparison, PR Turnaround, Rolling Comparisons, Bot vs Human Ratio) plus a Contributor Table, stat callout boxes, rich help panels, filter scope badges, Chart|Table toggles on most chart sections, and collapsible contributor table with 15 before/after AI delta columns
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
- `analytics.ts` — 16 analytics endpoints: marker, cohort-config, cohorts (commits+prs), rampup, rolling, contributors, contributors/before-after, pr-turnaround, bot-ratio, summary, period-metrics (replaces before-after), concentration, headcount, **developer-monthly** (Phase 9.5)
- `export.ts` — `POST /api/export` → builds ExportBundle (12 analytics sections including the 3 Phase 9.4 additions and the Phase 9.5 `developerMonthly`)
- `share.ts` — `POST /api/share/gist`, `POST /api/share/http`, `GET /api/share/reachability`

### Research Tool Frontend (`packages/research/client/`)

Single-page React app using hash-based routing. Three pages:

- **ImportPage** (`#/import`) — 4-tab import source selector: Local File (ZIP/JSON drag-drop), GitHub Gist URL, HTTP/Cloud URL, Batch Directory path; cross-org duplicate warnings shown in unified banner with "Continue to dashboard" button (auto-redirect suppressed when warnings present)
- **OrgDashboard** (`#/org/:orgId`) — Per-org trend charts using imported snapshot data; sidebar shows all imported orgs with snapshot counts; "Imported" badge on data sections; collapsible OrgMetadataForm for editing label and sizeCategory with sonner toast feedback
- **CrossOrgPage** (`#/cross-org`) — Checkbox org selector, aggregated charts across selected orgs, Weighted vs Equal Weight mode toggle

### Research Tool Backend (`packages/research/server/`)

Hono HTTP server. No GitHub API dependency — all data from imported ExportBundle files.

**Migration management (Phase 9.4.3, MIG-01 / MIG-02):**
- The research DB is managed via drizzle-kit migrations at `packages/research/drizzle/migrations/`. Startup calls `runMigrations()` (see `server/db/migrate.ts`) instead of the old raw `sqlite.exec(...DDL...)` block.
- Migration `0000_initial.sql` is authored as the LEGACY+CURRENT union — it includes the pre-9.4 columns (`industry`, `ai_tool`, `before_after_json`) so both fresh installs and the existing `packages/research/data/research.db` apply it without failing on "table already exists".
- Migration `0001_drop_legacy_columns.sql` drops the 3 legacy columns.
- `bootstrapMigrationJournal()` handles four legacy-DB states (all columns present, partially migrated, fully migrated, fresh install) by pre-seeding `__drizzle_migrations` so drizzle skips migrations that have effectively already run.
- `packages/research/server/__tests__/schema-parity.test.ts` asserts that every table's runtime columns match `server/db/schema.ts` exactly, failing CI on silent schema drift. `drizzle-journal-shape.test.ts` machine-verifies the `__drizzle_migrations` journal schema at the installed drizzle-orm version.

**Security subsystem (Phase 9.4.3):**
- `services/url-safety.ts` — pre-DNS URL parse, scheme allowlist, IPv4/IPv6 blocked-CIDR lists, `resolveAndValidateHost` that checks every `A`/`AAAA` record returned by DNS (SEC-05, T-09.4.3-01/06).
- `services/safe-fetch.ts` — undici `Agent` with a `connect` hook that re-validates the peer IP at TCP-connect time (DNS-rebinding defense) and `redirect: 'manual'` handling that re-runs `isSafeUrl` + `resolveAndValidateHost` on each hop (SEC-05, T-09.4.3-05).
- `services/path-safety.ts` — `sandboxPath(base, candidate)` uses `fs.realpath` + `startsWith(base + path.sep)` to reject `..`, absolute, and symlink-escape paths for the `POST /api/import/batch` endpoint (SEC-06, T-09.4.3-02). Requires `RESEARCH_IMPORT_BASE_DIR`.
- `@shared/lib/sql-safety.js` (file at `packages/shared/lib/sql-safety.ts`) — `assertIntegerArray(ids)` throws on non-integer input; `sqlIntList(ids)` returns a validated `"1,2,3"` literal for safe interpolation at `sql.raw` sites. Wired into every array site in `aggregation.ts`, all three analytics route handlers, and `packages/main/server/services/analytics-utils.ts` (symmetry: the main package's inline guard now delegates here so there's one implementation) (SEC-07, T-09.4.3-03).

**Routes** (`server/routes/`):
- `health.ts` — `GET /api/health`
- `import.ts` — `POST /api/import/file`, `POST /api/import/url`, `POST /api/import/batch` (URL endpoint uses `url-safety` + `safe-fetch`; batch endpoint uses `path-safety.sandboxPath`)
- `orgs.ts` — `GET /api/orgs`, `GET /api/orgs/:id`, `PATCH /api/orgs/:id`, `DELETE /api/orgs/:id`, `DELETE /api/orgs/:orgId/snapshots/:snapshotId`, `GET /api/orgs/:orgId/snapshots/:snapshotId/data`, `GET /api/orgs/:orgId/concentration`, `GET /api/orgs/:orgId/headcount`, `GET /api/orgs/:orgId/period-metrics`
- `analytics.ts` — `GET /api/analytics/cross-org/cohort-metrics`, `GET /api/analytics/cross-org/ramp-up`, `GET /api/analytics/cross-org/comparison` (integer params validated via `assertIntegerArray` before reaching aggregation service)

**Services** (`server/services/`):
- `import-service.ts` — ZIP parsing (fflate), bundle validation, org auto-creation, DB insertion, duplicate detection by SHA-256 content hash, cross-org duplicate detection (exact hash match + fuzzy match on overlapping owners/repos/dates). URL ingestion path uses `safeFetch` instead of raw `fetch`. When the caller passes `orgId=null` (the `/api/import/file` path), a contentHash match against any existing snapshot auto-attaches the new snapshot to that org rather than creating a parallel duplicate org — re-importing the same ZIP produces a new snapshot on the original org.
- `validation.ts` — Zod schema for ExportBundle; validates shape, warns on null/empty optional sections; backward-compatible with old toolVersion bundles
- `org-service.ts` — Org and snapshot CRUD (create, list, get, update, delete with cascade)
- `aggregation.ts` — Cross-org aggregation engine: `getAggregatedCohortMetrics`, `getAggregatedRampUp`, `getOrgComparisonTable`; uses latest snapshot per org. All `sql.raw` sites use `sqlIntList` for array ids + `Number.isSafeInteger` guards for scalar ids.
- `test-data-generator.ts` — Synthetic ExportBundle generator (small startup, mid-size company, pre-AI baseline); used by tests. **Phase 9.4.2:** rebuilt around a single `ActivityProfile` per generated org — every section (concentration, headcount, bot ratio, period metrics) now derives from one synthetic activity source, so `topContributor` rotates across generated logins and cross-basis top-1 shares are consistent for dominant-window months. Each generator accepts a `GenerateOrgOptions` parameter with D-09 boolean toggles (`includeDominantWindow`, `includeBotStormMonth`, `includeTeamSizeStep`) defaulting per-orgType. `buildPeriodMetricsFromProfile` computes `avgCommitSize` / `prFrequency` / `activeContributors` from profile activity; `rampUpSpeed` stays a literal constant per D-08's hardcoded-for-now exemption (Phase 9.5 derives it properly).

### Shared Package (`packages/shared/`)

Code imported by both main and research frontends:
- `types.ts` — TypeScript interfaces (GitHubRepo, TrackedRepo, CohortMetricsRow, RampUpBucket, ContributorBeforeAfterStats, the Phase 9.4 additions: `Period`, `PeriodMetric`, `ConcentrationBasis`, `ConcentrationMonthlyRow`, `HeadcountMonthlyRow`, and the Phase 9.5 addition: `DeveloperMonthlyRow` — 8 fields per author per month, with mean/median pairs nullable when commitCount=0 for D-19 graceful "PR-only month" rendering)
- `export-types.ts` — ExportBundle, ExportMetadata (includes `orgName: string | null` inferred from repo owners), PrTurnaroundRow, BotRatioRow, ExecutiveSummary. Phase 9.4: `beforeAfter` field removed, replaced by `periodMetrics: PeriodMetric[] | null`, `concentrationMonthly: ConcentrationMonthlyRow[]`, `headcountMonthly: HeadcountMonthlyRow[]`. Phase 9.5: `developerMonthly: DeveloperMonthlyRow[]` added (Zod schema in `validation.ts` uses `.default([])` so pre-9.5 bundles still validate — D-17 graceful degradation). The analytics row types are inlined here (not imported from server) to keep shared free of server-only imports.
- `cohort-config.ts` — Single source of truth for cohort boundary definitions: `CohortThreshold`, `CohortConfig`, `DEFAULT_COHORT_CONFIG` (3mo/12mo thresholds), `getThresholdSeconds()` for SQL CASE WHEN generation
- `lib/periods.ts` — `buildPeriodsFromMarker(startDate, endDate, markerDate)` produces `Period[]`. No marker → length-1 All-time; single marker → length-2 Pre-AI/Post-AI. Phase 10 will add multi-marker paths via the same signature.
- `lib/narratives.ts` — `MetricOption`, `METRIC_OPTIONS`, and `CONCENTRATION_BASIS_OPTIONS` (PRs / Commits / Lines) for metric-selector tabs
- `components/charts/` — shared chart components: `CohortAreaChart`, `RampUpLineChart`, `RollingCards`, `BeforeAfterComparison` (Phase 9.4: rewired to `PeriodMetric[]`, handles length 0/1/2/>2), `TeamDistributionChart` (Recharts ComposedChart with dual Y-axis), `TeamDistributionTable` (TanStack Table with 8 columns), `ScaryRealPanel` (side-by-side total PRs + PRs/dev), and the Phase 9.5 per-developer trajectory family: `DeveloperMiniChart` (Recharts ComposedChart with monthly bars + cohort-relative dashed mean line + AI marker `ReferenceLine` + `connectNulls={false}` so null months render as gaps), `DeveloperTrajectoryGrid` (Layout A — small-multiples grid for ≤8 active devs; also exports `DEV_LAYOUT_THRESHOLD = 8` and `chooseDevLayout(activeDevs)` helpers), `DeveloperTrajectoryList` (Layout C — sortable list with inline-expand for >8 active devs; sortable columns are statically limited to Name and Tenure-Joined-Date via the `SortKey` union — volume metrics are physically unselectable per D-06), `DeveloperZoomModal` (shadcn Dialog with cohort 25–75 percentile band shading and 4 metric tabs). The 4 chart components live at `@shared` with thin re-export shims at `packages/main/client/components/charts/Developer*.tsx` so the main app's relative imports continue to resolve unchanged.
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

Separate SQLite database. 12 tables (Phase 9.4 adds 3 new and drops `before_after_json` from `snapshots`; Phase 9.5 adds `developer_monthly`).

| Table | Purpose |
|-------|---------|
| `orgs` | One row per imported org. `label`, `size_category`, `import_source` |
| `snapshots` | One row per imported bundle. Links to `orgs`. Stores `metadata_json`, `content_hash` (SHA-256 for dedup), `contributor_count`, `repo_count`, `ai_marker_date`, `executive_summary_json`. The `before_after_json` column was dropped in Phase 9.4 (D-13); the section is now stored in `period_metrics`. |
| `cohort_metrics` | Per-cohort, per-period, per-month metrics rows. `metric_type` = 'commits' or 'prs'. Linked to snapshot + org |
| `ramp_up` | New developer ramp-up data: `week_index`, `avg_lines_changed`, `join_period`. Per snapshot |
| `rolling_comparisons` | Rolling window comparison JSON blob (MoM/QoQ). One row per snapshot |
| `contributors` | Per-contributor before/after stats. `pre_json` and `post_json` store ContributorStats as JSON |
| `pr_turnaround` | Monthly PR merge time data. `avg_hours_to_merge`, `median_hours_to_merge`, `pr_count` |
| `bot_ratio` | Monthly bot vs human commit ratio data |
| `concentration_monthly` | **Phase 9.4.** One row per (snapshot, org, month, basis). Per-basis top-N share, HHI, Gini, bus factor, active devs, top contributor. Nullable share columns handle zero-activity months. |
| `headcount_monthly` | **Phase 9.4.** One row per (snapshot, org, month). Active dev count + normalized output (PRs/dev, commits/dev). |
| `period_metrics` | **Phase 9.4.** JSON blob column storing the `PeriodMetric[]` for a snapshot (same pattern as `rolling_comparisons`). Replaces the old `snapshots.before_after_json` column. |
| `developer_monthly` | **Phase 9.5.** One row per (snapshot, author, month). 8 columns: `author_login`, `period_month`, `pr_count`, `commit_count`, plus 4 nullable mean/median pairs for `lines_per_commit` and `files_per_commit` (null when `commit_count = 0` so the UI can distinguish a PR-only month from a low-output month). Per D-16, indexes are `(snapshot_id, period_month)` and `(snapshot_id, author_login)` — per-snapshot access pattern, intentionally different from sibling tables that index by `org_id`. |

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
                  → INSERT INTO developer_monthly (N rows)  ← Phase 9.5
              → Cross-org duplicate detection:
                  → Exact hash match against snapshots in other orgs
                  → Fuzzy match (overlapping owners, repoIds, date ranges)
              → Return { orgId, snapshotId, warnings, isDuplicate, crossOrgDuplicate?, fuzzyMatch? }
```

**Dedup behavior:** If the same content hash is imported twice for the same org, `isDuplicate=true` is returned with a warning, but the import proceeds and creates a new snapshot. This preserves history while flagging the duplicate.

**Cross-org duplicate detection (Phase 9.1):** On every import, two additional checks run against snapshots in *other* orgs:
1. **Exact match** — same SHA-256 `contentHash` found in another org's snapshot. Returns `crossOrgDuplicate: { otherOrgName, importedAt }`.
2. **Fuzzy match** — different hash but overlapping GitHub owners AND repoIds AND date ranges. Returns `fuzzyMatch: { otherOrgName, overlapReason, importedAt }`.
Both signals fire independently. Import proceeds regardless (warn-but-allow). The `ImportStatusBanner` shows an amber warning for cross-org duplicates.

**orgName in exports (Phase 9.1):** `ExportMetadata.orgName` is inferred from the `owner/repo` segments of `repoNames` at export time. Single owner becomes the orgName; multiple owners are joined alphabetically with `+`. An opt-out checkbox in ExportModal lets the user exclude it. On import, `orgName` is used as the default org label (replacing the previous first-repo-name fallback).

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

## ESLint Configuration

ESLint flat config (`eslint.config.js`) with `typescript-eslint` parser for JSX/TSX support. Key rules:
- `no-restricted-syntax` — bans `asChild` prop on `@base-ui/react` components (prevents regression of console warnings from using the Radix-style API on Base-UI components that use `render` prop instead)

Run with `npm run lint`.

## Testing

Vitest 4.x drives the test suite — **882 tests across 67 files** as of Phase 9.5. Two environments in a single config:

- **Node tests (default)** — server-side routes, services, import pipeline. Pattern: `vi.mock('../db/client.js', ...)` with in-memory `better-sqlite3`, dynamic route import, `app.request('/api/...')` via Hono. See `packages/main/server/__tests__/routes/analytics.test.ts` and `packages/research/server/__tests__/routes/orgs.test.ts`.
- **jsdom tests (opt-in)** — React component tests. Each test file declares `// @vitest-environment jsdom` at the top (vitest 4.x removed `environmentMatchGlobs`). Uses `@testing-library/react`, `@testing-library/jest-dom/vitest`, plus `ResizeObserver` and `getBoundingClientRect` polyfills for Recharts. Co-located under `packages/shared/components/charts/__tests__/` and `packages/*/client/__tests__/`.

Round-trip coverage: `packages/research/server/__tests__/round-trip-phase9.4.test.ts` exercises export → fflate ZIP → `parseZipBundle` → `importBundle` → Hono reconstruction with field-level equality assertions, so any future break in the Phase 9.4 data pipeline surfaces as a test failure.

## Recently Closed

- **Phase 9.5 — Contribution Patterns** — Per-developer monthly trajectories surfaced in BOTH the main dashboard and the research-tool OrgDashboard. New analytics service `getDeveloperMonthly(repoIds, periods)` (3-query hybrid: commit aggregates + PR counts + raw per-commit rows for in-memory median, since SQLite has no `MEDIAN()`) feeds a new `/api/analytics/developer-monthly` route. Export pipeline gains `developer-monthly.json`; the anonymizer pseudonymizes `developerMonthly[].authorLogin` with the SAME `pseudonymMap` used for `contributors[].authorLogin` (stable identity across sections). Research DB gains `developer_monthly` table (drizzle migration `0002_handy_roughhouse.sql`); reconstruct route `/api/orgs/:orgId/snapshots/:snapshotId/data` returns the `developerMonthly` section. UI: collapsed-by-default section on main dashboard with HelpPanel (D-10/D-11 verbatim 5-paragraph copy); always-expanded section on research OrgDashboard with HelpPanel (D-13 verbatim shorter copy) plus Cohort filter (Senior / Mid / Junior / All) and Min Activity slider (1–12 active months). 4 promoted chart components live at `@shared/components/charts/`; main-package paths preserved as thin re-export shims. Privacy invariants enforced statically: 0 `dangerouslySetInnerHTML`, 0 real-name reveal, no profile-page navigation, sort exclusion at the type level (`SortKey` union excludes volume metrics). Seed data exhibits 4 archetype trajectories — Steady, AI-Power-User, Plateauing, Declining — across both `seed.db` and the research test-data-generator.

- **Phase 9.4.3 (2026-04-21 external audit)** — 8 items closed: SSRF on `/api/import/url` (SEC-05), path sandbox on `/api/import/batch` (SEC-06), `sql.raw` integer guard across research + main (SEC-07), research DB drizzle-kit migration adoption (MIG-01, MIG-02), better-sqlite3 pin to `^11.10.0` and `@types/node` to `^22.19.17` (COMP-01, COMP-02), `export-service.ts` section-count comment + parity test (DOC-01).

## What's Not Built Yet

- **Settings UI for AI marker** — Currently API-only (`POST /api/analytics/marker`); no date picker in Settings page yet
- **Research tool: persisted org charts** — OrgDashboard renders aggregated data from the latest snapshot; time-series comparison across snapshots not yet implemented
- **Cycle time correction** — firstCommitAt on PRs for first-commit-to-merge measurement (Phase 9.6)
- **Cross-org Team Distribution aggregation** — Phase 9.4 added per-org concentration/headcount routes and tables; the CrossOrgPage aggregation path for these new sections is deferred to Phase 9.7
- **Individual onboarding profiles** — per-new-hire first-N-weeks breakdown (Phase 9.8)
- **Multi-marker AI timeline** — Phase 10 will supply length-N `Period[]` from an `ai_markers` table; the period-array data model is already in place so this becomes a thin schema + UI change

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
│   │   │   │   ├── PrTurnaroundChart.tsx
│   │   │   │   ├── BotRatioChart.tsx
│   │   │   │   └── charts/
│   │   │   │       ├── DeveloperMiniChart.tsx       # Phase 9.5: re-export shim → @shared/components/charts/
│   │   │   │       ├── DeveloperTrajectoryGrid.tsx  # Phase 9.5: re-export shim
│   │   │   │       ├── DeveloperTrajectoryList.tsx  # Phase 9.5: re-export shim
│   │   │   │       └── DeveloperZoomModal.tsx       # Phase 9.5: re-export shim
                                                     (most other charts live directly in packages/shared/components/charts/)
│   │   │   ├── hooks/
│   │   │   │   ├── useDashboardFilters.ts
│   │   │   │   ├── useCohortCommits.ts / useCohortPrs.ts
│   │   │   │   ├── useRampUp.ts / useRolling.ts
│   │   │   │   ├── useContributors.ts / useContributorBeforeAfter.ts
│   │   │   │   ├── useDeveloperMonthly.ts          # Phase 9.5: TanStack Query hook keyed on [startDate, endDate, repoIds]
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
│   │           ├── analytics-summary.ts
│   │           ├── analytics-concentration.ts    # Phase 9.4: top-N share, HHI, Gini, bus factor across prs/commits/lines
│   │           ├── analytics-headcount.ts        # Phase 9.4: active devs, PRs/dev, commits/dev
│   │           ├── analytics-period-metrics.ts   # Phase 9.4: replaces analytics-before-after; accepts Period[]
│   │           ├── analytics-developer-monthly.ts # Phase 9.5: getDeveloperMonthly(repoIds, periods) — 3-query hybrid; SQLite-side aggregates + TS-side median
│   │           ├── analytics-config.ts / analytics-utils.ts
│   │           ├── cohort-config-service.ts
│   │           ├── export-service.ts # buildExportBundle (12 analytics sections: cohortCommits, cohortPrs, rampUp, rolling, contributors, prTurnaround, botRatio, executiveSummary, periodMetrics, concentrationMonthly, headcountMonthly, developerMonthly)
│   │           └── first-commit-fetcher.ts
│   └── scripts/
│       └── seed.ts                   # Synthetic data generator (npm run seed). 34 personas (3 bots) across 3 repos. Phase 9.4.2 scenarios: `direct-devon` commit-only persona (zero PRs), `reviewer-riley` PR-reviewer persona (cross-month PRs, minimal commits), `lwilson` refactor wave (week 40, 250 deletion-heavy commits), `dependabot` bot storm (weeks 34-37, 14× commit rate).
│
├── shared/
│   ├── types.ts                      # Shared TypeScript interfaces (Phase 9.5: DeveloperMonthlyRow added)
│   ├── export-types.ts               # ExportBundle, ExportMetadata, etc. (Phase 9.5: developerMonthly field on ExportBundle)
│   ├── cohort-config.ts              # CohortConfig, DEFAULT_COHORT_CONFIG
│   ├── lib/utils.ts                  # cn() class merge helper
│   ├── lib/narratives.ts             # Phase 9.5: DEVELOPER_METRIC_OPTIONS (4 metric tabs: PRs / Commits / Lines per commit / Files per commit)
│   ├── lib/sql-safety.ts             # Phase 9.4.3: assertIntegerArray + sqlIntList for sql.raw guards (SEC-07)
│   ├── components/HelpPanel.tsx      # Phase 9.5: gained optional defaultOpen prop
│   ├── components/charts/Developer*.tsx  # Phase 9.5: 4 promoted chart components (MiniChart, TrajectoryGrid, TrajectoryList, ZoomModal)
│   └── components/ui/               # shadcn/ui primitives
│
└── research/
    ├── drizzle.config.ts              # Phase 9.4.3: drizzle-kit config (out='./drizzle/migrations', schema=server/db/schema.ts)
    ├── drizzle/
    │   └── migrations/                # Phase 9.4.3: drizzle-kit generated migrations (MIG-01)
    │       ├── 0000_initial.sql       # Baseline table DDL including pre-9.4 legacy columns
    │       ├── 0001_drop_legacy_columns.sql  # Drops industry, ai_tool, before_after_json (MIG-02)
    │       ├── 0002_handy_roughhouse.sql      # Phase 9.5: developer_monthly table + indexes
    │       └── meta/                  # _journal.json + per-migration snapshots
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
        ├── index.ts                  # Hono app (port 3002). Phase 9.4.3: sqlite.exec(...DDL...) block removed; startup now calls runMigrations()
        ├── db/
        │   ├── schema.ts             # Drizzle table definitions (12 tables: Phase 9.4 added concentration_monthly, headcount_monthly, period_metrics; Phase 9.5 added developer_monthly)
        │   ├── client.ts             # DB singleton (data/research.db)
        │   └── migrate.ts            # Phase 9.4.3: runMigrations() + bootstrapMigrationJournal() for legacy DB upgrades
        ├── routes/
        │   ├── health.ts / import.ts / orgs.ts / analytics.ts
        └── services/
            ├── import-service.ts     # ZIP/JSON ingestion, validation, DB write, cross-org dup detection. Phase 9.4.3: URL fetch now via safeFetch
            ├── validation.ts         # Zod ExportBundle schema (orgName optional for backward compat)
            ├── org-service.ts        # Org/snapshot CRUD
            ├── aggregation.ts        # Weighted/normalized cross-org aggregation. Phase 9.4.3: all sql.raw array sites via sqlIntList; scalar sites guarded by Number.isSafeInteger
            ├── url-safety.ts         # Phase 9.4.3: isSafeUrl + resolveAndValidateHost for SSRF defense (SEC-05)
            ├── safe-fetch.ts         # Phase 9.4.3: undici Agent connect-hook + manual-redirect re-validation (SEC-05)
            ├── path-safety.ts        # Phase 9.4.3: sandboxPath realpath + startsWith(base + sep) (SEC-06)
            └── test-data-generator.ts  # Synthetic org bundle generator
```
