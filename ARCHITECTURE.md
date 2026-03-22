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
│  │  │  Page    │ │  Page    │ │     Page           │ │  │
│  │  └─────────┘ └──────────┘ └────────────────────┘ │  │
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
│  └─────────────────────┼─────────────────────────────┘  │
│  ┌─────────────────────┼─────────────────────────────┐  │
│  │  Services                                          │  │
│  │  token.ts  octokit.ts  github-repos.ts             │  │
│  │  repo-management.ts                                │  │
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
- `settings.ts` — `GET/POST /api/settings/token` — PAT management
- `repositories.ts` — 7 endpoints for repo CRUD, GitHub browsing, stop/delete

**Services** (`src/server/services/`):
- `token.ts` — Reads/writes the GitHub PAT from `.env` file
- `octokit.ts` — Creates Octokit client instances with throttling plugin. Reads token fresh per call (no stale singleton)
- `github-repos.ts` — Lists all repos accessible to the authenticated user via paginated API calls
- `repo-management.ts` — SQLite CRUD for tracked repos, including soft-delete (stop tracking) and hard-delete (remove all data + orphan author cleanup)

### Shared (`src/shared/`)

Code imported by both frontend and backend:
- `types.ts` — TypeScript interfaces for API request/response shapes (GitHubRepo, TrackedRepo, AvailableReposResponse, RepoDeleteCounts)
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
| `collection_state` | Cursor tracking for incremental API collection — stores last page/SHA per repo per resource type |

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

## What's Not Built Yet

- **Data collection engine** (Phase 3) — The `collection_state` table and cursor schema exist but no collection logic yet
- **Query/analytics layer** (Phase 4) — No cohort assignments, AI markers, or aggregate queries
- **Dashboard UI** (Phase 5) — No charts or trend visualization

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
│   │   ├── settings.ts       # GET/POST /api/settings/token
│   │   └── repositories.ts   # 7 repo endpoints
│   └── services/
│       ├── token.ts          # PAT read/write from .env
│       ├── octokit.ts        # Octokit factory with throttling
│       ├── github-repos.ts   # GitHub API repo listing
│       └── repo-management.ts # SQLite repo CRUD
└── shared/
    ├── types.ts              # Shared TypeScript interfaces
    ├── lib/utils.ts          # cn() class merge helper
    └── components/ui/        # shadcn/ui primitives
```
