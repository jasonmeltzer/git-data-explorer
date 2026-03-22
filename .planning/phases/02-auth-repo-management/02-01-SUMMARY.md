---
phase: 02-auth-repo-management
plan: 01
subsystem: backend/api
tags: [octokit, github-api, repo-management, sqlite, hono, tdd]
dependency_graph:
  requires: [Phase 01 foundation — Hono server, SQLite schema, token service]
  provides: [Octokit client factory, GitHub repo listing, repo CRUD API, 7 REST endpoints]
  affects: [Phase 02 Plan 03 ReposPage UI will call these endpoints]
tech_stack:
  added: ["@octokit/rest@21", "@octokit/plugin-throttling@9"]
  patterns: [Octokit throttling plugin, Drizzle ORM onConflictDoUpdate, in-memory SQLite for tests, Hono app.route() mounting]
key_files:
  created:
    - src/server/services/octokit.ts
    - src/server/services/github-repos.ts
    - src/server/services/repo-management.ts
    - src/server/routes/repositories.ts
    - src/server/__tests__/octokit.test.ts
    - src/server/__tests__/repo-management.test.ts
    - src/server/__tests__/repositories.test.ts
  modified:
    - src/server/index.ts
    - package.json
decisions:
  - "Used drizzle db.run(sql`...`) instead of raw sqlite.exec() for orphan author cleanup — enables test mocking without raw DB reference"
  - "Defined /api/repos/available and /api/repos/stopped before /api/repos/:id routes to avoid Hono path conflicts"
metrics:
  duration: 3min 28sec
  completed_date: 2026-03-22
  tasks: 3
  files: 9
---

# Phase 02 Plan 01: GitHub Repo Management Backend Summary

**One-liner:** Octokit client factory with throttling plugin, GitHub repo listing service, SQLite repo CRUD service, and 7 Hono endpoints for the complete repo management backend.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1a | Octokit client factory + GitHub repos service with tests | 4b9aa03 | octokit.ts, github-repos.ts, octokit.test.ts |
| 1b | Repo management service with tests | 69642bb | repo-management.ts, repo-management.test.ts |
| 2 | Hono routes + server mount + integration tests | f953d6c | repositories.ts, index.ts, repositories.test.ts |

## What Was Built

### Octokit Client Factory (`src/server/services/octokit.ts`)
- `createOctokit()` — creates a ThrottledOctokit instance from the stored PAT
- Calls `readToken()` fresh per invocation (no module-level caching per D-02 requirement)
- `onRateLimit`: logs warning, retries up to 2 times
- `onSecondaryRateLimit`: logs warning, does NOT retry (Phase 3 handles collection pacing)

### GitHub Repos Service (`src/server/services/github-repos.ts`)
- `listAllRepos(octokit)` — paginated fetch with `per_page: 100`, sorted by updated desc
- `getAuthenticatedLogin(octokit)` — returns the authenticated user's login

### Repo Management Service (`src/server/services/repo-management.ts`)
- `getTrackedRepos()` — repos where `removedAt IS NULL`
- `getStoppedRepos()` — repos where `removedAt IS NOT NULL`
- `addRepos(repos[])` — upsert via `onConflictDoUpdate` on githubId (re-activates stopped repos)
- `stopTracking(id)` — soft-delete by setting `removedAt`
- `getDeleteCounts(repoId)` — returns `{ commits: N, prs: N }` for delete preview
- `deleteRepoData(repoId)` — cascading hard-delete: collection_state → commits → pull_requests → orphaned authors → repositories row

### Repositories Route (`src/server/routes/repositories.ts`)
7 endpoints registered:
- `GET /api/repos/available` — lists all GitHub repos from PAT; 401 if no token
- `GET /api/repos` — active tracked repos
- `GET /api/repos/stopped` — soft-deleted repos
- `POST /api/repos` — add repos (Zod validation)
- `PATCH /api/repos/:id/stop` — soft-delete
- `GET /api/repos/:id/delete-preview` — commit/PR counts
- `DELETE /api/repos/:id` — hard-delete with cascade

## Test Results

- `octokit.test.ts`: 2/2 tests pass
- `repo-management.test.ts`: 8/8 tests pass
- `repositories.test.ts`: 8/8 tests pass
- Full suite: **32/32 tests pass** across 6 test files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used Drizzle sql`` instead of raw sqlite.exec() for orphan author cleanup**
- **Found during:** Task 1b GREEN step
- **Issue:** The test mocked `db/client.js` with `sqlite: null` — calling `sqlite.exec()` in `deleteRepoData()` caused `TypeError: Cannot read properties of null (reading 'exec')`
- **Fix:** Used `db.run(sql\`DELETE FROM authors WHERE ...\`)` which goes through the mocked `db` instance
- **Files modified:** `src/server/services/repo-management.ts`
- **Commit:** 69642bb (included in Green step)

**2. [Rule 2 - Ordering] Defined specific routes before parameterized routes**
- **Found during:** Task 2 implementation
- **Issue:** If `/api/repos/:id/delete-preview` and `/api/repos/stopped` were registered after `/api/repos/:id`, Hono would match "stopped" and "delete-preview" as `:id` values
- **Fix:** Registered `/api/repos/available` and `/api/repos/stopped` before `/api/repos/:id` routes
- **Files modified:** `src/server/routes/repositories.ts`

## Known Stubs

None — all endpoints are wired to real SQLite operations and GitHub API calls.

## Self-Check: PASSED

Files exist:
- [x] src/server/services/octokit.ts
- [x] src/server/services/github-repos.ts
- [x] src/server/services/repo-management.ts
- [x] src/server/routes/repositories.ts
- [x] src/server/__tests__/octokit.test.ts
- [x] src/server/__tests__/repo-management.test.ts
- [x] src/server/__tests__/repositories.test.ts

Commits exist:
- [x] 4b9aa03 — Octokit factory + GitHub repos service
- [x] 69642bb — Repo management service
- [x] f953d6c — Repositories routes + server mount
