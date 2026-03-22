---
phase: 03-data-collection
plan: 02
subsystem: api
tags: [octokit, github-api, sse, sqlite, collection, rate-limit, hono]

# Dependency graph
requires:
  - phase: 03-data-collection/plan-01
    provides: collection-state service, bot-detection service, shared types
  - phase: 02-auth-repo-management
    provides: octokit client, repo management, server routes
provides:
  - CollectionEngine class with page-level checkpointing for commits and PRs
  - CollectionQueue with sequential processing, start/stop/skip controls
  - SSE progress streaming endpoint for live collection updates
  - Bot toggle settings endpoints (GET/PUT)
  - D-02 single-repo auto-start wiring in repositories route
affects: [03-data-collection/plan-03, 03-data-collection/plan-04, 04-analytics]

# Tech tracking
tech-stack:
  added: []
  patterns: [paginate.iterator for page-level control, SSE streaming via hono/streaming, singleton service pattern for queue, fire-and-forget async collection]

key-files:
  created:
    - src/server/services/collection-engine.ts
    - src/server/services/collection-queue.ts
    - src/server/routes/collection.ts
    - src/server/__tests__/collection-engine.test.ts
    - drizzle/migrations/0002_aspiring_morlun.sql
  modified:
    - src/server/routes/settings.ts
    - src/server/routes/repositories.ts
    - src/server/index.ts
    - src/server/db/schema.ts

key-decisions:
  - "RateLimitError thrown from collection-specific Octokit callbacks (not modifying global octokit) for clean collection pause"
  - "Collection queue is module-level singleton for shared access between routes and repositories"
  - "Upgraded (sha, repoId) and (githubId, repoId) indexes to unique for onConflictDoUpdate upsert support"
  - "Auto-resume uses setTimeout with retryAfter + 2s buffer; secondary rate limits get 60s minimum"

patterns-established:
  - "paginate.iterator pattern for page-level control over GitHub API pagination"
  - "Module singleton pattern for collection queue shared across route files"
  - "Fire-and-forget async pattern for background collection (POST returns immediately)"
  - "SSE streaming with onAbort cleanup for progress events"

requirements-completed: [COLL-01, COLL-02, COLL-03, COLL-04, COLL-05, COLL-07, COLL-08]

# Metrics
duration: 6min
completed: 2026-03-22
---

# Phase 3 Plan 2: Collection Engine & Queue Summary

**Core collection engine with page-level checkpointing, sequential queue orchestrator, SSE progress streaming, and rate-limit auto-resume**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-22T20:52:13Z
- **Completed:** 2026-03-22T20:58:12Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- CollectionEngine class fetches commits and PRs page-by-page with checkpoint after each page
- Rate-limit handling pauses collection and schedules auto-resume timer (D-14)
- CollectionQueue orchestrates sequential repo collection with start/stop/skip controls
- SSE endpoint streams live progress events; polling status endpoint as fallback
- Bot toggle settings endpoints at GET/PUT /api/settings/bots
- Single-repo auto-start wired in repositories route per D-02

## Task Commits

Each task was committed atomically:

1. **Task 1: Collection engine with page-level checkpointing** - `21540e1` (feat)
2. **Task 2: Queue, routes, SSE, bot settings, D-02 wiring** - `2c47f3c` (feat)

## Files Created/Modified
- `src/server/services/collection-engine.ts` - CollectionEngine class with collectCommits/collectPRs, RateLimitError, author upsert
- `src/server/services/collection-queue.ts` - CollectionQueue with startBatch, startSingleRepo, stopAll, skipCurrent, getStatus
- `src/server/routes/collection.ts` - Hono routes for collection start/stop/skip/status/resume-info/progress SSE
- `src/server/__tests__/collection-engine.test.ts` - 10 tests covering checkpointing, cursor, dedup, rate limits, abort, bots
- `src/server/routes/settings.ts` - Added GET/PUT /api/settings/bots endpoints
- `src/server/routes/repositories.ts` - D-02 auto-start wiring for single-repo adds
- `src/server/index.ts` - Mounted collection routes
- `src/server/db/schema.ts` - Upgraded indexes to unique for upsert support
- `drizzle/migrations/0002_aspiring_morlun.sql` - Migration for unique index upgrade

## Decisions Made
- Created collection-specific Octokit (createCollectionOctokit) that throws RateLimitError instead of modifying global octokit callbacks
- Made CollectionQueue a module-level singleton for shared access between collection routes and repositories route
- Upgraded (sha, repoId) and (githubId, repoId) indexes from regular to unique to enable onConflictDoUpdate for deduplication
- Auto-resume timer uses retryAfter + 2s buffer; secondary rate limits enforce 60s minimum per GitHub docs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Upgraded non-unique indexes to unique indexes for upsert support**
- **Found during:** Task 1 (Collection engine)
- **Issue:** Drizzle's onConflictDoUpdate requires a unique constraint on the target columns. The existing (sha, repoId) and (githubId, repoId) indexes were non-unique, which would cause upserts to fail silently.
- **Fix:** Changed both indexes to uniqueIndex in schema.ts, generated migration 0002_aspiring_morlun.sql
- **Files modified:** src/server/db/schema.ts, drizzle/migrations/0002_aspiring_morlun.sql
- **Verification:** All 70 tests pass including dedup test that inserts same commit twice
- **Committed in:** 21540e1 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential for correctness of deduplication. No scope creep.

## Issues Encountered
- Vitest uses different CLI syntax than Jest (no --testPathPattern flag) - resolved by passing file path directly

## User Setup Required
None - no external service configuration required.

## Known Stubs
None - all functionality is fully wired.

## Next Phase Readiness
- Collection engine and queue ready for integration with frontend UI (Phase 3 Plan 3/4)
- SSE endpoint ready for live progress display in collection status tab
- Bot settings endpoint ready for settings UI integration

---
*Phase: 03-data-collection*
*Completed: 2026-03-22*
