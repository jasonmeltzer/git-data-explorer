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
- **9-section dashboard** — Executive Summary KPI tiles, Team Distribution, Cohort Trends, Ramp-Up Curves, Before/After Comparison, PR Turnaround, Rolling Comparisons, Bot vs Human Ratio, Contributor Table
- **Data Export** — full dashboard data exported as CSV or JSON in a ZIP bundle with anonymization
- **Optional sharing** — post-export sharing invitation via GitHub Gist (private), HTTP endpoint, or manual file download
- **715 passing tests** across 53 test files (including D-16 and Phase 9.4.2 seed-scenario assertions when `npm run seed` has run)

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

### Monorepo Structure
The project is organized as an npm workspaces monorepo:
- `packages/main/` — main app (Hono server + Vite SPA, port 3001/5173)
- `packages/shared/` — shared types, UI components (shadcn/ui), chart components, utilities
- `packages/research/` — research tool (Hono server + Vite SPA, port 3002/5174)

### Code Quality
- **ESLint configured** — flat config with typescript-eslint parser; includes `no-restricted-syntax` rule banning `asChild` prop on `@base-ui/react` components (prevents regression of resolved console warnings)
- **715 passing tests** across 53 test files (including D-16 and Phase 9.4.2 seed-scenario assertions when `npm run seed` has run)

What's next:
- **Phase 9.5: Contribution Patterns** — per-developer monthly time series with privacy framing
- **Phase 9.6: Cycle Time Correction** — first-commit-to-merge analytics
- **Phase 9.7: Research Tool Enhancements** — cross-org period-array aggregation, CrossOrg Team Distribution parity
- **Phase 9.8: Individual Onboarding Profiles** — per-new-hire first-N-weeks breakdown
- **Phase 10: Multi-Marker AI Timeline** — multiple AI tool adoption events (now thin migration since the period-array model is in place)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 LTS |
| Language | TypeScript 5 |
| Frontend | React 19, Vite 8, Tailwind CSS 4, shadcn/ui |
| Backend | Hono 4 |
| Database | SQLite via better-sqlite3 11, Drizzle ORM |
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

- Node.js 22.x LTS
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

### Try It Without GitHub

```bash
npm run seed        # Generate realistic fake data for the main app
npm run dev:seed    # Start the main app with seed data
```

Open http://localhost:5173 — all dashboard views populated with synthetic data (3 repos, 34 contributors, AI adoption inflection point).

### Run Tests

```bash
npm run test        # Run all tests across workspaces (715 tests, 53 files)
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
