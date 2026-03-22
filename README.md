# Git Data Explorer

A local-first web application for engineering leaders to understand how AI tools are changing code contribution patterns across their GitHub repositories.

Connect to the GitHub API, cache commit and PR data in a local SQLite database, and explore trend dashboards showing how the nature of code changes is evolving over time.

**This is a trend analysis tool, not a productivity tracker.** All views default to cohort aggregates — it shows how contributions are changing, not how individuals are performing.

## Current Status

**Phase 2 of 5 complete** — Auth & Repo Management

What works today:
- Local Hono API server + Vite React SPA, started with a single `npm run dev`
- SQLite database with full schema (repos, commits, PRs, authors, collection cursors)
- GitHub PAT authentication with settings UI
- Browse all repos your token has access to, grouped by owner
- Select/deselect repos to track with search, select all/unselect all
- Stop tracking and delete cached data with confirmation
- Landing page with status overview

What's next:
- **Phase 3:** Incremental GitHub data collection with rate-limit handling and checkpointing
- **Phase 4:** Analytics query layer with cohort assignments and AI markers
- **Phase 5:** Dashboard UI with trend charts and drill-down exploration

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

## Project Structure

```
src/
├── client/           # React SPA
│   ├── components/   # NavBar, shared components
│   └── pages/        # LandingPage, ReposPage, SettingsPage
├── server/           # Hono API server
│   ├── routes/       # API route handlers
│   ├── services/     # Business logic (GitHub, repos, auth)
│   └── db/           # Drizzle schema and migrations
└── shared/           # Types and UI components shared across client/server
    ├── components/ui/ # shadcn/ui primitives
    └── types.ts       # Shared TypeScript interfaces
```

## License

Private — not for redistribution.
