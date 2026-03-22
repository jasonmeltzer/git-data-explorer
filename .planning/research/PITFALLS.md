# Pitfalls Research

**Domain:** Git analytics / engineering insights web app (local-first, GitHub API, SQLite)
**Researched:** 2026-03-22
**Confidence:** HIGH — multiple official sources, verified against GitHub docs, community post-mortems

---

## Critical Pitfalls

### Pitfall 1: GitHub Statistics Endpoints Silently Break at 10,000 Commits

**What goes wrong:**
The `/repos/{owner}/{repo}/stats/code_frequency` endpoint returns a 422 for repos with 10,000+ commits. The `/repos/{owner}/{repo}/stats/contributors` endpoint silently returns 0 for all addition/deletion counts at the same threshold. Code that works fine on small repos will produce empty or wrong data on large, active repos — the exact repositories an engineering leader most wants to analyze.

**Why it happens:**
GitHub's statistics endpoints pre-aggregate data in a background job. For repositories above 10,000 commits, GitHub stopped supporting per-commit diffstat aggregation via these endpoints. The contributor stats endpoint doesn't even error — it just returns zeroes, which looks like valid data.

**How to avoid:**
Do not rely on the `/stats/*` aggregate endpoints at all. Instead, fetch raw commit data with per-commit stats using `/repos/{owner}/{repo}/commits?per_page=100` and accumulate your own aggregations locally in SQLite. This is slower during collection but produces correct data at any repo size and keeps all data local for flexible querying.

**Warning signs:**
- Contributor addition/deletion counts all return 0 for a large repo
- A 422 response from `/stats/code_frequency`
- Dashboard shows flat/empty trend lines for repos you know are active

**Phase to address:**
Data collection phase (earliest). Establish the raw-commit collection pattern before any aggregation logic is built. Do not prototype with stats endpoints and switch later.

---

### Pitfall 2: Treating the Primary Rate Limit as the Only Constraint

**What goes wrong:**
You implement pause/resume logic keyed off the primary rate limit (5,000 req/hour), deploy it, and then get banned or severely throttled anyway because secondary rate limits triggered. GitHub enforces a separate 900-point-per-minute endpoint budget, a 100 concurrent request cap, and a 90-second CPU time limit per 60 seconds. Burst fetching — even well under 5,000/hour — can trigger these secondary limits, resulting in 403 or 429 responses. Retrying immediately after a 403 without respecting `retry-after` risks permanent integration ban.

**Why it happens:**
GitHub's secondary rate limit system is intentionally opaque — "some REST API endpoints have a different point cost that is not shared publicly." Most tutorials and Stack Overflow answers only discuss the primary hourly limit. Developers code against that and discover the secondary limits under real load.

**How to avoid:**
- Always check for and respect the `retry-after` response header before any retry
- Space sequential requests with a minimum 1-second delay between them (GitHub's documented recommendation for bulk operations)
- Implement exponential backoff for any 429 or 403 response
- Track `x-ratelimit-remaining` and proactively pause when it approaches 0, not after hitting 0
- Use a single sequential request queue — never fire parallel GitHub requests from the same token

**Warning signs:**
- Occasional 403 responses during collection that aren't rate-limit messages
- Collection works in development (slow, manual) but fails in automated runs
- "abuse detection triggered" in error response body

**Phase to address:**
Data collection phase. The HTTP client wrapper and rate limit manager must be the first infrastructure built, before any endpoint-specific logic.

---

### Pitfall 3: Incomplete Resume Logic That Re-fetches or Skips Data

**What goes wrong:**
The app fetches PRs and commits, stores them in SQLite, gets rate-limited, stops, and resumes next session. But the resume point is tracked by page number rather than by a stable cursor (SHA or created_at timestamp). GitHub's API pages shift as new PRs/commits are created. Page 5 on Monday is not the same data as page 5 on Tuesday. Result: data gaps or duplicates that silently corrupt cohort analyses.

**Why it happens:**
Page-number-based pagination feels intuitive. The correct approach — cursor-based pagination using the `Link` header's `next` URL, or SHA-based traversal for commits — requires more careful implementation.

**How to avoid:**
- For PRs: use the `since` parameter and track the `updated_at` of the last-fetched PR as a cursor
- For commits: the commits API paginates by SHA; traverse oldest-to-newest using `since`/`until` date parameters and store the SHA of the last collected commit as the resume point
- Use an `upsert` (INSERT OR REPLACE) pattern in SQLite so re-fetching the same commit/PR is idempotent
- Store collection state per-repo: `{repo_id, last_commit_sha, last_pr_updated_at, collection_status}`

**Warning signs:**
- Cohort sizes fluctuate unexpectedly between collection sessions
- "New developer" first-commit dates shift for existing contributors after re-collection
- Trend lines have unexplained dips or spikes at resumption points

**Phase to address:**
Data collection phase. The state tracking schema must be designed before the first collection run.

---

### Pitfall 4: Bot and Automation Commits Polluting Cohort Analyses

**What goes wrong:**
Repos with active CI/CD pipelines, dependency bots (Dependabot, Renovate), or release automation have non-human committers with consistent commit patterns. These accounts can appear as "new developers" and skew ramp-up curves. A repo migrating from another VCS creates a flood of historical commits attributed to a single "importer" account that looks like an impossibly productive new developer.

**Why it happens:**
The "first commit date as new developer" definition is purely mechanical — it has no concept of human vs. automated committer. Bots often have high commit counts, low message variation, and many 1-commit "authors." Research shows bots exhibit commit message template ratios that distinguish them from humans, but this requires active detection.

**How to avoid:**
- Maintain a configurable bot-filter list (GitHub usernames or email patterns: `[bot]`, `noreply@github.com`, common CI account names)
- GitHub's own bot accounts use the `[bot]` suffix in their login names — filter these by default
- Flag imports/bulk-history commits (e.g., a single author with 100+ commits on a single day in the first week of repo history) for user review
- Show the user the filtered-out committer list and allow manual overrides

**Warning signs:**
- A contributor with implausibly fast ramp-up (100+ commits in first week)
- Trend lines dominated by a single committer who isn't on the team
- Email patterns like `renovate[bot]@users.noreply.github.com` appearing in contributor lists

**Phase to address:**
Data processing / cohort analysis phase. Filter logic should be applied at query time (not during collection) so filters can be adjusted without re-fetching.

---

### Pitfall 5: The Surveillance Framing Problem Kills Adoption

**What goes wrong:**
The tool is built correctly but positioned, designed, or named in a way that reads as individual performance tracking. Engineering leaders decline to share it with their teams. Developers who discover it react negatively. The tool never gets validated because no one uses it honestly. In the worst case, it damages the user's credibility as a manager.

**Why it happens:**
Git analytics tools have a well-documented trust problem. 70% of engineers actively resist lines-of-code metrics. Tools that show per-individual data — even when the intent is to understand trends — are routinely interpreted as surveillance. UI choices like "leaderboards," "top contributors," and individual-focused default views prime users to misuse the data. The backlash is predictable and swift.

**How to avoid:**
- Default views must show cohort aggregates, never individual rankings
- Individual contributor filtering must be a drill-down, never the top-level view
- Copy throughout the app must use "trend" and "cohort" language, not "performance" or "productivity"
- The hero stat should be "how new developers ramp up over time" not "how much each developer commits"
- Never show a sorted list of individuals — if individual data appears, it should be non-comparative (one person's timeline, not a ranking)
- Consider a visible "This tool measures trends, not people" tagline or explainer on first launch

**Warning signs:**
- Users immediately asking "how do I sort by most commits?"
- Feedback that the tool "looks like a way to measure developer performance"
- Individual contributor filter placed prominently in the primary nav

**Phase to address:**
Every phase. This is a cross-cutting UX constraint, not a feature. Enforce it in design review before any dashboard UI is built, and re-verify at every milestone.

---

### Pitfall 6: SQLite Query Performance Degrades on Large Repo Collections

**What goes wrong:**
The app collects 50,000+ commits across several large repos. Dashboard queries that group, aggregate, and window over all commits become noticeably slow (2–5+ seconds). Users abandon the tool or trust it less because it feels broken.

**Why it happens:**
SQLite performs well at read-heavy workloads but only if indexes are designed for the query patterns. Analytics queries commonly involve GROUP BY date_trunc + WHERE repo_id + ORDER BY date — a combination that requires composite indexes, not single-column ones. Without them, SQLite falls back to full table scans. The problem doesn't appear during development with small test datasets.

**How to avoid:**
- Design the schema and indexes against the actual dashboard query patterns before populating data
- For cohort trend queries, the critical index is composite: `(repo_id, author_login, committed_at)`
- Enable WAL mode from day one: `PRAGMA journal_mode=WAL` — this decouples write sessions (API collection) from read sessions (dashboard)
- Enable memory-mapped I/O: `PRAGMA mmap_size=536870912` (512 MB) for in-memory-speed reads
- Run `PRAGMA optimize` at the end of each collection session
- Use `EXPLAIN QUERY PLAN` on all dashboard queries during development to verify index usage

**Warning signs:**
- Dashboard queries taking >500ms in development with a 10k-commit dataset
- `EXPLAIN QUERY PLAN` showing "SCAN TABLE" instead of "SEARCH TABLE USING INDEX"
- WAL file growing unboundedly during collection sessions

**Phase to address:**
Schema design phase (before first collection run). Add a performance test with a synthetic 100k-commit dataset as part of the dashboard phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use `/stats/contributors` endpoint instead of raw commits | Simpler collection code | Silently wrong data on repos with 10k+ commits; can't add custom aggregations | Never — use raw commits from day one |
| Track collection progress by page number | Trivial to implement | Data gaps/duplicates on resume; corrupts cohort analyses | Never for production data |
| No bot filtering | Faster MVP | Ramp-up curves polluted for repos with automation; misleading insights | Only for solo testing with known clean repos |
| Single-column indexes on `author_login` and `repo_id` separately | Obvious, quick to set up | Full table scans on multi-column aggregation queries | Only acceptable if total commits < 5,000 |
| Hardcode a fixed delay (e.g., 1 second) between API calls | Simple, works at low volume | Wastes collection time; doesn't respond to actual rate limit headroom | Acceptable in MVP; replace with header-driven throttling in Phase 2 |
| Expose individual contributor data in primary nav | Easier to build initially | Surveillance framing risk; undermines trust and adoption | Never |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GitHub REST API (commits) | Fetching `/commits` without `per_page=100` | Always set `per_page=100` (the max) to minimize request count; default is 30 |
| GitHub REST API (PR list) | Not filtering by `state=all` | Default is `state=open` — you'll miss closed/merged PRs entirely |
| GitHub REST API (commit detail) | Fetching individual commit detail for every commit to get stats | Commit list endpoint returns basic stats (`stats.additions`, `stats.deletions`) inline — no second request needed for most use cases |
| GitHub REST API (rate limits) | Only checking `x-ratelimit-remaining` header | Also check `x-ratelimit-used` and `retry-after`; secondary limits can trigger even when remaining > 0 |
| GitHub REST API (pagination) | Constructing `?page=N` URLs manually | Follow the `Link: <url>; rel="next"` header — don't construct pagination URLs yourself |
| GitHub OAuth | Storing access token in localStorage | Store in httpOnly cookie or server-side session; localStorage is XSS-accessible |
| SQLite (WAL) | Opening database without WAL mode | Set `PRAGMA journal_mode=WAL` on every connection open, before any queries |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Scanning all commits for every cohort query | Dashboard load >1s; gets slower as more repos are added | Composite index on `(repo_id, author_login, committed_at)` | Around 10,000+ commits |
| Calculating "new developer" status at query time | Slow cohort queries; repeated subselects | Pre-compute first_commit_date per author per repo into a `contributor_tenure` table on ingestion | Around 5,000+ commits |
| Fetching all rows into memory for aggregation | Node.js heap pressure; memory warnings | Push GROUP BY, date bucketing, and aggregation entirely into SQLite; never aggregate in application code | Around 50,000+ rows returned |
| WAL file growing without checkpoint | Reads slow down as WAL grows; database appears to freeze | Run `PRAGMA wal_checkpoint(TRUNCATE)` after each collection session completes | WAL > 50 MB (around 10,000+ uncommitted writes) |
| No index on `committed_at` for time-range filtering | Date-range dashboard queries scan entire commits table | Index on `committed_at` (or composite with repo_id) | Any repo with >1,000 commits |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing GitHub PAT or OAuth token in SQLite unencrypted | Token exfiltration if database file is accessed by another process or user on the machine | Store tokens in OS keychain (macOS Keychain, Windows Credential Manager) via a library like `keytar`; never persist to SQLite |
| Reflecting raw GitHub API error messages to the UI | Potential token or scope leakage in error text | Sanitize all error messages; log raw errors server-side only |
| Allowing arbitrary SQL passthrough from the dashboard URL | SQL injection if any user-controlled string reaches a raw query | Use parameterized queries exclusively; never string-concatenate repo names or author names into SQL |
| Exposing the local server on 0.0.0.0 | Any process on the local network can access the app and its GitHub token | Bind exclusively to 127.0.0.1; never to 0.0.0.0 |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing a "top contributors" list sorted by commit count | Immediately frames tool as productivity measurement; developers resist | Show cohort distributions (e.g., "median commits in months 0-3 for 2024 cohort") instead of rankings |
| Loading spinner with no ETA during initial data collection | User doesn't know if the app is working or stuck; abandons the session | Show a progress indicator with "X of ~Y commits collected" and "rate-limited — resuming in N minutes" |
| Hiding incomplete data behind an error state | User can't tell if the gap is a bug or expected rate-limit behavior | Show partial data with a clear "collection in progress" banner explaining what's missing and when to return |
| Using "productivity" or "performance" in any label or heading | Primes users to misuse the tool for individual evaluation | Use "contribution patterns," "ramp-up trends," "cohort behavior" exclusively |
| Making the AI adoption marker date a required setup step | User can't explore the tool without knowing their "AI adoption date" | Make it optional; default to showing full history; let users add the marker as an annotation after exploring |
| Dashboard defaults to current month only | Trend analysis requires historical context; new users see a nearly empty chart | Default to trailing 12 months; prompt the user to add a marker date once they've seen the data |

---

## "Looks Done But Isn't" Checklist

- [ ] **Rate limit handling:** Verify that the collection loop correctly handles `retry-after` headers from secondary rate limit 429s, not just primary limit exhaustion — these are different response shapes
- [ ] **Resume logic:** Verify that stopping collection mid-run and restarting produces the same final dataset as a single uninterrupted run (idempotency test)
- [ ] **Bot filtering:** Verify that known bot accounts (Dependabot, Renovate, GitHub Actions bot) are excluded from contributor lists and cohort calculations before any user testing
- [ ] **10k commit repos:** Verify the app collects correct stats for a repo with >10,000 commits — test with a large open-source repo, not just your own
- [ ] **Surveillance framing:** Before any user testing, have someone outside the project review every label, heading, and default view for surveillance-adjacent language
- [ ] **WAL checkpoint:** Verify that after a large collection session, a WAL checkpoint is triggered and the WAL file shrinks — not just that writes succeed
- [ ] **OAuth token storage:** Verify that the GitHub token is stored in the OS keychain, not in SQLite, localStorage, or a dotfile
- [ ] **Cohort stability:** Verify that cohort membership (new dev vs. tenured) does not change between collection sessions for the same contributor — first_commit_date must be immutable once set

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Stats endpoint used instead of raw commits | HIGH — schema redesign, full re-collection | Migrate schema to raw commit table; drop aggregated data; re-collect from scratch (could take multiple sessions for large repos) |
| Page-number resume corrupted data | MEDIUM | Drop and re-collect affected repos; implement cursor-based state tracking |
| Missing indexes causing slow dashboard | LOW | Add composite indexes without data loss; run `ANALYZE` after |
| Bot commits in historical data | LOW | Add bot filter; re-run cohort materialization queries against existing collected data — no re-fetch needed |
| Token stored insecurely | MEDIUM | Migrate token storage to OS keychain; rotate the PAT/OAuth token as a precaution |
| Surveillance framing in shipped UI | MEDIUM — trust damage is hard to undo | Rename all labels; change default views; communicate the change to users; requires re-education |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Stats endpoints break at 10k commits | Data collection (Phase 1) | Test against a public repo with >10k commits (e.g., `facebook/react`) during collection development |
| Primary vs. secondary rate limits | Data collection (Phase 1) | Simulate 429 with `retry-after` header in test; verify exponential backoff triggers |
| Incomplete resume / cursor logic | Data collection (Phase 1) | Interrupt collection mid-run; verify idempotent re-run produces same dataset |
| Bot commit pollution | Data processing / cohort (Phase 2) | Verify Dependabot and Actions bot commits are excluded from contributor lists |
| Surveillance framing | UX / dashboard (Phase 2) and every phase | Design review checklist before each new UI component ships |
| SQLite query performance | Schema design (Phase 1) + dashboard (Phase 2) | Benchmark all dashboard queries against a 100k-commit synthetic dataset |
| WAL mode and checkpointing | Schema / infrastructure (Phase 1) | Verify WAL mode is set on connection open; verify checkpoint runs after collection |
| Token security | Auth / infrastructure (Phase 1) | Verify token is not present in SQLite file or localStorage in any environment |

---

## Sources

- [GitHub REST API Rate Limits — Official Docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — HIGH confidence
- [GitHub Repository Statistics Endpoints — Official Docs](https://docs.github.com/en/rest/metrics/statistics?apiVersion=2022-11-28) — HIGH confidence (10k commit limit confirmed)
- [GitHub Best Practices for REST API — Official Docs](https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api) — HIGH confidence
- [Understanding GitHub API Rate Limits: REST, GraphQL, and Beyond — GitHub Community Discussion](https://github.com/orgs/community/discussions/163553) — MEDIUM confidence
- [SQLite Performance Tuning — phiresky's blog](https://phiresky.github.io/blog/2020/sqlite-performance-tuning/) — HIGH confidence (extensively cited, technically verified)
- [Making SQLite Analytics Great Again — Oldmoe's blog, March 2025](https://oldmoe.blog/2025/03/12/making-sqlite-analytics-great-again/) — MEDIUM confidence
- [SQLite Write-Ahead Logging — Official SQLite Docs](https://www.sqlite.org/wal.html) — HIGH confidence
- [Git Analytics: Challenges, Tools & Key Metrics — Axify](https://axify.io/blog/git-analytics) — MEDIUM confidence
- [Why 70% of Engineers Avoid Measuring Lines of Code — LeadDev](https://leaddev.com/reporting/why-70-of-engineers-avoid-measuring-lines-of-code/) — MEDIUM confidence
- [Why I Built a Local-First Git Analytics Tool — Medium, Dec 2025](https://skorudzhiev.medium.com/why-i-built-a-local-first-git-analytics-tool-without-ai-3602f8893139) — LOW confidence (single practitioner account)
- [Detecting and Characterizing Bots that Commit Code — CMU STRUDEL, MSR 2020](https://cmustrudel.github.io/papers/msr20bots.pdf) — HIGH confidence (peer-reviewed)
- [A Developer's Guide: Managing Rate Limits for the GitHub API — Lunar.dev](https://www.lunar.dev/post/a-developers-guide-managing-rate-limits-for-the-github-api) — MEDIUM confidence
- [Return-to-Office Wars: How Monitoring Data Fueled the 2025 Corporate Revolt — CompanionLink, 2025](https://www.companionlink.com/blog/2025/05/return-to-office-wars-how-monitoring-data-fueled-the-2025-corporate-revolt/) — MEDIUM confidence

---
*Pitfalls research for: Git Data Explorer — git analytics / engineering insights web app*
*Researched: 2026-03-22*
