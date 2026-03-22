# Requirements: Git Data Explorer

**Defined:** 2026-03-22
**Core Value:** Engineering leaders can see concrete, data-backed trends in how AI adoption is changing code contribution patterns — especially new developer ramp-up

## v1 Requirements

### Authentication & Setup

- [x] **AUTH-01**: User can authenticate with GitHub using a Personal Access Token
- [ ] ~~**AUTH-02**: User can authenticate with GitHub using OAuth device flow (browser-based)~~ — **Deferred to v2**
- [x] **AUTH-03**: User can browse and select repos from their GitHub org to track
- [x] **AUTH-04**: User can add new repos to track at any time
- [x] **AUTH-05**: User can remove repos from tracking (data persists unless explicitly deleted)
- [x] **AUTH-06**: User can explicitly delete cached data for a repo

### Data Collection

- [ ] **COLL-01**: App fetches PR data from GitHub API for selected repos
- [ ] **COLL-02**: App fetches commit data from GitHub API for selected repos
- [ ] **COLL-03**: All fetched data is cached in local SQLite — never re-fetches already-cached data
- [ ] **COLL-04**: Collection uses cursor-based state (commit SHA, PR updated_at) for correct incremental resume
- [ ] **COLL-05**: App detects GitHub rate limits (both primary 5k/hr and secondary 900pts/min) and pauses collection gracefully
- [ ] **COLL-06**: App shows progress during collection (repos completed, data fetched vs estimated remaining)
- [ ] **COLL-07**: App communicates clearly when collection is paused due to rate limits and when to return
- [ ] **COLL-08**: Collection resumes from where it left off across app restarts
- [ ] **COLL-09**: App shows data completeness state — which repos/date ranges are fully collected vs partial
- [ ] **COLL-10**: Bot accounts (Dependabot, Renovate, GitHub Actions) are filtered from contributor analysis

### Core Metrics & Charts

- [ ] **METR-01**: Dashboard shows PR size trends over time (lines added, lines deleted, files touched)
- [ ] **METR-02**: Dashboard shows commit size trends over time (lines changed, files touched, insertions vs deletions)
- [ ] **METR-03**: Dashboard shows multiple size signals together on the same view
- [ ] **METR-04**: User can set an AI adoption marker date that splits all views into before/after periods
- [ ] **METR-05**: Dashboard shows rolling trend comparisons (month-over-month, quarter-over-quarter)
- [ ] **METR-06**: User can filter all views by date range (presets: 30d, 90d, 1yr, all time; plus custom range)
- [ ] **METR-07**: Dashboard shows trend narrative text alongside charts (plain-English insights like "New devs in Q3 2025 ramped up 2x faster than Q3 2024")

### Cohort & Ramp-Up Analysis

- [ ] **COHT-01**: App detects contributor tenure from first commit date in each repo (zero manual setup)
- [ ] **COHT-02**: Dashboard groups contributors into tenure cohorts (0-3mo, 3-12mo, 1yr+) as the primary analysis view
- [ ] **COHT-03**: Dashboard shows new developer ramp-up curves — time from first commit to meaningful contribution sizes
- [ ] **COHT-04**: User can compare ramp-up curves across time periods (e.g., devs who joined in 2024 vs 2025)
- [ ] **COHT-05**: Cohort views reinforce trend analysis framing — no individual ranking, scoring, or productivity measurement

### Filtering & Exploration

- [ ] **EXPL-01**: User can filter views by individual contributor (available but not positioned as primary view)
- [ ] **EXPL-02**: User can filter views by selected repo(s) when tracking multiple repos

### Infrastructure

- [x] **INFR-01**: All data stored in local SQLite database — no cloud dependency
- [x] **INFR-02**: App runs as a local-first web application on user's machine
- [x] **INFR-03**: GitHub token stored in gitignored `.env` file with UI settings page for entry

## v2 Requirements

### Exploration (Deferred)

- **EXPL-03**: Drill-down from trend chart point to the specific PRs/commits behind it
- **EXPL-04**: Repo-to-repo comparison view for orgs with multiple tracked repos

### Advanced Analysis (Deferred)

- **ADVN-01**: Configurable threshold for "meaningful contribution size" in ramp-up curves
- **ADVN-02**: Export charts and data as images or CSV
- **ADVN-03**: Custom cohort definitions beyond tenure (e.g., by team, by role)

### Authentication (Deferred)

- **AUTH-02**: User can authenticate with GitHub using OAuth device flow (browser-based) — PAT-only sufficient for v1

### Enhanced Collection (Deferred)

- **COLL-11**: Scheduled periodic re-fetches to keep data fresh
- **COLL-12**: GitHub GraphQL API option for more efficient combined queries

## Out of Scope

| Feature | Reason |
|---------|--------|
| Individual developer productivity scores or rankings | Contradicts core mission; creates surveillance culture |
| DORA metrics (deploy frequency, MTTR, etc.) | Requires CI/CD pipeline data not available from git |
| Code quality metrics (test coverage, bug rates) | Different domain; dilutes contribution-pattern focus |
| Real-time monitoring or alerting | This is a retrospective analysis tool |
| AI-attributed code detection | GitHub/Copilot don't reliably tag AI-generated code; heuristics would be misleading |
| Non-GitHub sources (GitLab, Bitbucket) | GitHub-only for v1; validate concept first |
| Multi-user/team permissions | Single-user local tool |
| Gamification or leaderboards | Contradicts privacy framing |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 2 | Complete |
| AUTH-02 | v2 | Deferred |
| AUTH-03 | Phase 2 | Complete |
| AUTH-04 | Phase 2 | Complete |
| AUTH-05 | Phase 2 | Complete |
| AUTH-06 | Phase 2 | Complete |
| COLL-01 | Phase 3 | Pending |
| COLL-02 | Phase 3 | Pending |
| COLL-03 | Phase 3 | Pending |
| COLL-04 | Phase 3 | Pending |
| COLL-05 | Phase 3 | Pending |
| COLL-06 | Phase 3 | Pending |
| COLL-07 | Phase 3 | Pending |
| COLL-08 | Phase 3 | Pending |
| COLL-09 | Phase 3 | Pending |
| COLL-10 | Phase 3 | Pending |
| METR-01 | Phase 5 | Pending |
| METR-02 | Phase 5 | Pending |
| METR-03 | Phase 5 | Pending |
| METR-04 | Phase 4 | Pending |
| METR-05 | Phase 4 | Pending |
| METR-06 | Phase 5 | Pending |
| METR-07 | Phase 5 | Pending |
| COHT-01 | Phase 4 | Pending |
| COHT-02 | Phase 4 | Pending |
| COHT-03 | Phase 4 | Pending |
| COHT-04 | Phase 4 | Pending |
| COHT-05 | Phase 4 | Pending |
| EXPL-01 | Phase 5 | Pending |
| EXPL-02 | Phase 5 | Pending |
| INFR-01 | Phase 1 | Complete |
| INFR-02 | Phase 1 | Complete |
| INFR-03 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after roadmap creation*
