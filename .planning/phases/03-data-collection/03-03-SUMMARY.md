---
phase: 03-data-collection
plan: 03
subsystem: ui
tags: [react, shadcn, sse, tabs, progress, collection-ui]

# Dependency graph
requires:
  - phase: 03-data-collection/02
    provides: "Collection API endpoints (start, stop, skip, status, progress SSE, settings/bots)"
provides:
  - "Collection tab with live progress display and per-repo status list"
  - "SSE hook for real-time collection progress"
  - "Bot accounts toggle in Settings"
  - "Data completeness badges on Repos tab"
affects: [04-analytics, 05-dashboard]

# Tech tracking
tech-stack:
  added: [shadcn-tabs, shadcn-progress, shadcn-separator, shadcn-switch]
  patterns: [sse-hook, tabbed-layout, live-progress-polling]

key-files:
  created:
    - src/client/hooks/useCollectionSSE.ts
    - src/shared/components/ui/tabs.tsx
    - src/shared/components/ui/progress.tsx
    - src/shared/components/ui/separator.tsx
    - src/shared/components/ui/switch.tsx
  modified:
    - src/client/pages/ReposPage.tsx
    - src/client/pages/SettingsPage.tsx

key-decisions:
  - "SSE hook auto-connects only when collection is active (enabled prop), avoids unnecessary connections"
  - "Collection status polling at 3s when active, 30s when idle for balance of responsiveness and efficiency"
  - "Data completeness badges shown on Repos tab using shared repoStatusMap from collection status query"

patterns-established:
  - "useCollectionSSE hook pattern: EventSource with enabled/disabled lifecycle management"
  - "Tabbed layout in ReposPage using base-ui Tabs (not radix) with value props"
  - "Live SSE data merged with polling data for immediate UI updates"

requirements-completed: [COLL-06, COLL-07, COLL-09]

# Metrics
duration: 4min
completed: 2026-03-22
---

# Phase 03 Plan 03: Collection UI Summary

**Collection tab with live SSE progress, per-repo status list, rate-limit banners, and bot toggle in Settings**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T21:00:14Z
- **Completed:** 2026-03-22T21:04:38Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- ReposPage restructured with tabbed layout (Repos + Collection tabs) using shadcn base-nova Tabs
- Collection tab shows live progress via SSE, per-repo status with icons/badges/item counts, rate-limit banners, and controls (Sync now, Stop all, Skip)
- Settings page has "Include bot accounts" toggle that persists preference via API
- Data completeness badges appear on Repos tab for repos with incomplete collection

## Task Commits

Each task was committed atomically:

1. **Task 1: Install shadcn components + create SSE hook** - `c810188` (feat)
2. **Task 2: ReposPage Collection tab with progress display, status list, and controls** - `a4a9d3a` (feat)
3. **Task 3: Settings page bot toggle** - `f78a3bf` (feat)

## Files Created/Modified
- `src/client/hooks/useCollectionSSE.ts` - React hook wrapping EventSource for live collection progress
- `src/shared/components/ui/tabs.tsx` - shadcn Tabs component (base-nova preset)
- `src/shared/components/ui/progress.tsx` - shadcn Progress bar component
- `src/shared/components/ui/separator.tsx` - shadcn Separator component
- `src/shared/components/ui/switch.tsx` - shadcn Switch toggle component
- `src/client/pages/ReposPage.tsx` - Restructured with tabbed layout, Collection tab with full status UI
- `src/client/pages/SettingsPage.tsx` - Added Contributor Analysis section with bot toggle

## Decisions Made
- SSE hook only connects when collection is active (enabled prop) to avoid unnecessary server connections
- Polling interval is 3s during active collection, 30s when idle -- balances responsiveness with server load
- Data completeness badges on Repos tab use the same collection status query as the Collection tab (shared repoStatusMap)
- Used base-ui Tabs (not radix) since shadcn base-nova preset generates base-ui components

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all UI elements are wired to real API endpoints from Plan 02.

## Next Phase Readiness
- Collection UI complete -- users can trigger, monitor, pause, and resume data collection
- Phase 03 Plan 04 (if any) or Phase 04 analytics can proceed
- All collection API endpoints from Plan 02 are now consumed by the frontend

---
*Phase: 03-data-collection*
*Completed: 2026-03-22*

## Self-Check: PASSED

All 7 files verified present. All 3 task commits verified in git log.
