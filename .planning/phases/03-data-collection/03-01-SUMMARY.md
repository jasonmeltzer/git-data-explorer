---
phase: 03-data-collection
plan: 01
subsystem: database, api
tags: [drizzle, sqlite, bot-detection, collection-state, unique-index, upsert]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: SQLite schema with collection_state table, Drizzle ORM setup
provides:
  - uniqueIndex on collection_state(repo_id, resource_type) preventing duplicate rows
  - Bot detection service with 3-signal classification (type, suffix, known-list)
  - Collection state DB service with checkpoint upsert and cross-session resume
  - Shared TypeScript types for collection status, progress events, batch status
affects: [03-data-collection plan 02 (collection engine), 03-data-collection plan 03 (routes)]

# Tech tracking
tech-stack:
  added: []
  patterns: [onConflictDoUpdate upsert for checkpoint writes, uniqueIndex for composite uniqueness, 3-signal bot detection]

key-files:
  created:
    - src/server/services/bot-detection.ts
    - src/server/services/collection-state.ts
    - src/server/__tests__/bot-detection.test.ts
    - src/server/__tests__/collection-state.test.ts
    - drizzle/migrations/0001_amazing_eternals.sql
  modified:
    - src/server/db/schema.ts
    - src/shared/types.ts

key-decisions:
  - "Used uniqueIndex instead of regular index on collection_state(repo_id, resource_type) to enforce DB-level uniqueness for upserts"
  - "Bot detection uses Set.has() on lowercased login for case-insensitive known-bot matching"
  - "markCollectionPaused encodes resetAt in errorMessage field using pipe delimiter for simplicity"

patterns-established:
  - "Service pattern: import db from client.js, use drizzle query builders, export pure functions"
  - "Test pattern: in-memory SQLite with vi.mock of db/client.js, dynamic import of service under test"
  - "Upsert pattern: onConflictDoUpdate targeting composite unique index columns"

requirements-completed: [COLL-03, COLL-04, COLL-08, COLL-10]

# Metrics
duration: 2m43s
completed: 2026-03-22
---

# Phase 03 Plan 01: Collection Foundation Summary

**Unique-index schema fix, shared collection types, bot detection with 3-signal classification, and collection state service with checkpoint upsert for cross-session resume**

## Performance

- **Duration:** 2m43s
- **Started:** 2026-03-22T20:47:33Z
- **Completed:** 2026-03-22T20:50:16Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Schema migration adds UNIQUE index on collection_state(repo_id, resource_type) preventing duplicate checkpoint rows
- Bot detection service classifies accounts using three signals: GitHub type field, [bot] suffix, known-bots list (13 tests)
- Collection state service provides checkpoint upsert, read-back, pause/complete transitions, and incomplete-collection query (15 tests)
- Shared types define CollectionResourceStatus, CollectionRepoStatus, CollectionProgressEvent, CollectionBatchStatus, AppSettings

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema fix + shared types + bot detection service** - `23b2da1` (feat)
2. **Task 2: Collection state DB service with checkpoint upsert** - `9a37a37` (feat)

## Files Created/Modified
- `src/server/db/schema.ts` - Added uniqueIndex import and unique constraint on collection_state
- `src/shared/types.ts` - Added 6 new types/interfaces for collection status and progress
- `src/server/services/bot-detection.ts` - 3-signal bot detection with KNOWN_BOTS set
- `src/server/services/collection-state.ts` - Checkpoint upsert, read-back, pause, complete, incomplete query, item counts
- `src/server/__tests__/bot-detection.test.ts` - 13 test cases covering all detection signals
- `src/server/__tests__/collection-state.test.ts` - 15 test cases covering upsert, round-trip, transitions
- `drizzle/migrations/0001_amazing_eternals.sql` - DROP old index, CREATE UNIQUE INDEX

## Decisions Made
- Used uniqueIndex on composite (repo_id, resource_type) to enforce DB-level uniqueness for upsert conflict target
- Bot detection lowercases login for known-list check but not for suffix check (exact match on [bot])
- Rate-limit resetAt encoded in errorMessage field using pipe delimiter for simplicity (avoids extra column)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema unique constraint enables safe upserts in collection engine (Plan 02)
- Shared types ready for frontend consumption and API route typing
- Bot detection ready for use during commit/PR data ingestion
- Collection state service ready for checkpoint writes during incremental collection

---
*Phase: 03-data-collection*
*Completed: 2026-03-22*
