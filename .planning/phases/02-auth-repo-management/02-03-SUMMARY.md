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
    - Sticky bottom action bar pattern for forms with scrollable content

key-files:
  created:
    - src/client/pages/ReposPage.tsx
  modified:
    - src/client/pages/LandingPage.tsx
    - src/client/App.tsx
    - src/shared/components/ui/checkbox.tsx

key-decisions:
  - "ReposPage initializes selectedGithubIds from trackedData on first load via useEffect to pre-check already-tracked repos"
  - "Delete confirmation fetches counts async on click, shows 'Loading data counts...' in dialog body until resolved"
  - "Stop tracking uses mutateAsync + local stoppingIds Set for per-row loading state without blocking rest of UI"
  - "LandingPage always enables tracked repos query (no enabled guard) so shared cache is immediately visible on mount"
  - "handleSave computes repos to stop (tracked but unchecked) and calls stopMutation for each before saving new selection"
  - "Select All label toggles to Unselect All when group is fully selected; global Unselect All button clears all"
  - "Checkbox visibility improved: border-2 border-gray-400 bg-white makes unchecked state clearly visible"

patterns-established:
  - "Shared TanStack Query cache: both landing and repos pages use queryKey ['repos', 'tracked'] — invalidating in ReposPage auto-refreshes LandingPage"
  - "Grouped owner list: personal repos labeled 'Personal' when ownerLogin === authenticatedLogin, orgs use org name"
  - "Save handler diff pattern: compare current selection against server state to compute add/stop deltas"

requirements-completed: [AUTH-03, AUTH-04, AUTH-05, AUTH-06]

# Metrics
duration: ~15min (including post-checkpoint bug fixes)
completed: 2026-03-22
---

# Phase 2 Plan 3: Repos Page and Landing Page Update Summary

**React ReposPage with owner-grouped checklist, search/filter, shadcn AlertDialog delete confirmation, 4-state LandingPage with shared TanStack Query cache — including post-checkpoint UX bug fixes**

## Performance

- **Duration:** ~15 min (initial build + post-checkpoint fixes)
- **Started:** 2026-03-22T19:04:22Z
- **Completed:** 2026-03-22 (post-checkpoint)
- **Tasks:** 3 of 3 (Task 3 human-verify complete after bug fixes)
- **Files modified:** 4

## Accomplishments

- ReposPage.tsx with full repo selection UI: owner groups, personal/org labels, select-all with indeterminate state, search filter with clear button, private badges, rate-limit warning at >5 repos selected
- Stop tracking (soft delete), delete data with AlertDialog showing commit/PR counts from /api/repos/:id/delete-preview, re-add stopped repos
- LandingPage updated to 4-state machine using TanStack Query — shares ['repos', 'tracked'] cache with ReposPage so landing page auto-updates when repos are added/removed
- App.tsx routes #/repos to real ReposPage component instead of placeholder
- Post-checkpoint bug fixes: checkbox visibility, cache update timing, stop-tracking on uncheck, sticky save bar, select/unselect all toggle

## Task Commits

1. **Task 1: ReposPage with grouped checklist, search, selection, and management actions** - `5bd70e1` (feat)
2. **Task 2: Update LandingPage with status overview and repos CTA using TanStack Query** - `140c73a` (feat)
3. **Fix: Checkbox visibility** - `a83d9c5` (fix)
4. **Fix: LandingPage cache always enabled** - `3a1b42b` (fix)
5. **Fix: Stop tracking on uncheck + save** - `8fbd10d` (fix)
6. **Fix: Sticky save bar + select all toggle** - `7c1c5f3` (fix)

## Files Created/Modified

- `src/client/pages/ReposPage.tsx` (created) — Full repo selection and management page; grouped by owner, search, checkboxes, save/stop/delete/re-add; sticky action bar; select/unselect all toggle
- `src/client/pages/LandingPage.tsx` (modified) — 4-state AppState, TanStack Query for repo data (always enabled), no-repos and has-repos states
- `src/client/App.tsx` (modified) — Import and render ReposPage for #/repos route
- `src/shared/components/ui/checkbox.tsx` (modified) — Improved unchecked state visibility with border-2 border-gray-400 bg-white

## Decisions Made

- ReposPage pre-initializes checkbox selection from trackedData via useEffect — so already-tracked repos appear pre-checked on page load
- AlertDialog fetches delete-preview counts on button click (async), shows spinner message in dialog until counts resolve
- LandingPage `enabled` guard removed from useQuery — `/api/repos` queries local SQLite (no token needed), always safe to call; fixes stale cache issue
- Shared queryKey `['repos', 'tracked']` ensures ReposPage mutations auto-refresh LandingPage data
- `handleSave` computes delta: repos tracked but now unchecked are stopped first, then new selection is saved
- Select All label text is conditional: shows "Unselect all" when entire group is checked, "Select all" otherwise

## Deviations from Plan

### Auto-fixed Issues (Post-Checkpoint)

**1. [Rule 1 - Bug] Checkbox invisible when unchecked**
- **Found during:** Task 3 (human verify)
- **Issue:** `border-input` CSS variable resolved to near-invisible color in light mode; unchecked checkboxes appeared blank
- **Fix:** Changed to `border-2 border-gray-400 bg-white` for visible unchecked state
- **Files modified:** `src/shared/components/ui/checkbox.tsx`
- **Commit:** `a83d9c5`

**2. [Rule 1 - Bug] LandingPage showed stale data after navigating from ReposPage**
- **Found during:** Task 3 (human verify)
- **Issue:** `enabled: state === 'no-repos' || state === 'has-repos'` delayed query until async token check completed; on fast navigation the cache hadn't updated yet
- **Fix:** Removed `enabled` guard — `/api/repos` is a local SQLite query requiring no GitHub token
- **Files modified:** `src/client/pages/LandingPage.tsx`
- **Commit:** `3a1b42b`

**3. [Rule 1 - Bug] Unchecking a tracked repo did not stop tracking it**
- **Found during:** Task 3 (human verify)
- **Issue:** `handleSave` only sent repos to add; deselected tracked repos were never stopped
- **Fix:** `handleSave` now computes which tracked repos are unchecked and calls `stopMutation.mutateAsync` for each before saving
- **Files modified:** `src/client/pages/ReposPage.tsx`
- **Commit:** `8fbd10d`

**4. [Rule 2 - UX] Save button hard to find at bottom of long list**
- **Found during:** Task 3 (human verify)
- **Issue:** Save button scrolled off screen on repos-heavy lists
- **Fix:** Moved to sticky bottom bar fixed to viewport; added `pb-24` to page container
- **Files modified:** `src/client/pages/ReposPage.tsx`
- **Commit:** `7c1c5f3`

**5. [Rule 2 - UX] No way to unselect all / Select All didn't toggle**
- **Found during:** Task 3 (human verify)
- **Issue:** "Select all" label didn't change when group was fully selected; no global deselect
- **Fix:** Label toggles to "Unselect all" when `allSelected === true`; global "Unselect all" button clears `selectedGithubIds`
- **Files modified:** `src/client/pages/ReposPage.tsx`
- **Commit:** `7c1c5f3`

## Known Stubs

None — all UI data is wired to real API endpoints. No hardcoded or placeholder data flows to the rendered UI.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Full Phase 2 UI complete: nav bar, token auth, repo selection with management actions, landing page states
- Human-verified flow complete including all post-checkpoint fixes
- Phase 3 (data collection) can begin — repos are selectable, tracked in SQLite, and the full management lifecycle (add/stop/delete/re-add) is verified working

## Self-Check

- [x] `src/client/pages/ReposPage.tsx` exists and updated with all fixes
- [x] `src/client/pages/LandingPage.tsx` updated (always-enabled query)
- [x] `src/client/App.tsx` imports and renders ReposPage
- [x] `src/shared/components/ui/checkbox.tsx` updated with visible border
- [x] Commits `5bd70e1`, `140c73a`, `a83d9c5`, `3a1b42b`, `8fbd10d`, `7c1c5f3` all exist

## Self-Check: PASSED

---
*Phase: 02-auth-repo-management*
*Completed: 2026-03-22*
