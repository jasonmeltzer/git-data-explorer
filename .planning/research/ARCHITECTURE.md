# Architecture Research

**Domain:** Local-first desktop/web analytics app — GitHub API data collection + SQLite cache + visualization dashboard
**Researched:** 2026-03-22
**Confidence:** HIGH (Electron process model, IPC patterns, GitHub API rate limits from official docs; MEDIUM for cohort query architecture — derived from general SQL patterns)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RENDERER PROCESS                              │
│  (Chromium / React UI — no direct Node.js or DB access)             │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │  Auth / Repo │  │  Dashboard   │  │  Drill-down Explorer     │   │
│  │  Setup UI    │  │  (Charts)    │  │  (Filter / Cohort Views) │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────────┘   │
│         │                 │                      │                   │
│         └─────────────────┴──────────────────────┘                  │
│                           │ contextBridge API                        │
└───────────────────────────┼─────────────────────────────────────────┘
                            │ IPC (ipcRenderer.invoke / ipcMain.handle)
┌───────────────────────────┼─────────────────────────────────────────┐
│                    PRELOAD SCRIPT                                    │
│  Exposes safe, typed API surface via contextBridge                  │
│  (window.api.collectRepo, window.api.queryMetrics, etc.)            │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────────────┐
│                        MAIN PROCESS (Node.js)                        │
│                                                                      │
│  ┌──────────────────┐     │     ┌──────────────────────────────┐     │
│  │  IPC Handler     │─────┘     │  Collection Orchestrator     │     │
│  │  (Route calls)   │◄─────────►│  (job queue, rate limiter,   │     │
│  └──────┬───────────┘           │   checkpoint/resume state)   │     │
│         │                       └──────────────┬───────────────┘     │
│         ▼                                      │                     │
│  ┌──────────────────┐           ┌──────────────▼───────────────┐     │
│  │  Query Service   │           │  GitHub API Client           │     │
│  │  (analytics SQL) │           │  (Octokit + rate-limit-aware │     │
│  └──────┬───────────┘           │   fetcher + ETag caching)    │     │
│         │                       └──────────────┬───────────────┘     │
│         ▼                                      ▼                     │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                     DATABASE LAYER                           │    │
│  │      Drizzle ORM + better-sqlite3 (synchronous driver)       │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │    │
│  │  │  repos /    │  │  commits /   │  │  collection_jobs   │  │    │
│  │  │  auth       │  │  pull_reqs   │  │  (checkpoint state)│  │    │
│  │  └─────────────┘  └──────────────┘  └────────────────────┘  │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Renderer (React UI) | All visual concerns: charts, filters, date pickers, progress indicators. Zero data access. | React + Recharts/Nivo, TanStack Query for IPC call caching |
| Preload Script | Defines the safe API surface the renderer can call. No business logic. | `contextBridge.exposeInMainWorld('api', { ... })` |
| IPC Handler | Routes invoke calls to the correct service. Validates inputs. Returns serializable results. | `ipcMain.handle('query:metrics', ...)` thin dispatch layer |
| Collection Orchestrator | Drives the incremental API collection loop. Manages job state, pauses on rate limit, persists checkpoint so sessions can resume. | Custom async loop reading/writing `collection_jobs` table |
| GitHub API Client | Wraps Octokit. Checks `x-ratelimit-remaining` before each call. Stores ETags per paginated page. Throws `RateLimitError` when budget is low. | `@octokit/rest` with request interceptors |
| Query Service | Executes analytics SQL: cohort groupings, time-bucketing, before/after comparisons, rolling windows. Returns typed result sets. | Drizzle ORM queries + raw SQL for window functions |
| Database Layer | Schema ownership, migrations, connection management. Single writer (main process). | Drizzle ORM + better-sqlite3 (synchronous, no async overhead) |

## Recommended Project Structure

```
src/
├── main/                       # Main process entry + IPC routing
│   ├── index.ts                # App lifecycle, BrowserWindow setup
│   ├── ipc/                    # IPC handler registrations (thin dispatch)
│   │   ├── collection.ts       # collect:start, collect:status, collect:pause
│   │   └── query.ts            # query:metrics, query:cohorts, query:repos
│   ├── services/               # Business logic (no IPC awareness)
│   │   ├── CollectionOrchestrator.ts   # Rate-limit-aware incremental fetcher
│   │   ├── GitHubClient.ts             # Octokit wrapper + ETag store
│   │   └── QueryService.ts             # Analytics SQL, cohort computation
│   └── db/                     # Database layer
│       ├── schema.ts           # Drizzle schema definitions
│       ├── migrations/         # Drizzle migration files
│       └── client.ts           # better-sqlite3 connection singleton
├── preload/
│   └── index.ts                # contextBridge API surface definition
├── renderer/                   # React app (standard Vite/React structure)
│   ├── components/
│   │   ├── charts/             # Chart wrappers (Recharts/Nivo)
│   │   ├── dashboard/          # Dashboard page layout + cards
│   │   └── collection/         # Collection progress UI, rate-limit banners
│   ├── hooks/
│   │   ├── useCollectionStatus.ts   # Polls collection job state
│   │   └── useMetricsQuery.ts       # Queries analytics data via IPC
│   └── pages/
│       ├── Setup.tsx            # Auth + repo selection
│       ├── Dashboard.tsx        # Primary trend views
│       └── Explorer.tsx         # Drill-down with filters
└── shared/
    └── types.ts                 # Shared TypeScript types (IPC contracts)
```

### Structure Rationale

- **main/ipc/:** Thin dispatch only — keeps IPC handlers free of business logic, making services independently testable
- **main/services/:** Services have no knowledge of IPC or the renderer; they accept plain arguments and return plain data
- **main/db/:** Schema and migration files co-located; Drizzle generates migrations from schema diffs
- **preload/:** Single file surface; every callable function is explicitly listed here — nothing leaks implicitly
- **shared/types.ts:** IPC call/response types defined once, imported by both renderer hooks and main handlers — prevents drift

## Architectural Patterns

### Pattern 1: Checkpoint-Based Incremental Collection

**What:** Before fetching each "unit of work" (e.g., a page of commits for a repo), write the cursor position to a `collection_jobs` table. After processing, advance the cursor. On app restart, resume from last persisted cursor.

**When to use:** Any external API fetch that can't complete in one session. Essential here because large repos can require thousands of API calls, far exceeding the 5,000/hour budget.

**Trade-offs:** Adds schema complexity (jobs table, cursor columns). Rewards: sessions are interruptible at any point with zero data loss.

**Example:**
```typescript
// collection_jobs row
{
  repo_id: 'owner/repo',
  job_type: 'commits',
  status: 'in_progress' | 'paused' | 'complete',
  cursor: 'sha_of_last_processed_commit',  // resume point
  rate_limit_reset_at: 1742000000,          // when to next attempt
  collected_count: 1240,
  total_estimate: 5800,
}

// Orchestrator loop (simplified)
async function collectCommits(repoId: string) {
  const job = db.getOrCreateJob(repoId, 'commits');
  while (job.status !== 'complete') {
    const remaining = await githubClient.getRateLimitRemaining();
    if (remaining < SAFETY_BUFFER) {
      db.updateJob(job.id, { status: 'paused', rate_limit_reset_at: resetAt });
      notifyRenderer('collection:paused', { repoId, resumeAt: resetAt });
      return;
    }
    const page = await githubClient.fetchCommitsPage(repoId, job.cursor);
    db.insertCommits(page.items);
    db.updateJob(job.id, { cursor: page.nextCursor, collected_count: job.collected_count + page.items.length });
    if (!page.hasMore) db.updateJob(job.id, { status: 'complete' });
  }
}
```

### Pattern 2: Read-Side Query Service with Pre-Aggregated Views

**What:** Analytics queries (cohort trends, rolling windows, before/after comparisons) are expensive on raw `commits` and `pull_requests` tables. Use SQLite views or materialized summary rows to pre-aggregate data that doesn't change frequently.

**When to use:** Once collection is substantially complete and the UI shows noticeable lag on dashboard queries. Not needed until data volume causes actual slowness.

**Trade-offs:** Summary tables must be invalidated when new data arrives from collection. Keep invalidation simple: mark summaries as stale, recompute lazily on next dashboard open.

**Example:**
```sql
-- Pre-aggregated monthly PR stats by contributor cohort
CREATE TABLE pr_monthly_stats AS
SELECT
  strftime('%Y-%m', merged_at) as month,
  CASE
    WHEN julianday(merged_at) - julianday(first_commit_date) < 90 THEN '0-3mo'
    WHEN julianday(merged_at) - julianday(first_commit_date) < 365 THEN '3-12mo'
    ELSE '1yr+'
  END as tenure_cohort,
  AVG(additions + deletions) as avg_pr_size,
  COUNT(*) as pr_count
FROM pull_requests
JOIN contributors USING (author_login)
GROUP BY 1, 2;
```

### Pattern 3: IPC Contract Typing with Shared Types

**What:** Define all IPC call signatures in `shared/types.ts` as TypeScript interfaces. Import the same types in the preload contextBridge definition and in renderer hooks. The compiler enforces that caller and handler agree.

**When to use:** Always. The cost is one shared file; the benefit is that any mismatch between what the renderer calls and what the main process handles becomes a compile error, not a runtime bug.

**Trade-offs:** None significant. Skip only in throwaway prototypes.

**Example:**
```typescript
// shared/types.ts
export interface MetricsQuery {
  repoIds: string[];
  startDate: string;
  endDate: string;
  cohort: '0-3mo' | '3-12mo' | '1yr+' | 'all';
}
export interface MetricsResult {
  months: { month: string; avgPrSize: number; prCount: number }[];
}

// renderer hook
const data = await window.api.queryMetrics(query satisfies MetricsQuery);
```

## Data Flow

### Collection Flow (GitHub API → SQLite)

```
User clicks "Collect Repo"
    ↓
Renderer calls window.api.collection.start({ repoId })
    ↓ IPC invoke
IPC Handler → CollectionOrchestrator.start(repoId)
    ↓
Orchestrator reads checkpoint from collection_jobs table
    ↓
Loop: check x-ratelimit-remaining → fetch page → insert rows → advance cursor
    ↓ (rate limit hit)
Orchestrator writes pause state to DB, sends renderer notification via webContents.send
    ↓
Renderer shows "Paused — resume at [time]" banner
    ↓ (next session / user clicks Resume)
Orchestrator resumes from persisted cursor — zero data loss
```

### Query Flow (SQLite → Dashboard)

```
User opens Dashboard or changes filter
    ↓
React hook calls window.api.query.metrics(params)
    ↓ IPC invoke
IPC Handler → QueryService.getMetrics(params)
    ↓
QueryService executes Drizzle query + raw SQL window functions
    ↓
Returns typed MetricsResult[] to renderer
    ↓
Recharts/Nivo renders charts from result data
```

### Key Data Flows

1. **Collection progress:** Orchestrator → `webContents.send('collection:progress', {...})` → renderer subscription → live progress bar updates without polling overhead
2. **Dashboard queries:** Always on-demand (no background refresh); data is stable once collected, so query-on-filter-change is sufficient
3. **Rate limit state:** Persisted in SQLite `collection_jobs` — survives app restarts; renderer reads it on startup to show "collection incomplete, resume available" state

## Scaling Considerations

This is a single-user local app. Traditional scaling concerns don't apply. The relevant "scale" axes are:

| Concern | At 1 repo / 1k commits | At 10 repos / 100k commits | At 50+ repos / 1M+ commits |
|---------|------------------------|----------------------------|----------------------------|
| Collection time | Minutes, fits in one session | Hours across multiple sessions — checkpoint/resume essential | Days of collection time; rate limit budget becomes dominant constraint |
| Query speed | Instant on raw tables | May need indexes on `merged_at`, `author_login`, `repo_id` | Pre-aggregated summary tables needed for dashboard queries |
| SQLite file size | <10MB | 50-200MB | 500MB-2GB; still fine for SQLite with proper indexes |
| Memory | Negligible | Negligible | Stream rows rather than loading full result sets into memory |

### Scaling Priorities

1. **First bottleneck:** Dashboard query latency as commit/PR counts grow past ~100k rows. Fix: compound index on `(repo_id, merged_at)` and pre-aggregated monthly summary table.
2. **Second bottleneck:** Collection API budget exhaustion for orgs with many large repos. Fix: parallel collection across repos is NOT safe (shares rate limit budget); instead, prioritize repos by user importance and collect serially.

## Anti-Patterns

### Anti-Pattern 1: Putting SQLite Access in the Renderer

**What people do:** Enable `nodeIntegration: true` and call `better-sqlite3` directly from React components.

**Why it's wrong:** Violates Electron's security model. Any XSS in the renderer gains full filesystem access. Also makes testing harder and breaks the preload contract boundary.

**Do this instead:** All DB access lives in the main process. Renderer calls typed IPC methods and receives plain JSON results.

### Anti-Pattern 2: Fetching All Historical Data Before Showing Anything

**What people do:** Design the collection as a blocking "import" step that must complete before the dashboard is usable.

**Why it's wrong:** For large repos this means hours of waiting. The app feels broken. Users abandon the collection.

**Do this instead:** Show the dashboard as soon as any data is present. Show a "data collection X% complete" indicator. Charts display what's available. Users can explore partial data while collection continues in the background across sessions.

### Anti-Pattern 3: Storing Raw API JSON in SQLite

**What people do:** Serialize the full GitHub API response as a JSON blob in a single `raw_data` column.

**Why it's wrong:** Queries become impossible. Can't filter, aggregate, or join on blob contents without full deserialization. Collection deduplication also requires parsing.

**Do this instead:** Extract exactly the fields you need into typed columns at insertion time. If you later need a field you didn't store, add a migration and re-fetch the affected data.

### Anti-Pattern 4: Ignoring Secondary Rate Limits

**What people do:** Only check `x-ratelimit-remaining` (primary hourly limit) and ignore secondary limits.

**Why it's wrong:** GitHub also enforces 900 points/minute for REST and 100 concurrent requests. Bursting many requests quickly can trigger a 429 even with remaining hourly budget. Continued violations risk integration bans.

**Do this instead:** Add a configurable delay between requests (e.g., 100ms). Treat any 403 or 429 response as a hard stop, not a retry-immediately signal. Respect the `retry-after` header.

## Integration Points

### External Services

| Service | Integration Pattern | Key Gotchas |
|---------|---------------------|-------------|
| GitHub REST API | `@octokit/rest` with request interceptors for rate limit tracking | ETags are per-page, not per collection; store per page URL. Secondary limits (900 pts/min) can trigger even with hourly budget remaining. `x-ratelimit-reset` is Unix epoch — compare to `Date.now()/1000`. |
| GitHub OAuth / PAT | PAT recommended for single-user local tool (simpler than OAuth app flow). Store token in OS keychain via `keytar`, not in SQLite plaintext. | OAuth app flow adds complexity with minimal benefit for local single-user tool. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Renderer ↔ Main | IPC via contextBridge-exposed `window.api` | All calls are async (Promise-based via `ipcRenderer.invoke`). Use `ipcMain.handle` on main side. |
| Main ↔ Renderer (push) | `webContents.send` for progress events | Collection progress and rate-limit state updates are pushed to renderer; renderer does not poll. |
| Orchestrator ↔ DB | Direct synchronous Drizzle/better-sqlite3 calls | better-sqlite3 is synchronous by design; this is fine in main process. Do not use it from renderer. |
| Query Service ↔ DB | Direct synchronous Drizzle/better-sqlite3 calls | For complex cohort queries, drop to raw SQL with `db.prepare(sql).all(params)` — Drizzle's query builder doesn't cover all window function cases. |

## Build Order Implications

The component dependency graph dictates a natural build order:

1. **Database layer first** — schema, migrations, connection singleton. Everything else depends on this. No value delivered yet, but nothing else works without it.

2. **GitHub API Client** — standalone, testable without UI. Validates that rate limit handling and ETag logic work correctly before integrating.

3. **Collection Orchestrator** — depends on GitHub Client + DB. This is the highest-risk component (stateful, multi-session, async). Build and validate the pause/resume cycle early.

4. **IPC Handler + Preload surface** — thin wiring layer. Define the full API contract in `shared/types.ts` at this point, even if not all handlers are implemented.

5. **Query Service** — depends on DB only. Can be built with seeded test data before collection is complete.

6. **Renderer: Collection UI** — progress bars, rate limit banners, repo selector. Depends on IPC collection handlers.

7. **Renderer: Dashboard charts** — depends on Query Service via IPC. Can be built with mock data initially, then wired to real queries.

8. **Renderer: Drill-down Explorer** — depends on all query types. Built last because it exercises the full stack.

## Sources

- [Electron Process Model (official)](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron IPC (official)](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron App Architecture Best Practices — Oflight](https://www.oflight.co.jp/en/columns/electron-app-architecture-best-practices)
- [GitHub REST API Rate Limits (official docs)](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Managing GitHub API Rate Limits — Lunar.dev](https://www.lunar.dev/post/a-developers-guide-managing-rate-limits-for-the-github-api)
- [SQLite Background Job Queue pattern — Jason Gorman](https://jasongorman.uk/writing/sqlite-background-job-system/)
- [Drizzle ORM official](https://orm.drizzle.team/)
- [Offline-First Frontend Apps 2025 — LogRocket](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/)

---
*Architecture research for: Local-first GitHub analytics dashboard (git-data-explorer)*
*Researched: 2026-03-22*
