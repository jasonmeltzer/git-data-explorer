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

**Phase 7 complete** — Synthetic Test Data

What works today:
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
- **Date range filtering** — preset chips (30d, 90d, 6mo, 1yr, All) plus custom date range picker
- **Repo filtering** — multi-select dropdown filters all dashboard views
- **Contributor drill-down** — collapsible table with sortable per-author stats, collapsed by default to maintain privacy-first framing
- **Narrative insights** — auto-generated plain-English trend summaries above each chart section
- **Cohort analysis** — dynamic 0-3mo, 3-12mo, 1yr+ tenure bucketing with global and per-repo modes
- **Analytics API** — 7 REST endpoints (cohorts, rampup, rolling, contributors, marker) with Zod validation
- **Hardened pipeline** — SQL injection guards, Invalid Date protection, integer-only repoIds filtering
- **Dark mode** — full dark mode support with theme toggle and localStorage persistence
- **Standalone Collection page** — dedicated page at #/collection, separated from repo selection
- **Semantic token migration** — zero hardcoded color classes, all pages use shadcn theme tokens
- **204 passing tests** across 17 test files
- **Synthetic seed data** — `npm run seed` generates realistic fake data (3 repos, ~31 contributors, ~9000 commits, ~650 PRs) for demo/testing without GitHub API access
- **Seed mode** — `npm run dev:seed` starts the app against seed data

What's next:
- **Phase 8:** Data export with contributor anonymization

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

## Getting Started

### Prerequisites

- Node.js 22.x LTS
- A GitHub Personal Access Token with `repo` scope

### Setup

```bash
git clone <this-repo>
cd git-data-explorer
npm install
```

### Run

```bash
npm run dev
```

This starts both the API server (port 3001) and the Vite dev server (port 5173). Open http://localhost:5173 in your browser.

### Try It Without GitHub

```bash
npm run seed        # Generate realistic fake data
npm run dev:seed    # Start the app with seed data
```

Open http://localhost:5173 — all dashboard views populated with synthetic data (3 repos, 31 contributors, AI adoption inflection point).

### First Use (with real data)

1. Go to **Settings** and enter your GitHub PAT
2. You'll be redirected to the **Repos** page
3. Select which repos to track and click **Save Selection**
4. Go to the **Collection** page, set your depth, and start collection
5. Once data is collected, the **Dashboard** shows trend charts automatically

See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details.

## License

Private — not for redistribution.
