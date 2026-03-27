# Roadmap: Git Data Explorer

## Overview

Five phases that build bottom-up from project scaffolding to a working analytics dashboard. The dependency graph dictates order: infrastructure before auth, auth before data collection, data collection before the query layer, and a correct query layer before any charts appear. The surveillance framing constraint cuts across every phase — cohort aggregates are the default view and "productivity" language is never used.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Project scaffold, SQLite database, local Hono server running with Vite SPA
- [x] **Phase 2: Auth & Repo Management** - GitHub authentication (PAT + OAuth device flow) and repo selection/management (completed 2026-03-22)
- [x] **Phase 3: Data Collection Engine** - Incremental GitHub API collection with rate-limit handling, checkpointing, and progress reporting
- [x] **Phase 3.1: Recency-Optimized Collection** - Newest-first month-window fetching, depth slider, completeness badges (INSERTED)
- [x] **Phase 4: Query Service & Cohort Engine** - Analytics SQL layer: cohort assignments, AI marker, rolling windows, bot filtering (completed 2026-03-25)
- [ ] **Phase 4.1: Codebase Hardening** - Fix bugs, security issues, and correctness problems from Phase 1-4 audit (INSERTED)
- [ ] **Phase 5: Dashboard UI** - Full primary dashboard with PR/commit trend charts, date filtering, and contributor/repo filters
- [ ] **Phase 6: Full UI Polish Pass** - Comprehensive UI review and polish across all pages using frontend-design skill
- [ ] **Phase 7: Data Export with Anonymization** - Export dashboard data as CSV/JSON with optional contributor name anonymization

## Phase Details

### Phase 1: Foundation
**Goal**: The project's structural skeleton exists — database, API server, and SPA are wired together and runnable locally with a single command
**Depends on**: Nothing (first phase)
**Requirements**: INFR-01, INFR-02, INFR-03
**Success Criteria** (what must be TRUE):
  1. Running `npm run dev` (or equivalent) starts both the Hono API server and Vite SPA with no errors
  2. The SQLite database file is created on first run with schema applied via Drizzle migrations
  3. GitHub token is read from a `.env` file (gitignored), with a UI settings page for easy entry
  4. The local web app is accessible in a browser and renders a placeholder page confirming the stack is live
**Plans:** 2 plans
Plans:
- [x] 01-01-PLAN.md — Project scaffold, Hono server, SQLite + Drizzle DB with full schema, .env token service with GitHub API validation, settings API endpoints
- [x] 01-02-PLAN.md — React SPA with landing page + settings/token UI, Vitest test suite, end-to-end verification

### Phase 2: Auth & Repo Management
**Goal**: Users can authenticate with GitHub and manage which repos they want to track — including adding, removing, and clearing cached data
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):
  1. User can authenticate via Personal Access Token stored in `.env` file (implemented in Phase 1, wired to Octokit in Phase 2)
  2. User can browse all repos their PAT has access to (personal + org), grouped by owner, and select which to track
  3. User can add a new repo to tracking at any time without affecting existing tracked repos
  4. User can stop tracking a repo (data persists) and can explicitly delete its cached data
  5. After saving a token, user is auto-navigated to repo selection page
**Plans:** 3/3 plans complete
Plans:
- [x] 02-01-PLAN.md -- Backend: Octokit client, GitHub API repo listing, repo CRUD services, Hono routes, and tests
- [x] 02-02-PLAN.md -- Frontend infra: shadcn/ui init, TanStack Query, NavBar, 3-page router, shared types, post-token navigation
- [x] 02-03-PLAN.md -- ReposPage UI with grouped checklist, search, management actions, and landing page updates

### Phase 3: Data Collection Engine
**Goal**: The app can fetch and cache GitHub commit and PR data incrementally — resuming correctly across sessions and rate-limit interruptions — and communicates collection status clearly to the user
**Depends on**: Phase 2
**Requirements**: COLL-01, COLL-02, COLL-03, COLL-04, COLL-05, COLL-06, COLL-07, COLL-08, COLL-09, COLL-10
**Success Criteria** (what must be TRUE):
  1. Starting collection for a repo fetches PR and commit data from the GitHub API and stores it in SQLite; re-running collection does not re-fetch already-cached data
  2. Collection pauses automatically when GitHub rate limits are hit (both 5k/hr primary and 900pt/min secondary) and displays a clear message telling the user when to return
  3. After a rate-limit pause or app restart, collection resumes from the exact cursor position where it stopped — no data gaps or duplicates
  4. The UI shows live collection progress: repos completed, estimated remaining data, and a data-completeness indicator showing which repos/date ranges are fully vs. partially collected
  5. Bot accounts (Dependabot, Renovate, GitHub Actions) are excluded from contributor analysis without requiring manual configuration
**Plans:** 4/4 plans complete
Plans:
- [x] 03-01-PLAN.md — Schema fix (unique constraint), shared types, bot detection service, collection state DB service
- [x] 03-02-PLAN.md — Collection engine (commits + PRs), queue orchestrator, Hono routes, SSE progress endpoint
- [x] 03-03-PLAN.md — Frontend Collection tab, SSE hook, progress display, bot toggle in Settings
- [x] 03-04-PLAN.md — Human verification of end-to-end data collection flow

### Phase 03.1: Recency-optimized collection: fetch newest-first by full calendar month, depth-first per repo (smallest first), 3-month default depth before moving to next repo (INSERTED)

**Goal:** Collection engine fetches newest data first by calendar month window, with a user-configurable depth slider (default 3 months), depth-first per repo (smallest first), so engineering leaders see recent trends immediately without exhausting API rate limits on historical data
**Depends on:** Phase 3
**Requirements**: RCO-01, RCO-02, RCO-03, RCO-04, RCO-05, RCO-06, RCO-07, RCO-08
**Success Criteria** (what must be TRUE):
  1. Collection fetches commits newest-first using since/until month windows, working backward from the current month
  2. Collection fetches PRs newest-first using sort=created direction=desc with early-exit at depth boundary
  3. A depth slider in the Collection tab lets the user choose how many months back to collect (default 3, range 1-24)
  4. Collection stops at the depth boundary and advances to the next repo
  5. Repos already fully collected keep all their data; mid-collection repos are reset and restarted with the new strategy
  6. Completeness badges show depth-relative status ("N of M months" for partial repos)
  7. "Fetch all history" button triggers unlimited collection with a rate-limit warning modal
  8. Incremental re-sync fetches only new data since last cursor, not entire months
**Plans:** 4/4 plans complete

Plans:
- [x] 03.1-01-PLAN.md — Schema migration (new columns on collection_state), collection-state service updates, depth API endpoints, shared types
- [x] 03.1-02-PLAN.md — Collection engine rewrite (month-window commits, reverse-sort PRs), queue depth-limit awareness, Phase 3 transition logic
- [x] 03.1-03-PLAN.md — Frontend depth slider, completeness badges, "Fetch all history" AlertDialog
- [x] 03.1-04-PLAN.md — Human verification of end-to-end recency-optimized collection

### Phase 4: Query Service & Cohort Engine
**Goal**: A tested analytics layer that produces correct cohort groupings, ramp-up curves, before/after AI marker comparisons, and rolling period comparisons from the collected data
**Depends on**: Phase 3
**Requirements**: COHT-01, COHT-02, COHT-03, COHT-04, METR-04, METR-05
**Success Criteria** (what must be TRUE):
  1. Every contributor is automatically assigned a tenure cohort (0–3mo, 3–12mo, 1yr+) derived from their first commit date in each repo — no manual setup required
  2. Querying the analytics layer for a cohort returns correct aggregated PR and commit size metrics bucketed by the selected time period
  3. Setting an AI adoption marker date splits all query results into before/after periods with correct boundary handling
  4. Rolling window queries (month-over-month, quarter-over-quarter) return accurate comparisons across adjacent periods
  5. New developer ramp-up curves show the correct time-to-contribution trajectory for each cohort, with cohort membership stable across repeated queries
  6. All new service functions and query logic have corresponding Vitest tests covering happy paths, edge cases, and multi-repo isolation
**Plans:** 3/3 plans complete
Plans:
- [x] 04-01-PLAN.md — Analytics types, AI marker config service, cohort assignment/metrics service with tests
- [x] 04-02-PLAN.md — Ramp-up curve analytics service with weekly bucketing and join-period comparison
- [x] 04-03-PLAN.md — Rolling window comparison service, analytics Hono route, server mount

### Phase 04.1: Codebase Hardening — Fix bugs, security issues, and correctness problems from Phase 1-4 audit (INSERTED)

**Goal:** All bugs, security issues, and code quality problems identified in the Phase 1-4 audit are fixed with regression tests — ensuring the analytics layer, collection engine, and client are correct and hardened before Phase 5 dashboard work begins
**Depends on:** Phase 4
**Requirements**: BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, SEC-01, SEC-03, SEC-04, QUAL-01, QUAL-02, QUAL-03, QUAL-04, QUAL-05, QUAL-07
**Success Criteria** (what must be TRUE):
  1. getAiMarkerDate returns null for malformed stored values instead of producing Invalid Date objects that silently corrupt cohort queries
  2. Analytics routes return 400 for invalid date parameters instead of silently returning empty results
  3. sql.raw interpolation of repoIdList has integer sanitization guards preventing injection if future code paths change
  4. Collection engine upsertAuthor throws a descriptive error instead of TypeError on null row
  5. SSE client handles both 'status' and 'progress' event types from the server
  6. Incremental sync updates depthTarget so future depth expansion comparisons are correct
  7. Duplicate getCompleteRepoIds extracted to shared module
  8. npm audit production dependencies show 0 vulnerabilities
  9. All existing tests pass plus new regression tests for each bug fix
**Plans:** 3/3 plans executed (COMPLETE)

Plans:
- [x] 04.1-01-PLAN.md — Analytics correctness bugs and security fixes (BUG-05, BUG-06, QUAL-07, SEC-01, SEC-03)
- [x] 04.1-02-PLAN.md — Collection engine and SSE client bugs (BUG-01, BUG-02, BUG-03, BUG-04, QUAL-05)
- [x] 04.1-03-PLAN.md — Code quality cleanup, shared extraction, npm audit fix (QUAL-01, QUAL-02, QUAL-03, QUAL-04, SEC-04)

### Phase 5: Dashboard UI
**Goal**: Engineering leaders can open the app and immediately see cohort-level PR size trends, commit trends, and new developer ramp-up curves — with date range filtering, repo filtering, and an individual contributor drill-down that never surfaces individual rankings
**Depends on**: Phase 4
**Requirements**: METR-01, METR-02, METR-03, METR-06, METR-07, EXPL-01, EXPL-02
**Success Criteria** (what must be TRUE):
  1. The default dashboard view shows PR size trends and commit size trends over time with multiple size signals (lines added/deleted, files touched) visible together on a single view
  2. All dashboard views default to cohort-level aggregates; no individual names, rankings, or productivity scores appear anywhere in the default view
  3. User can filter all views by date range using presets (30d, 90d, 1yr, all time) or a custom range picker
  4. User can filter all views by selected repo(s) when tracking multiple repos
  5. User can filter to a specific contributor for exploration — the filter is available but never the default, and shows contribution patterns not performance scores
  6. Trend narrative text appears alongside charts with plain-English insights (e.g., "New devs in Q3 2025 reached mid-sized PRs 2x faster than Q3 2024")
  7. All new components, hooks, and data transformations have corresponding tests covering rendering, edge cases, and data isolation
**Plans**: TBD

### Phase 6: Full UI Polish Pass
**Goal**: Address major UI issues across every page using the frontend-design skill for a comprehensive review and polish pass
**Depends on**: Phase 5
**Requirements**: TBD
**Success Criteria** (what must be TRUE):
  1. Every page passes a frontend-design skill review for visual quality, consistency, and usability
  2. UI issues identified across all pages are resolved
**Plans**: TBD

### Phase 7: Data Export with Anonymization
**Goal**: Users can export dashboard data (cohort metrics, ramp-up curves, rolling comparisons) in shareable formats with optional anonymization that replaces contributor names with consistent pseudonyms
**Depends on**: Phase 5
**Requirements**: TBD
**Success Criteria** (what must be TRUE):
  1. User can export any dashboard view's underlying data as CSV or JSON
  2. An anonymization toggle replaces all contributor identifiers (GitHub logins) with consistent pseudonyms — the same person gets the same pseudonym across exports within a session
  3. Exported data preserves cohort labels, time periods, and all metric values — only names are anonymized
  4. Export includes metadata (date range, repos included, filters applied) so the recipient understands the context
  5. Anonymized exports contain no reversible mapping back to real identities
**Plans**: TBD

## Backlog

### Phase 999.2: Multi-marker AI tool adoption timeline (BACKLOG)

**Goal:** Evolve single AI adoption marker date into multiple dated events (e.g., "Jun 2024 — Adopted Copilot", "Jan 2025 — Switched to Claude Code"). Replace `app_config` key with `ai_markers` table (date, label, tool_name). Update analytics queries to split by N boundaries instead of 1. Update dashboard to show multiple period bands on charts. Best done after Phase 5 dashboard exists so UX decisions are informed by real chart interactions.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 3.1 → 4 → 4.1 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/2 | Complete | - |
| 2. Auth & Repo Management | 3/3 | Complete | 2026-03-22 |
| 3. Data Collection Engine | 4/4 | Complete | - |
| 3.1 Recency-Optimized Collection | 4/4 | Complete | 2026-03-23 |
| 4. Query Service & Cohort Engine | 3/3 | Complete | 2026-03-25 |
| 4.1 Codebase Hardening | 0/3 | Not started | - |
| 5. Dashboard UI | 0/TBD | Not started | - |
| 6. UI Polish | 0/TBD | Not started | - |
| 7. Data Export | 0/TBD | Not started | - |
