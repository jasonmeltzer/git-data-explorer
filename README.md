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

**Phase 9 complete** — Import & Explore Research Tool (monorepo migration + cross-org analysis)

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
- **8-section dashboard** — Executive Summary KPI tiles, Cohort Trends, Ramp-Up Curves, Before/After Comparison, PR Turnaround, Rolling Comparisons, Bot vs Human Ratio, Contributor Table
- **Data Export** — full dashboard data exported as CSV or JSON in a ZIP bundle with anonymization
- **Optional sharing** — post-export sharing invitation via GitHub Gist (private), HTTP endpoint, or manual file download
- **410 passing tests** across 34 test files

### Research Tool (`packages/research/`)
A personal research tool for cross-org AI adoption analysis. No GitHub token required — imports pre-exported bundles from the main app.

- **Import pipeline** — 4 sources: Local File (ZIP/JSON), GitHub Gist URL, HTTP/Cloud URL, Batch Directory
- **Org management** — each imported bundle creates an org entry; name and categorize orgs
- **Snapshot history** — multiple imports per org tracked as snapshots; compare over time
- **Cross-org comparison** — select 2+ orgs, compare aggregated metrics side-by-side
- **Two aggregation modes** — Weighted (larger orgs count more) and Equal Weight (each org counts once)
- **No GitHub token required** — works entirely from imported export bundles

### Monorepo Structure
The project is organized as an npm workspaces monorepo:
- `packages/main/` — main app (Hono server + Vite SPA, port 3001/5173)
- `packages/shared/` — shared types, UI components (shadcn/ui), chart components, utilities
- `packages/research/` — research tool (Hono server + Vite SPA, port 3002/5174)

What's next:
- **Settings UI for AI marker** — currently API-only; a date picker in Settings would make it more discoverable

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

Open http://localhost:5173 — all dashboard views populated with synthetic data (3 repos, 31 contributors, AI adoption inflection point).

### Run Tests

```bash
npm run test        # Run all tests across workspaces (410 tests, 34 files)
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
