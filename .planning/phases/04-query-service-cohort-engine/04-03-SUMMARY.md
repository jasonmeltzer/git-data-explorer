---
phase: 04-query-service-cohort-engine
plan: 03
subsystem: api
tags: [hono, date-fns, zod, analytics, rolling-window, month-over-month, quarter-over-quarter, vitest]

# Dependency graph
requires:
  - phase: 04-query-service-cohort-engine plan 01
    provides: analytics-cohorts.ts, analytics-config.ts, cohort types in shared/types.ts
  - phase: 04-query-service-cohort-engine plan 02
    provides: analytics-rampup.ts, RampUpBucket/RampUpParams types
provides:
  - Rolling window comparison service (month-over-month and quarter-over-quarter)
  - Partial period normalization via daily averages (D-14)
  - Hono analytics route with 6 HTTP endpoints (GET/POST /api/analytics/marker, cohorts/commits, cohorts/prs, rampup, rolling)
  - All Phase 4 analytics services wired to HTTP API
affects: [phase-05-dashboard-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - UTC-safe date boundary computation using Date.UTC() to avoid local timezone issues in period calculations
    - Partial period normalization: normalizeToDaily caps effectiveEnd to `now` for fair MoM/QoQ comparison
    - Percentage change helper (pctChange) returns null when prior=0 to avoid divide-by-zero

key-files:
  created:
    - src/server/services/analytics-rolling.ts
    - src/server/__tests__/analytics-rolling.test.ts
    - src/server/routes/analytics.ts
  modified:
    - src/shared/types.ts
    - src/server/index.ts

key-decisions:
  - "UTC-safe date boundary math: used Date.UTC() instead of date-fns startOfMonth/startOfQuarter to avoid local timezone offset issues in period boundary calculations"
  - "pctChange returns null (not 0 or Infinity) when prior period value is 0 — callers (UI) can distinguish 'no data' from 'zero change'"
  - "Daily average normalization for MoM/QoQ: percentage changes computed on dailyAvg* fields, not raw totals — ensures fair comparison when current period is partial"

patterns-established:
  - "Deviation Rule 0 (none): plan executed as specified, no deviations needed"

requirements-completed: [METR-05]

# Metrics
duration: 3min
completed: 2026-03-25
---

# Phase 04 Plan 03: Rolling Window + Analytics Route Summary

**Rolling window comparison service (MoM/QoQ with partial period normalization) and Hono analytics route exposing all Phase 4 services as HTTP endpoints ready for Phase 5 Dashboard UI**

## Performance

- **Duration:** 2m 51s
- **Started:** 2026-03-25T19:11:10Z
- **Completed:** 2026-03-25T19:14:01Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Implemented `analytics-rolling.ts` with `getRollingComparison`, `pctChange`, `normalizeToDaily`, `getMonthOverMonthPeriods`, and `getQuarterOverQuarterPeriods` — all exported for unit testing
- Partial period normalization (D-14): `normalizeToDaily` caps `endDate` to `now`, so a 10-day current month is compared to a 28-day prior month on equal (per-day) footing
- Created `analytics.ts` Hono route with 6 endpoints: GET/POST `/api/analytics/marker`, GET `/api/analytics/cohorts/commits`, GET `/api/analytics/cohorts/prs`, GET `/api/analytics/rampup`, GET `/api/analytics/rolling`
- All endpoints use Zod `safeParse` for parameter validation with 400 responses on invalid input and 500 on unexpected errors
- Mounted analytics route in `server/index.ts`; full test suite passes (172 tests, 13 files)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rolling window comparison service and tests** - `4975cc9` (feat)
2. **Task 2: Analytics Hono route and server mount** - `5b2af34` (feat)

**Plan metadata:** (docs commit follows)

_Note: Task 1 used TDD (RED→GREEN), 18 tests written and passing_

## Files Created/Modified

- `src/server/services/analytics-rolling.ts` - Rolling window comparison service with MoM/QoQ period helpers, pctChange, normalizeToDaily, and getRollingComparison
- `src/server/__tests__/analytics-rolling.test.ts` - 18 tests covering pctChange, normalizeToDaily, period boundary helpers, getRollingComparison for both granularities, bot exclusion, and incomplete repo exclusion
- `src/server/routes/analytics.ts` - Hono route file with 6 analytics endpoints (marker GET/POST, cohorts/commits, cohorts/prs, rampup, rolling)
- `src/shared/types.ts` - Added RollingGranularity, RollingPeriod, RollingComparisonResult, RollingPeriodMetrics, RollingPeriodChanges, RollingComparisonParams types
- `src/server/index.ts` - Added analytics route import and mount

## Decisions Made

- **UTC-safe period boundaries**: Used `Date.UTC()` directly instead of date-fns `startOfMonth`/`startOfQuarter` — avoids local timezone offset issues when computing period start/end for epoch comparisons in SQLite
- **pctChange returns null on zero prior**: Allows UI to distinguish "no prior data" from "0% change" — important for empty-repo scenarios
- **Daily average normalization for changes**: Percentage changes in `RollingPeriodChanges` are computed on `dailyAvg*` fields (not raw totals) so a 10-day current month is fairly compared to a 28-day prior month

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all endpoints call real service functions that query live SQLite data.

## Next Phase Readiness

- All Phase 4 analytics services are wired to HTTP endpoints: cohort metrics, ramp-up curves, rolling window comparisons, and AI marker config
- Phase 5 (Dashboard UI) can consume: GET `/api/analytics/rolling`, GET `/api/analytics/cohorts/commits`, GET `/api/analytics/cohorts/prs`, GET `/api/analytics/rampup`, GET/POST `/api/analytics/marker`
- No blockers

---
*Phase: 04-query-service-cohort-engine*
*Completed: 2026-03-25*
