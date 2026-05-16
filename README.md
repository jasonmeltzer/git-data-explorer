# Git Data Explorer

## Who This Is For

Engineering leaders who want to understand how AI coding tools (Copilot, Claude Code, Cursor, etc.) are changing code contribution patterns across their GitHub org. If you've adopted AI tools and want to see concrete data on what's actually changing — not just anecdotes — this is for you.

## What It Does

Git Data Explorer connects to the GitHub API, incrementally caches commit and PR data in a local SQLite database, and presents trend dashboards showing how contributions are evolving over time.

Key analyses:
- **PR and commit size trends** — Are PRs getting larger? More files per commit? How has the shape of contributions changed?
- **New developer ramp-up** — How quickly do new devs reach meaningful contribution sizes? Is AI accelerating onboarding?
- **Cohort analysis by tenure** — Group contributors by experience (0-3mo, 3-12mo, 1yr+) to see how different groups are affected
- **Before/after comparison** — Set a marker date ("when we adopted AI") to compare periods
- **Rolling trend views** — Month-over-month and quarter-over-quarter patterns

## Why This Exists

After adopting Claude Code, the founder saw dramatic shifts in contribution patterns that were hard to quantify without tooling. This project makes that analysis accessible to any engineering leader with GitHub repos.

**This is a trend analysis tool, not a productivity tracker.** All views default to cohort aggregates. It shows how contributions are changing across your org, not how individuals are performing. The framing, UI language, and default views are deliberately designed to reinforce this.

## Why Local-First

- **Your data stays on your machine** — no cloud dependency, no third-party access to your commit history
- **No account or subscription** — clone, run, explore
- **Works offline** after initial data collection
- **Handles GitHub rate limits gracefully** — collects what it can, pauses, resumes next session

## Current Status

**Phase 9.6 complete** — Cycle Time Correction. Cycle time is now measured as **first commit to merge** (matching the LDX3 methodology), replacing the prior open-to-merge approximation. PRs gain a new nullable `pull_requests.first_commit_at` column populated during collection via `GET /pulls/:n/commits`. `analytics-pr-turnaround.ts` was rewritten end-to-end: filters `WHERE first_commit_at IS NOT NULL AND merged_at > first_commit_at` (D-05 + D-10 sanity guard), applies a configurable per-PR outlier cap (`cycle_time_max_days` app_config, default 90), excludes bot-authored PRs (Phase 9.4 D-23 `is_bot = 0` convention), computes a true median in TypeScript via sort + lower-midpoint indexing (replacing the legacy "median is actually AVG" approximation noted in GAP-10), and returns the new 5-field `PrTurnaroundRow` shape `{ periodMonth, medianHoursToMerge, avgHoursToMerge, prCount, totalPrCount }` per D-07. The chart UI surfaces a small coverage caveat ("based on X of Y PRs in window") when `prCount < totalPrCount` — self-cleaning once backfill is complete. Settings page gains a **Cycle Time Analytics** card with a numeric input for the outlier cap (clamped 1–365 days, applied at query time so changes take effect immediately for D.Eng sensitivity analysis). Export bundle, research-DB `pr_turnaround` table (drizzle migration `0003_naive_callisto.sql` adds `total_pr_count`), import-service, validation Zod schema, and `test-data-generator` org archetypes (pre-AI ~24h vs post-AI ~6h cycle times) all evolved to the D-07 shape. Methodology divergence from LDX3 (D-02): firstCommitAt = `MIN` across all PR commits of `MIN(authoredDate, committedDate)` — LDX3 uses `committedDate` only. The divergence preserves true "work started" timing through rebases (LDX3's pure committedDate resets to rebase time and biases cycle time short for long-running branches); the divergence is documented inline in `analytics-pr-turnaround.ts` and the helper `pr-first-commit.ts`. Legacy PRs collected before Phase 9.6 have NULL first_commit_at; to backfill, run `cd packages/main && npm run backfill-pr-first-commits` (one-shot CLI script per D-12 path b — iterates NULL rows, calls `fetchPrFirstCommit`, persists via prepared UPDATE; fail-soft per-PR; idempotent — safe to re-run).

**Phase 9.5 complete** — Contribution Patterns: per-developer monthly trajectories surfaced in BOTH the main dashboard and the research-tool OrgDashboard. Each contributor is rendered as a Recharts mini-chart of monthly bars (PRs / Commits / Lines per commit / Files per commit) with a cohort-relative dashed mean overlay and the AI-marker reference line. Click any chart to open a shadcn Dialog with a larger view, the cohort 25–75 percentile band shading, and all 4 metric tabs. Layout adapts to active-dev count: ≤8 → small-multiples grid (Layout A); >8 → list with inline-expand (Layout C). The new analytics service `getDeveloperMonthly(repoIds, periods)` derives the rows from existing commit/PR tables (3-query hybrid: commit aggregates + PR counts + raw per-commit rows for in-memory median since SQLite has no `MEDIAN()`); a new `developer_monthly` table on the research DB persists imported bundles. The export pipeline gains a `developer-monthly.json` section that the anonymizer pseudonymizes with the SAME `pseudonymMap` used for `contributors[].authorLogin` (stable identity across sections). Privacy framing is reinforced at the component level: section title is exactly "Contribution Patterns" (never "Productivity"), no "show real name" toggle exists, no `dangerouslySetInnerHTML`, no per-developer profile-page navigation, and Layout C's sortable columns are limited to Name and Tenure-Joined-Date — volume metrics are statically excluded from the sort union. Research-tool variant is always-expanded with two extra filters: a Cohort dropdown (Senior / Mid / Junior / All, default All) and a Min Activity slider (1–12 active months, default 1). Cross-package strategy: 4 chart components live in `packages/shared/components/charts/Developer*.tsx` with thin re-export shims at the original main-package paths (no new tsconfig path mappings). Seed data exhibits 4 distinct archetype trajectories — Steady, AI-Power-User, Plateauing, Declining — across both main `seed.db` and the research `test-data-generator`. Added 13 new vitest assertions across `DeveloperTrajectoryGrid.test.tsx` (6) and `OrgDashboardContribPatterns.test.tsx` (7) pinning D-06 sort exclusion, D-13 verbatim HelpPanel copy, D-15 filter options + slider range, and the privacy invariants. Net add: ~570 LOC across 9 modified files plus 1 new analytics service, 1 new route, 1 new TanStack Query hook, 1 Drizzle schema entry, 1 SQL migration, and 4 promoted chart primitives.

**Phase 9.4.3 complete** — Security and research schema hardening. Closes 8 items from the 2026-04-21 external audit with regression tests so each class of issue fails loudly in CI if reintroduced. (1) SSRF mitigation on `POST /api/import/url` via pre-DNS URL validation, DNS all-records check, and an undici Agent with connect-hook re-validation (DNS-rebinding defense) plus per-hop manual redirect handling (SEC-05). (2) Path sandbox on `POST /api/import/batch` via `realpath` + `startsWith(base + sep)` check (SEC-06). (3) Shared `assertIntegerArray` / `sqlIntList` module wired into every `sql.raw` site in `packages/research/server/services/aggregation.ts` and at the analytics route boundaries; the duplicate inline guard in `packages/main/server/services/analytics-utils.ts` now delegates to the shared primitive (SEC-07). (4) Research DB now managed via drizzle-kit migrations — the startup `sqlite.exec(...DDL...)` block was removed in favor of `runMigrations()`, with a `bootstrapMigrationJournal()` helper that handles four legacy-DB states so fresh installs AND the existing `packages/research/data/research.db` upgrade cleanly (MIG-01, MIG-02). (5) `better-sqlite3` pinned to `^11.10.0` and `@types/node` aligned to `^22.19.17` per CLAUDE.md Node 22 LTS target (COMP-01, COMP-02). (6) `export-service.ts` header comment corrected from "8 dashboard data sections" to "11"; a doc-code parity test compares the documented count against `Object.keys(ExportBundle).length - 1` so future field drift fails CI (DOC-01). Added ~120 new tests: url-safety, safe-fetch, path-safety, import-ssrf, import-batch-sandbox, analytics-integer-guard, fresh-install-migration, migration-bootstrap, schema-parity, drizzle-journal-shape (A2 verification), sql-safety rejection matrix, export-service-parity.

**Phase 9.4.2 complete** — Seed sample data robustness. Extended `packages/main/scripts/seed.ts` with 4 new scenarios that exercise Phase 9.4 UI code paths previously unreachable from seeded data: a commit-only persona (`direct-devon` — commits but zero PRs, exercises ScaryRealPanel's zero-PR null guard), a PR-reviewer persona (`reviewer-riley` — many PRs spanning month boundaries with minimal own commits, exercises D-10 merged_at author-set semantics), a refactor wave (`lwilson` week-40 deletion burst producing a month with ≥70% top-1 lines share and <40% commits share — the HelpPanel "lines are dominated by refactors" caveat), and a bot storm (dependabot 14× weeks 34-37 producing a ≥50% bot-share month). Research tool's `test-data-generator.ts` reworked around a single `ActivityProfile` concept so concentration/headcount/botRatio/periodMetrics derive from one synthetic activity source — `topContributor` rotates (no more hardcoded "Amber Bear"), periodMetrics computed from profile activity (no more literal 150/180), and D-09 boolean toggles (`includeDominantWindow`, `includeBotStormMonth`, `includeTeamSizeStep`) expose per-scenario controls on each generator. Added 21 new tests: 12 seed assertions in `packages/main/scripts/__tests__/seed.test.ts` (commit-only, PR-reviewer, refactor-wave, bot-storm, D-16 non-overlap regression) and 9 regression guards in `packages/research/server/__tests__/test-data-gen.test.ts`.

**Phase 9.4.1 complete** — Test coverage completion for Phase 9.4. Added 173 tests (from 521 to 694 across 53 files): route integration tests for all 6 new HTTP endpoints (main + research), unit tests for 4 shared chart components (TeamDistributionChart/Table, ScaryRealPanel, BeforeAfterComparison's four render branches), hook tests for the 3 new DashboardPage `useQuery` calls, and an end-to-end bundle round-trip (export → ZIP → import → DB → reconstruct) verifying Phase 9.4 data sections survive the pipeline with exact field equality. First jsdom component tests in the repo — `@testing-library/react` + `@vitest-environment jsdom` docblock pattern established.

**Phase 9.4 complete** — Team Distribution section with concentration risk metrics (top-N share, HHI, Gini, bus factor), headcount-normalized output, and the period-array data model that will carry forward through Phases 9.5–10. BeforeAfterComparison rewired to consume `PeriodMetric[]`; export bundle gains `concentrationMonthly`, `headcountMonthly`, `periodMetrics` sections.

What works today:

### Main App (`packages/main/`)
- Local Hono API server + Vite React SPA, started with a single `npm run dev`
- SQLite database with full schema (repos, commits, PRs, authors, collection cursors)
- GitHub PAT authentication with settings UI
- Browse all repos your token has access to, grouped by owner
- Select/deselect repos to track with search, select all/unselect all
- Stop tracking and delete cached data with confirmation
- **Incremental data collection** — reverse-chronological month-window fetching with rate-limit handling, pause/resume, and SSE progress streaming
- **Configurable collection depth** — slider capped at actual GitHub repo age, choose how many months of history to collect
- **Bot detection** — automatic bot author identification and exclusion
- **Dashboard with trend charts** — PR size trends and commit size trends as stacked area charts with colorblind-safe cohort layers (blue/teal/amber)
- **Multiple size signals** — switch between Count, Lines Added, Lines Deleted, and Files Changed on any chart
- **AI adoption marker** — dashed purple line on charts showing when AI tools were adopted
- **New developer ramp-up curves** — line chart comparing contribution trajectories across join periods
- **Rolling period comparison** — metric cards with change percentages, month-over-month and quarter-over-quarter toggle
- **Date range filtering** — preset chips (90d, 6mo, 1yr, All) plus custom date range picker
- **Repo filtering** — multi-select dropdown filters all dashboard views
- **Contributor drill-down** — collapsible table with sortable per-author stats; per-repo mode shows one row per author-repo pair with Repo column, visual row grouping, and per-repo tenure
- **Team Distribution section** — concentration risk visualization (top-1/3/5 share bars with HHI overlay line), "Scary/Real" dual panel (total PRs + PRs/dev overlay), sortable table with Gini and bus factor, metric selector (PRs / Commits / Lines), StatCalloutRow showing Bus Factor / Top Contributor Share / Active Developers
- **Period-array data model** — replaces single before/after split with `PeriodMetric[]` across the export bundle and UI; length-1 for no-marker, length-2 for single-marker, length-N ready for Phase 10 multi-marker
- **Cycle time (first commit to merge)** — true median (TypeScript sort + lower-midpoint, no SQL approximation), configurable outlier cap (Settings → Cycle Time Analytics → Outlier cap days, default 90, applied at query time), coverage caveat surfaces when not all PRs in the window have first-commit data, bot-authored PRs excluded
- **10-section dashboard** — Executive Summary KPI tiles, Team Distribution, Cohort Trends, Contribution Patterns (per-developer trajectories), Ramp-Up Curves, Before/After Comparison, PR Turnaround, Rolling Comparisons, Bot vs Human Ratio, Contributor Table
- **Data Export** — full dashboard data exported as CSV or JSON in a ZIP bundle with anonymization
- **Optional sharing** — post-export sharing invitation via GitHub Gist (private), HTTP endpoint, or manual file download
- **882 passing tests** across 67 test files (including D-16, Phase 9.4.2 seed-scenario assertions when `npm run seed` has run, the Phase 9.4.3 security + migration regression suite, and the Phase 9.5 per-developer trajectory + CSV/JSON export parity tests)

### Research Tool (`packages/research/`)
A personal research tool for cross-org AI adoption analysis. No GitHub token required — imports pre-exported bundles from the main app.

- **Import pipeline** — 4 sources: Local File (ZIP/JSON), GitHub Gist URL, HTTP/Cloud URL, Batch Directory
- **Org management** — each imported bundle creates an org entry; rename and set size category from OrgDashboard via collapsible metadata form with toast feedback
- **Snapshot history** — multiple imports per org tracked as snapshots; compare over time
- **Cross-org comparison** — select 2+ orgs, compare aggregated metrics side-by-side
- **Two aggregation modes** — Weighted (larger orgs count more) and Equal Weight (each org counts once)
- **No GitHub token required** — works entirely from imported export bundles
- **Cross-org duplicate detection** — warns when the same bundle (exact hash match) or similar data (fuzzy match on overlapping owners, repos, and date ranges) is imported across different orgs; unified warning banner with conditional redirect and "Continue to dashboard" button
- **orgName in exports** — org name automatically inferred from GitHub repo owners at export time, used as default org label on import; opt-out checkbox in ExportModal
- **Simplified schema** — orgs table stores only label and sizeCategory (dropped unused industry/aiTool columns)
- **Team Distribution section** — minimal concentration chart + sortable table on OrgDashboard per D-15 (no ScaryRealPanel); three new tables (`concentration_monthly`, `headcount_monthly`, `period_metrics`) ingested from imported bundles
- **Period-array import** — `parseZipBundle` reads `period-metrics.json`, `concentration-monthly.json`, `headcount-monthly.json`; old `before-after.json` fully removed
- **Contribution Patterns section (always-expanded)** — same per-developer trajectory rendering as the main app, plus two research-only filters: Cohort dropdown (Senior / Mid / Junior / All) and Min Activity slider (1–12 active months). Reads `developer_monthly` rows from the imported bundle; pseudonyms (animal names) flow through unchanged.

### Monorepo Structure
The project is organized as an npm workspaces monorepo:
- `packages/main/` — main app (Hono server + Vite SPA, port 3001/5173)
- `packages/shared/` — shared types, UI components (shadcn/ui), chart components, utilities
- `packages/research/` — research tool (Hono server + Vite SPA, port 3002/5174)

### Code Quality
- **ESLint configured** — flat config with typescript-eslint parser; includes `no-restricted-syntax` rule banning `asChild` prop on `@base-ui/react` components (prevents regression of resolved console warnings)
- **882 passing tests** across 67 test files (including D-16, Phase 9.4.2 seed-scenario assertions when `npm run seed` has run, the Phase 9.4.3 security + migration regression suite, and the Phase 9.5 per-developer trajectory + CSV/JSON export parity tests)

What's next:
- **Phase 9.7: Research Tool Enhancements** — cross-org period-array aggregation, CrossOrg Team Distribution parity, research-tool HelpPanel copy update for the cycle-time card, Chart|Table toggle for cycle-time
- **Phase 9.8: Individual Onboarding Profiles** — per-new-hire first-N-weeks breakdown
- **Phase 10: Multi-Marker AI Timeline** — multiple AI tool adoption events (now thin migration since the period-array model is in place)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24 LTS |
| Language | TypeScript 5 |
| Frontend | React 19, Vite 8, Tailwind CSS 4, shadcn/ui |
| Backend | Hono 4 |
| Database | SQLite via better-sqlite3 ^12.9.0, Drizzle ORM (drizzle-kit migrations for the research DB since 9.4.3) |
| GitHub API | @octokit/rest 21 with throttling plugin |
| Data fetching | TanStack Query 5 |
| Testing | Vitest |

## Project Structure

```
packages/
├── main/           # Main app — GitHub API collection + dashboard UI
│   ├── src/
│   │   ├── client/ # React SPA (pages, hooks, components, charts)
│   │   └── server/ # Hono API (routes, services, DB)
│   └── scripts/    # Seed data generator
│
├── shared/         # Shared across main + research
│   ├── types.ts    # TypeScript interfaces
│   ├── export-types.ts  # ExportBundle type
│   ├── cohort-config.ts # Cohort boundary definitions
│   └── components/ # shadcn/ui primitives
│
└── research/       # Research tool — cross-org AI adoption analysis
    ├── client/     # React SPA (ImportPage, OrgDashboard, CrossOrgPage)
    └── server/     # Hono API (import pipeline, aggregation engine)
        ├── services/
        │   ├── import-service.ts    # ZIP/JSON bundle ingestion
        │   ├── aggregation.ts       # Weighted/normalized cross-org aggregation
        │   ├── org-service.ts       # Org and snapshot CRUD
        │   ├── validation.ts        # Zod schema for ExportBundle
        │   └── test-data-generator.ts  # Synthetic org bundles for testing
        └── __tests__/              # 76 tests across 8 test files
```

## Getting Started

### Prerequisites

- Node.js 24.x LTS (pinned via `.nvmrc` and `engines.node`)
- A GitHub Personal Access Token with `repo` scope (for the main app; not needed for research tool)

### Setup

```bash
git clone <this-repo>
cd git-data-explorer
npm install
```

### Run the Main App

```bash
npm run dev
```

This starts both the API server (port 3001) and the Vite dev server (port 5173). Open http://localhost:5173 in your browser.

### Run the Research Tool

```bash
npm run research
```

This starts the research tool API server (port 3002) and Vite dev server (port 5174). No GitHub token required. Open http://localhost:5174 in your browser.

#### Research tool environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `RESEARCH_PORT` | Hono server port | `3002` |
| `RESEARCH_DB_PATH` | SQLite DB path | `./packages/research/data/research.db` |
| `RESEARCH_IMPORT_BASE_DIR` | **Required** for `POST /api/import/batch`. Paths submitted to the batch import endpoint are sandboxed to this directory (no traversal or symlink escape). If unset, batch import returns HTTP 400. | _(unset — must be configured)_ |

### Try It Without GitHub

```bash
npm run seed        # Generate realistic fake data for the main app
npm run dev:seed    # Start the main app with seed data
```

Open http://localhost:5173 — all dashboard views populated with synthetic data (3 repos, 34 contributors, AI adoption inflection point).

### Run Tests

```bash
npm run test        # Run all tests across workspaces (882 tests, 67 files)
```

### First Use (main app, with real data)

1. Go to **Settings** and enter your GitHub PAT
2. You'll be redirected to the **Repos** page
3. Select which repos to track and click **Save Selection**
4. Go to the **Collection** page, set your depth, and start collection
5. Once data is collected, the **Dashboard** shows trend charts automatically

### Using the Research Tool

1. Start the main app, open the Dashboard, use **Export Data** to download a ZIP bundle
2. Start the research tool (`npm run research`), open http://localhost:5174
3. On the **Import** page, upload the ZIP via the "Local File" tab
4. View trends on the **Org Dashboard** page
5. Import bundles from other orgs and compare them on the **Cross-Org** page

See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details.

## License

Private — not for redistribution.
