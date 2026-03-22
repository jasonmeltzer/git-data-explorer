# Project Research Summary

**Project:** Git Data Explorer
**Domain:** Local-first GitHub analytics dashboard — AI adoption impact on developer ramp-up
**Researched:** 2026-03-22
**Confidence:** HIGH

## Executive Summary

Git Data Explorer is a local-first web analytics tool that helps engineering leaders measure how AI coding tools change the shape of code contributions — with specific focus on new developer ramp-up curves. The canonical build pattern is a two-process local architecture: a Hono API server backed by a SQLite database (via better-sqlite3 + Drizzle ORM) serving a Vite/React SPA in the browser. Data collection runs as a background process using the GitHub REST API with the Octokit throttling plugin, storing raw commits and pull requests incrementally to SQLite so the tool remains usable across sessions and survives rate-limit interruptions.

The key differentiator is combining three things no competitor currently unifies: cohort-based developer tenure analysis (0–3 months, 3–12 months, 1 year+), an explicit AI adoption date marker that splits all views into before/after, and a privacy-by-design local-first architecture where data never leaves the user's machine. GitClear is the closest competitor on cohort analysis but is a paid SaaS tool and lacks the before/after AI framing. LinearB and Jellyfish show AI adoption aggregate trends but not the cohort-level ramp-up curves that make the insight actionable.

The three highest-risk areas for this project are data collection correctness, framing/trust, and query performance. GitHub's stats endpoints silently break on repos with 10,000+ commits — the tool must collect raw commit data from the start. The GitHub rate limit system has a secondary per-minute budget that most tutorials ignore, and bursting requests can trigger bans. Most critically, any UI choice that frames the tool as individual productivity measurement will kill adoption; cohort-level aggregates must be the default and primary view at every stage.

## Key Findings

### Recommended Stack

The stack is a tight, well-validated set of tools for a local full-stack TypeScript application. The two-process model (Hono server + Vite SPA) avoids the overhead of Electron (200MB+) while providing the same local-only UX. Node.js 22 LTS is the target runtime — Node 24/25 should be avoided because better-sqlite3's native bindings have active build failures there. The most critical version constraint is better-sqlite3 v11.x (not v12.x, which has build issues on Node 22+).

**Core technologies:**
- Node.js 22 LTS: runtime — LTS stability, native ESM, confirmed better-sqlite3 compatibility
- TypeScript 5.x: shared types flow from DB schema through API layer to chart components
- Hono 4.x (Node adapter): local API server — 4x faster than Express, TypeScript-first
- better-sqlite3 11.x: synchronous SQLite driver — no async complexity for a single-writer local DB
- Drizzle ORM 0.45.x: schema definition, migrations, typed queries — SQL-first, 7kb, zero runtime deps
- React 19.x + Vite 8.x: SPA frontend — no SSR needed, Rolldown-based builds are 10–30x faster than Webpack
- @octokit/rest 21.x + @octokit/plugin-throttling 9.x: GitHub API client with automatic rate-limit retry
- TanStack Query 5.x: async boundary between Hono API and React components (DevTools invaluable)
- shadcn/ui + Recharts 3.x: 53 chart primitives copy-pasted into the repo; no extra dependency tree
- Drizzle Kit: schema migrations + local DB browser during development
- Zod 3.x: validate GitHub API response shapes before SQLite insertion
- date-fns 3.x: rolling window math (month-over-month, quarter-over-quarter), cohort tenure bucketing

**What to avoid:** Electron, Prisma, Chart.js, D3 directly, Webpack/CRA, Next.js, the experimental `node:sqlite` module, and better-sqlite3 v12.x.

### Expected Features

The market baseline for git analytics tools includes: GitHub authentication, repo selection, PR and commit metrics over time, date range filtering, contributor breakdown, data persistence, progress indicators, trend line charts, and rolling period comparisons. Any missing table-stakes feature makes the product feel incomplete before users reach the core value.

**Must have (table stakes + core differentiators for v1):**
- GitHub OAuth / PAT auth + repo selection — without data there is no product
- Incremental API collection with rate-limit handling and pause/resume — required for any org with >500 PRs
- SQLite caching with data completeness indicator — users must know what they're looking at
- PR size trends over time (lines added/deleted, files changed) — primary signal
- Commit size trends over time — secondary supporting signal
- AI adoption date marker (set one date, split all views before/after) — core differentiator
- Cohort analysis by tenure (0–3mo, 3–12mo, 1yr+) as the primary grouping — the framing that makes the story legible
- New developer ramp-up curve by cohort — the killer insight validating the thesis
- Rolling period comparisons (MoM, QoQ) — baseline expectation
- Individual contributor filter (exploration only, never ranking)

**Should have after validation (v1.x):**
- Drill-down explorer (click a trend point, see contributing PRs/commits) — trust-building
- Trend narrative copy (plain-English summaries alongside charts) — reduces time-to-insight
- Repo comparison (side-by-side for AI-adopted vs. non-adopted repos)
- Export (CSV, PNG)

**Defer to v2+:**
- DORA metrics integration — requires deployment pipeline data not available from git alone
- Scheduled/automatic re-fetch
- Team/group labeling beyond tenure cohorts

**Explicit anti-features (never build):**
- Individual developer productivity scores or rankings
- Real-time monitoring and alerting
- AI-attributed code detection (unreliable in git metadata)
- Multi-VCS support (v1 is GitHub-only)

### Architecture Approach

The architecture separates data collection from data querying via a persistent SQLite layer. The Hono server handles both: it runs the Collection Orchestrator as a background process (or worker thread) writing raw GitHub data to SQLite, and it serves the Query Service over REST to the React SPA. The React frontend never calls GitHub directly — it reads only from SQLite via the Hono API, enabling the pause-and-resume rate-limit behavior.

**Major components:**
1. Database Layer (Drizzle + better-sqlite3) — schema, migrations, connection singleton; everything else depends on this
2. GitHub API Client (Octokit + throttling plugin) — rate-limit-aware fetcher, ETag caching per page, secondary limit handling
3. Collection Orchestrator — checkpoint-based incremental fetcher; reads/writes cursor state to `collection_jobs` table; pauses on rate-limit and persists resume point
4. Query Service — analytics SQL: cohort groupings, time-bucketing, before/after comparisons, rolling windows; drops to raw SQL for window functions Drizzle can't express
5. Hono IPC/API Layer — thin dispatch routing REST calls to collection and query services; validates inputs; returns typed JSON
6. React SPA — charts (shadcn/Recharts), filters, date pickers, collection progress UI; all data via TanStack Query to the Hono API

**Key architectural patterns:**
- Checkpoint-based incremental collection: write cursor position before fetching, advance after processing, resume from cursor on restart — never by page number
- Pre-aggregated SQLite views for dashboard queries once data volume grows past ~100k rows
- Shared TypeScript types in `shared/types.ts` enforce API contract between Hono handlers and React hooks

**Build order dictated by dependency graph:** Database layer → GitHub API client → Collection Orchestrator → Hono API layer → Query Service → Collection UI → Dashboard charts → Drill-down Explorer.

### Critical Pitfalls

1. **GitHub stats endpoints silently break at 10k commits** — Never use `/stats/contributors` or `/stats/code_frequency`. Collect raw commits via `/repos/{owner}/{repo}/commits?per_page=100` and accumulate aggregations locally in SQLite. The stats endpoint returns zeroes for large repos, not errors — the bug is invisible until you test against a real large repo.

2. **Secondary GitHub rate limits cause bans** — The 5,000 req/hour primary limit is not the only constraint. There is a separate 900 points/minute budget, 100 concurrent request cap, and 90-second CPU limit. Bursting requests — even within hourly budget — triggers 429/403 responses. Retrying without respecting `retry-after` risks a permanent integration ban. Use a sequential request queue with a minimum 100ms delay between calls; implement exponential backoff on any 4xx.

3. **Page-number-based resume corrupts cohort data** — GitHub API pages shift as new PRs/commits are created. Track collection state with stable cursors: SHA-based for commits, `updated_at` timestamp for PRs. Use upsert (INSERT OR REPLACE) so re-fetching is idempotent. Page-number tracking produces data gaps or duplicates that silently corrupt ramp-up curves.

4. **Bot and automation commits pollute cohort analyses** — Dependabot, Renovate, GitHub Actions bots, and VCS migration importers appear as "new developers" and skew ramp-up curves. Filter `[bot]` suffix accounts by default at query time (not collection time) so filters can be adjusted without re-fetching. Flag any account with 100+ commits on a single day in their first week.

5. **Surveillance framing kills adoption** — Any UI that reads as individual performance tracking causes engineering leaders to hide the tool from their teams and developers to resist it. Enforce cohort-only default views from day one. Never show sorted individual rankings. Use "contribution patterns," "ramp-up trends," and "cohort behavior" language everywhere — never "productivity" or "performance." This is a cross-cutting constraint enforced at every phase, not a feature to add later.

## Implications for Roadmap

The research points clearly to a four-phase structure driven by the component dependency graph and the critical pitfalls that must be addressed before any user-visible work.

### Phase 1: Data Infrastructure and Collection

**Rationale:** The database schema, GitHub API client, and Collection Orchestrator must be built before anything else — the dashboard is meaningless without correct, resumable data collection. The three most damaging pitfalls (stats endpoints, secondary rate limits, page-number cursors) all live here and are impossible to fix cheaply after data has been collected. Establishing WAL mode, composite indexes, and token security belongs here too.

**Delivers:** A working incremental collection pipeline that fetches commits and PRs, handles rate limits gracefully, persists checkpoints, and resumes correctly across sessions. No UI beyond a basic CLI or minimal status page.

**Addresses from FEATURES.md:** GitHub OAuth/PAT auth, incremental API collection, SQLite caching, data completeness tracking

**Avoids from PITFALLS.md:** Stats endpoint silent failures, secondary rate limit bans, cursor-based resume correctness, token security (keychain storage, not SQLite), WAL mode and checkpointing from day one

**Research flag:** NEEDS RESEARCH — the Octokit device flow + throttling plugin integration and the exact collection_jobs schema design have enough edge cases to warrant a focused phase research pass.

### Phase 2: Query Service and Cohort Analysis Engine

**Rationale:** With collected data available, the next dependency is the Query Service — the analytics SQL layer that powers all dashboard views. Cohort assignment (computing `first_commit_date` per author per repo into a `contributor_tenure` table) must be done at ingestion time, and this is also where bot filtering logic belongs. Getting cohort correctness right before any charting work prevents the ramp-up curves from being misleading.

**Delivers:** A tested Query Service that produces correct cohort groupings, rolling windows, before/after AI marker comparisons, and aggregated PR/commit stats. Includes bot-filtering logic applied at query time.

**Addresses from FEATURES.md:** Cohort analysis by tenure, AI adoption marker data model, rolling period comparisons, contributor detection (first-commit-date as tenure proxy)

**Avoids from PITFALLS.md:** Bot commit pollution of cohort analyses, query performance degradation (composite indexes, pre-aggregated views), calculating new-developer status at query time instead of ingestion time

**Research flag:** STANDARD PATTERNS — SQL window functions, cohort bucketing, and SQLite performance tuning are well-documented. Skip research phase here.

### Phase 3: Dashboard UI — Core Charts and AI Marker

**Rationale:** This is the first user-visible phase. The surveillance framing constraint must be enforced before a single component ships — default views must show cohort aggregates, labels must avoid "productivity" language, and no sorted individual lists may appear. The AI adoption marker and ramp-up curves are the product's reason for existing and must be present at launch.

**Delivers:** The full primary dashboard: PR size trends, commit size trends, cohort-level ramp-up curves, before/after AI marker view, date range filtering, rolling period comparisons, individual contributor filter (drill-down only), and collection progress UI with rate-limit banners.

**Addresses from FEATURES.md:** PR metrics, commit metrics, AI adoption marker, cohort ramp-up curves, rolling comparisons, individual contributor filter, data completeness indicator, progress/loading states

**Avoids from PITFALLS.md:** Surveillance framing (design review checklist required before any component ships), missing data shown as errors instead of partial-data banners, dashboard defaulting to current month (default to trailing 12 months), AI marker as a required setup step (make it optional)

**Research flag:** STANDARD PATTERNS — shadcn/Recharts chart components are well-documented. The cohort ramp-up curve chart may need a custom Recharts implementation; review shadcn's 53 chart primitives before deciding.

### Phase 4: Drill-Down Explorer and Polish

**Rationale:** The drill-down explorer is explicitly a trust-building feature — it lets users click a trend spike and see the actual PRs contributing to it. It requires all underlying query types to be stable, so it comes last. Trend narrative copy (plain-English summaries) and export (CSV, PNG) also belong here.

**Delivers:** Drill-down explorer (trend point → contributing PRs/commits), trend narrative copy alongside charts, CSV/PNG export, repo comparison side-by-side view, and any UX polish identified during Phase 3 user testing.

**Addresses from FEATURES.md:** Drill-down explorer, trend narrative copy, repo comparison, export — all v1.x features

**Avoids from PITFALLS.md:** Individual data surfaced without comparative framing (explorer shows one person's timeline, never a ranking), incomplete data shown as errors

**Research flag:** STANDARD PATTERNS — TanStack Table + shadcn table primitives for the explorer are well-documented.

### Phase Ordering Rationale

- Phases 1 and 2 are infrastructure and cannot be reversed. The stats endpoint pitfall alone justifies collecting raw commits before any aggregation logic is built — fixing it later requires a full schema redesign and re-collection.
- Phase 3 is gated on Phase 2: you cannot build accurate charts without a correct query layer, and cohort correctness must be verified before any user sees data.
- Phase 4 is explicitly last because the drill-down explorer exercises the full stack and is most valuable once users have seen the trends and want to investigate specifics.
- The surveillance framing constraint cuts across all phases but is most critical in Phase 3. A design review checkpoint should be scheduled before Phase 3 UI work begins.

### Research Flags

Phases needing deeper research during planning:
- **Phase 1:** Octokit device flow authentication + throttling plugin integration; `collection_jobs` schema design for cursor-based resumability; token storage via OS keychain (`keytar`) — these have enough integration complexity to justify a focused research pass before implementation.

Phases with standard patterns (skip research-phase):
- **Phase 2:** SQL cohort bucketing, window functions, SQLite index design — well-documented patterns
- **Phase 3:** shadcn/ui + Recharts chart components — official docs are comprehensive; only the custom ramp-up curve chart may need investigation, which can be done in-phase
- **Phase 4:** TanStack Table + shadcn table primitives — well-documented

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Version numbers verified against npm/official sources; better-sqlite3 v12 build issues confirmed via GitHub issues; Vite 8 and Recharts 3 confirmed released |
| Features | HIGH for table stakes; MEDIUM for differentiators | Table stakes well-established; AI adoption marker + cohort ramp-up framing is newer (niche), supported by Jellyfish 2025 data and GitClear research |
| Architecture | HIGH for process model and IPC patterns; MEDIUM for cohort query architecture | Process model from official Electron/Node docs; cohort SQL patterns derived from general SQL knowledge, not a domain-specific source |
| Pitfalls | HIGH | Stats endpoint 10k limit confirmed in official GitHub docs; secondary rate limits from official docs + community post-mortems; bot detection from peer-reviewed CMU research; surveillance framing from multiple practitioner sources |

**Overall confidence:** HIGH

### Gaps to Address

- **Octokit device flow in practice:** The architecture research describes using `@octokit/auth-oauth-device` for local auth, but the practical integration with Hono and the token storage via `keytar` has not been verified end-to-end. Phase 1 research should include a working prototype of the auth flow before full implementation.
- **Cohort ramp-up curve chart:** No specific shadcn or Recharts primitive maps directly to a "time-to-meaningful-contribution by cohort" visualization. This will likely require a custom Recharts composition. The exact chart design should be prototyped in Phase 3 before committing to the data shape.
- **Collection performance on very large orgs:** The architecture notes that collecting 50+ repos with 1M+ commits could take days under rate-limit constraints. No research identified a practical mitigation beyond serial collection by priority. This gap should be surfaced to the user in the collection UI and acknowledged in documentation.
- **First-commit-date stability for force-pushed histories:** If a repo has had its history rewritten (force push), the "first commit date" for existing contributors could shift. The correctness guarantee in PITFALLS.md (cohort membership must not change between sessions) may be violated in pathological cases. Decide whether to warn users about repos with evidence of history rewriting or simply document the limitation.

## Sources

### Primary (HIGH confidence)
- GitHub REST API Rate Limits (official): https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- GitHub Repository Statistics Endpoints (official): https://docs.github.com/en/rest/metrics/statistics — 10k commit limit confirmed
- GitHub Best Practices for REST API (official): https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api
- SQLite Write-Ahead Logging (official SQLite docs): https://www.sqlite.org/wal.html
- SQLite Performance Tuning — phiresky's blog: https://phiresky.github.io/blog/2020/sqlite-performance-tuning/
- Detecting and Characterizing Bots that Commit Code — CMU STRUDEL, MSR 2020: https://cmustrudel.github.io/papers/msr20bots.pdf
- better-sqlite3 Node 22 compatibility: https://github.com/WiseLibs/better-sqlite3/discussions/1245
- better-sqlite3 v12 Node 22 build issues: https://github.com/WiseLibs/better-sqlite3/issues/1411
- Drizzle ORM npm: https://www.npmjs.com/package/drizzle-orm (v0.45.1 confirmed latest)
- Vite 8 release: https://vite.dev/blog/announcing-vite8
- React 19 release: https://react.dev/blog/2024/12/05/react-19
- Recharts 3.x migration: https://github.com/recharts/recharts/wiki/3.0-migration-guide

### Secondary (MEDIUM confidence)
- Jellyfish 2025 AI Metrics in Review: https://jellyfish.co/blog/2025-ai-metrics-in-review/ — before/after PR volume and cycle time data on AI adoption
- GitClear Q3/Q4 2025 Updates: https://www.gitclear.com/blog/q3_q4_2025_updates_ai_visible_cohorts_context_engineering_truth — cohort + AI visibility direction
- Hono vs Express comparison — BetterStack: https://betterstack.com/community/guides/scaling-nodejs/fastify-vs-express-vs-hono/
- Managing GitHub API Rate Limits — Lunar.dev: https://www.lunar.dev/post/a-developers-guide-managing-rate-limits-for-the-github-api
- SQLite Analytics — Oldmoe's blog (March 2025): https://oldmoe.blog/2025/03/12/making-sqlite-analytics-great-again/
- TanStack Query vs SWR 2025 — Refine: https://refine.dev/blog/react-query-vs-tanstack-query-vs-swr-2025/
- Git Analytics: Challenges, Tools & Key Metrics — Axify: https://axify.io/blog/git-analytics
- Developer Onboarding and Ramp-Up Time — DX Newsletter: https://newsletter.getdx.com/p/developer-onboarding-time
- Why 70% of Engineers Avoid Measuring Lines of Code — LeadDev: https://leaddev.com/reporting/why-70-of-engineers-avoid-measuring-lines-of-code/

### Tertiary (LOW confidence)
- Why I Built a Local-First Git Analytics Tool — Medium, Dec 2025: https://skorudzhiev.medium.com/why-i-built-a-local-first-git-analytics-tool-without-ai-3602f8893139 — single practitioner account; directional only

---
*Research completed: 2026-03-22*
*Ready for roadmap: yes*
