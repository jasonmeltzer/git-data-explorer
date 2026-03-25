---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase complete — ready for verification
stopped_at: Completed 04-query-service-cohort-engine-03-PLAN.md
last_updated: "2026-03-25T14:15:01.132Z"
progress:
  total_phases: 7
  completed_phases: 5
  total_plans: 16
  completed_plans: 16
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-22)

**Core value:** Engineering leaders can see concrete, data-backed trends in how AI adoption is changing code contribution patterns — especially new developer ramp-up
**Current focus:** Phase 04 — query-service-cohort-engine

## Current Position

Phase: 04 (query-service-cohort-engine) — EXECUTING
Plan: 3 of 3

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 3min | 2 tasks | 17 files |
| Phase 01 P02 | 2min | 1 tasks | 10 files |
| Phase 02 P01 | 3m28s | 3 tasks | 9 files |
| Phase 02 P02 | 4 | 2 tasks | 14 files |
| Phase 02 P03 | ~15min | 3 tasks (incl. post-checkpoint fixes) | 4 files |
| Phase 03 P01 | 2m43s | 2 tasks | 7 files |
| Phase 03 P02 | 6min | 2 tasks | 11 files |
| Phase 03 P03 | 4min | 3 tasks | 7 files |
| Phase 03.1-recency-optimized-collection P01 | 12min | 2 tasks | 10 files |
| Phase 03.1 P03 | 1min | 1 tasks | 1 files |
| Phase 03.1 P02 | 15min | 2 tasks | 4 files |
| Phase 04 P01 | 3min | 1 tasks | 7 files |
| Phase 04-query-service-cohort-engine P02 | 11min | 1 tasks | 3 files |
| Phase 04-query-service-cohort-engine P03 | 3min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Init]: Local SQLite over cloud DB — data privacy, zero infrastructure
- [Init]: First commit date for "new dev" — zero manual setup, derived from git history
- [Init]: Cohort analysis as primary view — reinforces trend-over-individuals framing
- [Init]: Incremental API collection with pause/resume — GitHub rate limits make full collection impractical in one session
- [Phase 01]: Used better-sqlite3 v12.8.0 (research confirmed v12.4.5+ fixed Node 22 issues)
- [Phase 01]: Full schema defined upfront (6 tables) per D-07/D-08 — enables immediate data writing in Phase 2/3
- [Phase 01]: Token stored in .env with validate-before-save via GitHub API (D-01/D-04) — no keychain packages
- [Phase 01]: Hash-based routing for two-page SPA instead of react-router dependency
- [Phase 02]: Used drizzle db.run(sql) instead of raw sqlite.exec() for orphan author cleanup to enable test mocking
- [Phase 02]: Defined specific Hono routes before parameterized routes to avoid path conflicts (/api/repos/stopped before /api/repos/:id)
- [Phase 02]: Changed tsconfig moduleResolution from NodeNext to bundler — required for @shared/* path aliases to work with Vite + shadcn components
- [Phase 02]: shadcn/ui components installed at src/shared/components/ui/ — Plan 03 imports from @shared/components/ui/
- [Phase 02]: ReposPage initializes selectedGithubIds from trackedData on first load via useEffect to pre-check already-tracked repos
- [Phase 02]: Shared queryKey ['repos', 'tracked'] in both LandingPage and ReposPage enables automatic cache invalidation across pages
- [Phase 02]: LandingPage tracked repos query always enabled (no token needed for local SQLite query) — fixes stale UI after ReposPage saves
- [Phase 02]: handleSave computes stop-delta (tracked repos unchecked by user) and calls stop API before saving new selection
- [Phase 02]: Checkbox visibility uses border-2 border-gray-400 bg-white — border-input was near-invisible in default theme
- [Phase 03]: Used uniqueIndex on collection_state(repo_id, resource_type) for DB-level upsert uniqueness
- [Phase 03]: Bot detection uses 3-signal classification: GitHub type field, [bot] suffix, known-bots Set
- [Phase 03]: Rate-limit resetAt encoded in errorMessage field with pipe delimiter (avoids schema change)
- [Phase 03]: Collection-specific Octokit throws RateLimitError for clean pause/resume flow
- [Phase 03]: CollectionQueue is module-level singleton shared between routes and repositories
- [Phase 03]: Upgraded (sha,repoId) and (githubId,repoId) indexes to unique for onConflictDoUpdate upsert
- [Phase 03]: SSE hook auto-connects only when collection is active; polling 3s active / 30s idle
- [Phase 03]: Data completeness badges on Repos tab share repoStatusMap from collection status query
- [Phase 03.1-01]: depth_target and oldest_month_collected stored as ISO timestamp strings in collection_state; depth setting persisted in app_config as collection_depth_months with default 3
- [Phase 03.1-01]: startBatch signature accepts _options object to prepare for Plan 02 engine rewrite without breaking existing callers
- [Phase 03.1]: Local slider state (localDepth) initialized to null and synced from server once on mount — prevents slider jumping during re-renders
- [Phase 03.1]: saveDepthMutation and startFetchAllMutation kept separate from startCollectionMutation to keep sync vs full-history intent distinct
- [Phase 03.1]: collectCommitsForMonth() as private method: cleaner separation from month-iteration loop, easier to test and resume
- [Phase 03.1]: date-fns added to package.json (was in CLAUDE.md recommended stack but not installed)
- [Phase 03.1]: transitionLegacyRepos module-level _transitionDone flag prevents repeated transition on multiple startBatch calls
- [Phase 04]: Used sql.raw() for complex CASE WHEN cohort queries in analytics-cohorts.ts — cleaner than Drizzle query builder for epoch arithmetic
- [Phase 04]: Per-repo tenure uses correlated subquery MIN(committed_at) per author+repo pair (D-01/D-02)
- [Phase 04]: getCompleteRepoIds uses HAVING COUNT >= 2 to require both commits+PRs complete before including in analytics
- [Phase 04]: SQL fetch + TypeScript bucketing for ramp-up curves: SQL does filtering/joins/window checks, TypeScript does week index math and group aggregation
- [Phase 04]: CAST(col AS INTEGER) for epoch arithmetic in Drizzle sql template tags to ensure epoch-seconds math works correctly
- [Phase 04]: Drizzle select requires ORDER BY id in test helpers — unique index scan may return rows in non-rowid order
- [Phase 04]: UTC-safe period boundaries using Date.UTC() instead of date-fns startOfMonth/startOfQuarter to avoid timezone offset issues in epoch comparisons
- [Phase 04]: pctChange returns null on zero prior period value — allows UI to distinguish no-data from zero-change
- [Phase 04]: Rolling window changes computed on daily averages — normalizes partial current period for fair MoM/QoQ comparison

### Roadmap Evolution

- Phase 03.1 inserted after Phase 3: Recency-optimized collection — fetch newest-first by full calendar month, depth-first per repo (smallest first), 3-month default depth before moving to next repo (URGENT)

### Pending Todos

None yet.

### Blockers/Concerns

- [Research]: Octokit device flow + keytar (OS keychain) integration not end-to-end verified — Phase 1/2 research should prototype auth flow before full implementation
- [Research]: GitHub stats endpoints silently fail at 10k commits — must use raw `/commits` endpoint from day one; fixing later requires schema redesign and re-collection
- [Research]: Secondary GitHub rate limit (900pt/min) distinct from primary 5k/hr — must be handled from the start in Phase 3 to avoid integration ban risk

## Session Continuity

Last session: 2026-03-25T14:15:01.129Z
Stopped at: Completed 04-query-service-cohort-engine-03-PLAN.md
Resume file: None
