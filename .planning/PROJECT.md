# Git Data Explorer

## What This Is

A local-first web application for engineering leaders to understand how AI tools are changing code contribution patterns across their GitHub repositories. It connects to the GitHub API, caches commit and PR data in a local SQLite database, and presents trend dashboards with drill-down exploration — showing how the nature of code changes is evolving over time, not measuring individual developer productivity.

## Core Value

Engineering leaders can see concrete, data-backed trends in how code contributions are changing across their org — especially how AI adoption is accelerating new developer ramp-up and shifting the size and shape of PRs and commits.

## Requirements

### Validated

- [x] All data cached in local SQLite — never re-fetches already-cached data (Validated in Phase 01: Foundation — SQLite DB with WAL mode, Drizzle ORM schema)
- [x] Local-first web app runs on user's machine (Validated in Phase 01: Foundation — Hono server + Vite React SPA)

### Active

- [ ] User authenticates with GitHub and selects one or more repos from their org
- [ ] App fetches PR and commit data via GitHub API with smart rate-limit handling (pause, cache, resume later)
- [ ] All data cached in local SQLite — never re-fetches already-cached data
- [ ] User can add/remove repos over time; cached data persists unless explicitly deleted
- [ ] Dashboard shows PR size trends over time (lines added/deleted, files touched)
- [ ] Dashboard shows individual commit size trends over time (lines, files, insertions vs deletions)
- [ ] User can set a marker date ("when we adopted AI") to compare before/after periods
- [ ] Rolling trend views (month-over-month, quarter-over-quarter)
- [ ] Contributor detection from git history — "new dev" defined by first commit date in the repo
- [ ] Cohort analysis by tenure (0-3mo, 3-12mo, 1yr+) as the primary grouping for trends
- [ ] New dev ramp-up analysis: how quickly new devs reach meaningful contribution sizes, compared across time periods
- [ ] Individual contributor filtering available but not positioned as productivity measurement
- [ ] Drill-down explorer to investigate specific repos, time ranges, and cohorts
- [ ] App communicates clearly when data collection is incomplete due to rate limits and when to return

### Out of Scope

- Individual developer productivity scoring or ranking — contradicts the core mission
- Real-time monitoring or alerting — this is a retrospective analysis tool
- Code quality analysis (test coverage, bug rates, review comments) — focus is on contribution patterns, not code quality
- Non-GitHub sources (GitLab, Bitbucket) — GitHub-only for v1
- Team/org management features (permissions, roles) — single-user local tool
- SaaS/hosted deployment — local-first for now

## Context

The motivation comes from firsthand experience seeing dramatic shifts in contribution patterns after adopting Claude Code. The founder wrote an article documenting these trends and wants to make the analysis accessible to other engineering leaders. The key insight is that AI tools don't just make existing developers faster — they change the fundamental shape of how code enters a repository, and this is most visible when looking at new developer ramp-up curves.

The GitHub API has rate limits (5,000 requests/hour for authenticated users) which becomes a real constraint when fetching commit-level data for large repos. The incremental collection pattern (fetch what you can, pause at limits, resume next session) is a core architectural requirement, not an afterthought.

Privacy and trust matter: engineering leaders will only use this tool if they trust it won't become a surveillance tool. The framing, UI language, and default views must reinforce that this is about understanding trends, not evaluating people.

## Constraints

- **Data source**: GitHub API only — must handle rate limits gracefully with incremental collection
- **Storage**: SQLite local database — no cloud dependency, data stays on user's machine
- **Deployment**: Local-first web app — runs on the user's machine
- **Privacy framing**: All UI copy, default views, and documentation must reinforce trend analysis, not individual evaluation
- **Data volume**: Must handle repos with thousands of commits efficiently — both in API collection and in query/display performance

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Local SQLite over cloud DB | Data privacy, zero infrastructure, works offline after collection | ✓ Validated Phase 01 |
| First commit date for "new dev" | Zero manual setup, purely derived from git history | — Pending |
| Cohort analysis as primary view | Reinforces trend-over-individuals framing | — Pending |
| Incremental API collection with pause/resume | GitHub rate limits make full collection impractical in one session for large repos | — Pending |
| Multiple size signals (lines, files, insertions/deletions) | Single metric oversimplifies; multiple signals give richer picture | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-22 after Phase 01 completion*
