---
phase: 02-auth-repo-management
plan: 03
subsystem: ui
tags: [react, tanstack-query, shadcn, checkbox, alert-dialog, repo-management]

# Dependency graph
requires:
  - phase: 02-auth-repo-management (plan 01)
    provides: Backend API routes for repo management (GET/POST/PATCH/DELETE /api/repos/*)
  - phase: 02-auth-repo-management (plan 02)
    provides: TanStack Query provider, NavBar, shared types, shadcn components

provides:
  - ReposPage.tsx — full repo selection and management UI with grouped checklist, search, stop/delete/re-add
  - LandingPage.tsx — 4-state machine (loading, needs-token, no-repos, has-repos) with TanStack Query cache sharing
  - App.tsx updated to render ReposPage for #/repos route

affects: [phase-03-data-collection, future-dashboard-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - TanStack Query cache sharing across pages (queryKey ['repos', 'tracked'] used in both ReposPage and LandingPage)
    - AlertDialog for destructive confirmation with async data fetch (delete-preview counts before showing dialog)
    - Checkbox indeterminate state for group select-all
    - useEffect to initialize selection state from server data on first load

key-files:
  created:
    - src/client/pages/ReposPage.tsx
  modified:
    - src/client/pages/LandingPage.tsx
    - src/client/App.tsx

key-decisions:
  - "ReposPage initializes selectedGithubIds from trackedData on first load via useEffect to pre-check already-tracked repos"
  - "Delete confirmation fetches counts async on click, shows 'Loading data counts...' in dialog body until resolved"
  - "Stop tracking uses mutateAsync + local stoppingIds Set for per-row loading state without blocking rest of UI"
  - "LandingPage uses enabled: state === 'no-repos' || state === 'has-repos' to defer repo fetch until token confirmed"

patterns-established:
  - "Shared TanStack Query cache: both landing and repos pages use queryKey ['repos', 'tracked'] — invalidating in ReposPage auto-refreshes LandingPage"
  - "Grouped owner list: personal repos labeled 'Personal' when ownerLogin === authenticatedLogin, orgs use org name"

requirements-completed: [AUTH-03, AUTH-04, AUTH-05, AUTH-06]

# Metrics
duration: 8min
completed: 2026-03-22
---

# Phase 2 Plan 3: Repos Page and Landing Page Update Summary

**React ReposPage with owner-grouped checklist, search/filter, shadcn AlertDialog delete confirmation, and 4-state LandingPage with shared TanStack Query cache**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-22T19:04:22Z
- **Completed:** 2026-03-22T19:12:00Z
- **Tasks:** 2 of 3 (Task 3 is human-verify checkpoint — paused)
- **Files modified:** 3

## Accomplishments

- ReposPage.tsx (528 lines) with full repo selection UI: owner groups, personal/org labels, select-all with indeterminate state, search filter with clear button, private badges, rate-limit warning at >5 repos selected
- Stop tracking (soft delete), delete data with AlertDialog showing commit/PR counts from /api/repos/:id/delete-preview, re-add stopped repos
- LandingPage updated to 4-state machine using TanStack Query — shares ['repos', 'tracked'] cache with ReposPage so landing page auto-updates when repos are added/removed
- App.tsx routes #/repos to real ReposPage component instead of placeholder

## Task Commits

1. **Task 1: ReposPage with grouped checklist, search, selection, and management actions** - `5bd70e1` (feat)
2. **Task 2: Update LandingPage with status overview and repos CTA using TanStack Query** - `140c73a` (feat)
3. **Task 3: Visual verification** — checkpoint:human-verify (not yet approved)

## Files Created/Modified

- `src/client/pages/ReposPage.tsx` (created) — Full repo selection and management page; 528 lines; grouped by owner, search, checkboxes, save/stop/delete/re-add
- `src/client/pages/LandingPage.tsx` (modified) — 4-state AppState, TanStack Query for repo data, no-repos and has-repos states
- `src/client/App.tsx` (modified) — Import and render ReposPage for #/repos route

## Decisions Made

- ReposPage pre-initializes checkbox selection from trackedData via useEffect — so already-tracked repos appear pre-checked on page load
- AlertDialog fetches delete-preview counts on button click (async), shows spinner message in dialog until counts resolve
- LandingPage `enabled` guard on useQuery prevents fetching repos before token is confirmed to avoid spurious requests
- Shared queryKey `['repos', 'tracked']` ensures ReposPage mutations that call `queryClient.invalidateQueries({ queryKey: ['repos'] })` automatically refresh LandingPage data

## Deviations from Plan

None — plan executed exactly as written. Import paths used `@shared/components/ui/` per Plan 02's shadcn install location decision recorded in STATE.md.

## Issues Encountered

None.

## Known Stubs

None — all UI data is wired to real API endpoints. No hardcoded or placeholder data flows to the rendered UI.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Full Phase 2 UI complete: nav bar, token auth, repo selection with management actions, landing page states
- Awaiting human verification of full end-to-end flow (Task 3 checkpoint)
- Phase 3 (data collection) can begin after Task 3 human approval — repos are now selectable and tracked in SQLite

## Self-Check

- [x] `src/client/pages/ReposPage.tsx` exists (528 lines, 150+ requirement met)
- [x] `src/client/pages/LandingPage.tsx` updated with TanStack Query and 4 states
- [x] `src/client/App.tsx` imports and renders ReposPage
- [x] Commits `5bd70e1` and `140c73a` exist
- [x] 32/32 tests pass
- [x] No TypeScript issues (vitest run passes, which compiles TypeScript)

## Self-Check: PASSED

---
*Phase: 02-auth-repo-management*
*Completed: 2026-03-22*
