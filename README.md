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

**Phase 4.1 of 5 complete** — Codebase Hardening

What works today:
- Local Hono API server + Vite React SPA, started with a single `npm run dev`
- SQLite database with full schema (repos, commits, PRs, authors, collection cursors)
- GitHub PAT authentication with settings UI
- Browse all repos your token has access to, grouped by owner
- Select/deselect repos to track with search, select all/unselect all
- Stop tracking and delete cached data with confirmation
- Landing page with status overview and collection progress
- **Incremental data collection** — reverse-chronological month-window fetching with rate-limit handling, pause/resume, and SSE progress streaming
- **Configurable collection depth** — choose how many months of history to collect
- **Bot detection** — automatic bot author identification and exclusion
- **Cohort assignment engine** — dynamic 0-3mo, 3-12mo, 1yr+ tenure bucketing based on data-point timestamps (not today's date), with both global and per-repo tenure modes
- **AI adoption marker** — set a date to split all analytics into before/after periods
- **Ramp-up curve analysis** — weekly contribution trajectories for new developers' first 12 weeks, grouped by join period for cross-cohort comparison
- **Rolling window comparisons** — month-over-month and quarter-over-quarter with partial-period normalization
- **Analytics API** — 6 REST endpoints exposing all analytics services with Zod validation
- **Hardened analytics pipeline** — SQL injection guards on `sql.raw()` interpolation, Zod route validation for date params, Invalid Date protection, integer-only repoIds filtering
- **Reliable collection engine** — SSE status event handling, race condition guards, depth target sync, null safety on author upsert
- **Code quality** — shared `getCompleteRepoIds` utility (3 duplicates removed), dead code cleanup, 0 production npm audit vulnerabilities

What's next:
- **Phase 5:** Dashboard UI with trend charts, cohort visualizations, and drill-down exploration

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

### First Use

1. Go to **Settings** and enter your GitHub PAT
2. You'll be redirected to the **Repos** page
3. Select which repos to track and click **Save Selection**
4. The landing page will show your tracked repos

See [ARCHITECTURE.md](ARCHITECTURE.md) for technical details.

## License

Private — not for redistribution.
