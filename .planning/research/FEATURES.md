# Feature Research

**Domain:** Git analytics / engineering insights web app (AI adoption focus)
**Researched:** 2026-03-22
**Confidence:** HIGH for table stakes (well-established market); MEDIUM for differentiators (niche AI-impact angle is newer)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features engineering leaders assume any git analytics tool provides. Missing these makes the product feel unfinished before they even reach the core value.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| GitHub OAuth authentication | Every analytics tool connects to GitHub this way | LOW | Personal access token as fallback; OAuth preferred |
| Repo selection and management | Users must choose what to analyze; add/remove over time | LOW | Multi-repo support expected from day one |
| PR metrics over time | PR counts, size (lines added/deleted), merge rates are baseline | MEDIUM | Time-series charts are the standard display |
| Commit metrics over time | Commit frequency, size (lines changed, files touched) | MEDIUM | Raw commit data is assumed present |
| Date range filtering | Users need to scope views to meaningful time windows | LOW | Calendar picker + presets (last 30d, 90d, 1yr) |
| Contributor breakdown | Who is contributing; how much | LOW | Must be available even if not the primary view |
| Data persistence between sessions | Re-fetching everything on each visit is unacceptable | MEDIUM | Local caching is the mechanism here (SQLite) |
| Loading/progress indicators | Long data fetches need visible progress | LOW | Critical for GitHub API pagination runs |
| Trend line charts | Time-series display is expected for git metrics | MEDIUM | Line charts over bar charts for trend clarity |
| Rolling period comparisons | Month-over-month, quarter-over-quarter views | MEDIUM | Users expect to compare periods, not just see absolutes |

### Differentiators (Competitive Advantage)

These features set this product apart from general-purpose tools like LinearB, Jellyfish, or Pluralsight Flow. They match the core thesis: AI tools change the shape of code contributions, and this is most visible in new developer ramp-up.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| AI adoption marker / before-after comparison | Single date stamp that splits all views into pre/post AI; unique framing | MEDIUM | Jellyfish's 2025 data shows 113% PR volume increase pre/post adoption — this is what users want to see for their own org |
| Cohort analysis by tenure (0–3mo, 3–12mo, 1yr+) | Separates signal (AI changes new dev ramp-up) from noise (senior dev habits change slowly) | HIGH | GitClear has cohort reports but they're buried; this product makes cohort the primary view |
| New developer ramp-up curve | Shows how quickly new devs reach meaningful contribution sizes, then compares those curves across time periods | HIGH | This is the killer insight — AI flattens the ramp-up curve dramatically; no other tool surfaces this directly |
| First-commit-date as tenure proxy | Zero-config tenure detection from git history alone | LOW | GitClear requires manual input; deriving from first commit eliminates setup friction |
| Local-first / privacy-by-design framing | Data never leaves the machine; no vendor access to org data | MEDIUM | Strong trust differentiator for privacy-conscious engineering leaders; SaaS tools can't match this claim |
| Incremental collection with explicit progress + "return later" UX | Shows exactly what data has been collected and what remains; lets user close and resume | HIGH | GitHub's 5k req/hr limit makes this a real UX problem; most tools hide it or fail silently |
| Multiple size signals shown together | Lines added, lines deleted, files changed, insertions/deletions ratio on same chart | MEDIUM | Single metric (just LOC) oversimplifies; richer signal set enables better conclusions |
| Trend narrative copy | Dashboard surfaces plain-English interpretations alongside charts | MEDIUM | "New devs hired in Q3 2025 ramped up 2x faster than Q3 2024 cohort" — reduces time-to-insight |
| Drill-down explorer from trend to specific PRs/commits | Lets users validate trends by looking at actual PRs, not just aggregates | HIGH | Builds trust in the data; prevents "what's actually in that spike?" confusion |
| Data completeness communication | Explicit UI state for partial data; clear indication of what is and isn't collected yet | LOW | Most tools pretend data is complete; honesty here is a trust feature |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Individual developer productivity scores / rankings | Managers want accountability; seems like natural extension of the data | Creates surveillance culture, developer distrust, gaming behavior; contradicts the tool's core trust premise; will cause adoption failure | Cohort-level views only; individual filtering available but never ranked or scored |
| Real-time monitoring and alerting | "Tell me when something looks wrong" | This tool's value is retrospective trend analysis; real-time adds infrastructure complexity and changes the mental model from exploration to operations | Schedule periodic re-fetches; let users manually trigger updates |
| Code quality metrics (test coverage, bug rates, review sentiment) | Seems like natural add-on to contribution data | Code quality is a fundamentally different domain with different data sources; dilutes the "contribution shape" focus | Out of scope explicitly; users who want this should use SonarQube, CodeClimate, etc. |
| DORA metrics (deployment frequency, change failure rate, MTTR) | Industry standard; every competitor has it | DORA requires deployment pipeline data (CI/CD, incident trackers) not available from git commits alone; half-baked DORA is worse than no DORA | If DORA is requested post-launch, treat it as a separate integration project |
| Multi-VCS support (GitLab, Bitbucket) | Broader market | Each VCS has a different API, different authentication model, different data shape; massive scope expansion | GitHub-only for v1; validate the concept first |
| Team/group management and permissions | Enterprise wants to control who sees what | Single-user local tool; adding multi-user auth inverts the architecture | If multi-user is needed, that's a SaaS product, not a local tool |
| AI-attributed code detection ("which lines did Copilot write?") | Sounds like the natural next step | GitHub Copilot and other tools do not reliably tag AI-generated code in git metadata; any detection would be heuristic and misleading | Focus on contribution pattern changes (observable) not AI attribution (unreliable); the before/after marker achieves the same insight more honestly |
| Gamification / developer leaderboards | Engagement, "fun" | Directly contradicts privacy framing; encourages gaming metrics | Cohort comparison achieves the "am I improving" insight without ranking individuals |

---

## Feature Dependencies

```
GitHub OAuth / PAT
    └──requires──> Repo selection
                       └──requires──> Data collection (API fetch with rate limiting)
                                          └──requires──> SQLite caching layer
                                                             └──requires──> PR metrics dashboard
                                                             └──requires──> Commit metrics dashboard

SQLite caching layer
    └──enables──> Incremental collection (fetch what's missing, skip what's cached)
    └──enables──> Data completeness tracking (know what date ranges are fully collected)

PR metrics (raw)
    └──requires for──> Cohort analysis by tenure
    └──requires for──> Before/after AI marker views
    └──requires for──> Rolling period comparisons (MoM, QoQ)

Contributor detection (first commit date)
    └──requires for──> Cohort assignment (0–3mo, 3–12mo, 1yr+)
    └──requires for──> New developer ramp-up curves

Cohort analysis (basic grouping)
    └──requires for──> Ramp-up curve comparison across time periods

Date range filtering
    └──enhances──> All chart views
    └──enables──> Before/after AI marker comparison

PR/commit metrics (time series)
    └──enhances with──> Drill-down explorer (click trend → see contributing PRs/commits)

Individual contributor filtering
    ──conflicts with framing of──> Productivity scoring (filtering OK; ranking is not)
```

### Dependency Notes

- **Data collection requires SQLite caching:** The incremental collection pattern (pause at rate limit, resume next session) is impossible without a durable local store. This is a foundational architectural dependency, not an add-on.
- **Cohort analysis requires contributor detection:** Tenure-based cohorts (0–3mo, etc.) depend on knowing each contributor's first commit date. This detection must happen at data ingest time, not query time.
- **Before/after marker requires clean time-series data:** The AI adoption date marker only delivers value if the underlying time series has enough pre- and post- data. Data completeness tracking is therefore a prerequisite for this feature to be trustworthy.
- **Ramp-up curve comparison requires historical cohort data:** To compare "Q1 2024 new dev cohort" vs "Q1 2025 new dev cohort," the tool needs commit data going back far enough to capture both cohorts' full ramp-up arc (typically 6–12 months per cohort).
- **Drill-down explorer enhances trend charts:** The explorer is a second layer on top of aggregated views. It requires the same underlying data but presents it at a different granularity. It can be built after the aggregate views are stable.

---

## MVP Definition

### Launch With (v1)

Minimum set to validate that the core thesis (AI changes new dev ramp-up) is observable and valuable to engineering leaders.

- [ ] GitHub OAuth + repo selection — without data there is no product
- [ ] Incremental API collection with rate-limit handling and resumability — required for real repos; without this the tool fails on any org with >500 PRs
- [ ] SQLite caching (never re-fetch cached data) — makes the tool usable after the first session
- [ ] Data completeness indicator — users must know what they're looking at is incomplete and when to return
- [ ] PR size trends over time (lines added/deleted, files changed) — primary signal for "how has code shape changed"
- [ ] Commit size trends over time — secondary signal supporting PR trends
- [ ] AI adoption marker (set a date, split all views before/after) — this is the core differentiator and must be present at launch
- [ ] Cohort analysis by tenure (0–3mo, 3–12mo, 1yr+) as the primary grouping — this is the framing that makes the story legible
- [ ] New developer ramp-up curve (time-to-meaningful-contribution size by cohort) — the killer insight that validates the thesis
- [ ] Rolling comparisons (MoM, QoQ) — expected baseline; without this trends are hard to interpret
- [ ] Individual contributor filter (for exploration, not ranking) — needed for drill-down without becoming a surveillance feature

### Add After Validation (v1.x)

Features to add once engineering leaders confirm the core thesis holds for their orgs.

- [ ] Drill-down explorer (click a trend point → see contributing PRs) — trust-building feature; add when users ask "what's in that spike?"
- [ ] Trend narrative copy (plain-English summaries alongside charts) — reduces time-to-insight; add when onboarding friction is identified
- [ ] Repo comparison (side-by-side views for multiple repos) — requested when users have AI-adopted and non-AI-adopted repos they want to compare
- [ ] Export (CSV, PNG) — add when users want to share findings with their broader leadership

### Future Consideration (v2+)

Defer until there is evidence of demand and the core is stable.

- [ ] DORA metrics integration — only if deployment pipeline data sources are in scope; do not build half-baked DORA
- [ ] Scheduled/automatic re-fetch — only after the manual refresh UX is validated
- [ ] Team/group labeling (manual groupings beyond tenure cohorts) — adds configuration overhead; defer until cohort model proves insufficient

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| GitHub OAuth + repo selection | HIGH | LOW | P1 |
| Incremental API collection + rate limit handling | HIGH | HIGH | P1 |
| SQLite caching (incremental fetch) | HIGH | MEDIUM | P1 |
| Data completeness indicator | HIGH | LOW | P1 |
| PR size trends (time series) | HIGH | MEDIUM | P1 |
| Commit size trends (time series) | HIGH | MEDIUM | P1 |
| AI adoption date marker / before-after split | HIGH | MEDIUM | P1 |
| Cohort analysis by tenure (primary grouping) | HIGH | HIGH | P1 |
| New developer ramp-up curve by cohort | HIGH | HIGH | P1 |
| Rolling period comparisons (MoM, QoQ) | MEDIUM | MEDIUM | P1 |
| Individual contributor filter | MEDIUM | LOW | P1 |
| Drill-down explorer (trend → PRs/commits) | HIGH | HIGH | P2 |
| Trend narrative copy (plain-English summaries) | MEDIUM | MEDIUM | P2 |
| Repo comparison (side-by-side) | MEDIUM | MEDIUM | P2 |
| Export (CSV, PNG) | LOW | LOW | P2 |
| DORA metrics | LOW | HIGH | P3 |
| Scheduled auto-refresh | LOW | MEDIUM | P3 |
| Team/group labeling | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature | LinearB / Jellyfish / Pluralsight Flow | GitClear | Git Data Explorer (this tool) |
|---------|----------------------------------------|----------|-------------------------------|
| PR size and cycle time metrics | Yes — table stakes for all | Yes | Yes — core feature |
| DORA metrics | Yes — centerpiece of all three | Partial | Out of scope (v1) |
| Cohort analysis by developer tenure | No — org-level aggregates only | Yes (private charts) | Yes — primary framing |
| New developer ramp-up curves | No | Partial (buried) | Yes — primary differentiator |
| AI adoption before/after marker | No explicit feature; Jellyfish shows aggregate AI adoption trends | No | Yes — core differentiator |
| Jira/project management integration | Yes — all three require it | No | Out of scope (git-only) |
| Individual developer scoring/ranking | Yes (controversial; all three face backlash) | Partial | Explicitly excluded |
| Data stays local / no cloud | No — all are SaaS | No — SaaS | Yes — local SQLite |
| GitHub rate limit transparency | Not visible to users | Not visible | Explicit UX feature |
| Free / self-hosted | LinearB has free tier; others are paid SaaS | Paid SaaS | Local tool (no SaaS cost) |
| Setup friction | High (Jira integration required for full value) | Medium | Low (GitHub OAuth only) |

**Key competitive gap this tool fills:** No existing tool combines cohort-based ramp-up analysis, an explicit AI adoption date marker, and a local-first privacy model. GitClear is the closest competitor on cohort analysis but is a paid SaaS product that still centers individual metrics and lacks the before/after framing.

---

## Sources

- [Jellyfish 2025 AI Metrics in Review](https://jellyfish.co/blog/2025-ai-metrics-in-review/) — before/after PR volume and cycle time data on AI adoption
- [GitClear — Software Engineering Intelligence Platform](https://www.gitclear.com/) — cohort report feature, AI code quality research
- [GitClear Q3/Q4 2025 Updates: Making AI Visible with Cohorts](https://www.gitclear.com/blog/q3_q4_2025_updates_ai_visible_cohorts_context_engineering_truth) — cohort + AI visibility feature direction
- [Git Analytics: Challenges, Tools & Key Metrics — Axify](https://axify.io/blog/git-analytics) — pitfalls of individual scoring, recommended team-level metrics
- [How to measure AI's impact on your engineering team — DX](https://getdx.com/blog/measure-ai-impact/) — measurement framework for AI adoption impact
- [Developer Onboarding and Ramp-Up Time — Abi Noda / DX Newsletter](https://newsletter.getdx.com/p/developer-onboarding-time) — cohort validity for evaluating programs vs individuals
- [LinearB vs Pluralsight Flow comparison — G2](https://www.g2.com/compare/linearb-vs-pluralsight-flow) — competitor feature coverage
- [GitHub Analytics Guide — Graphite](https://graphite.com/guides/github-statistics-and-analytics) — standard metrics expected by engineering leaders
- [AI Copilot Code Quality 2025 Research — GitClear](https://www.gitclear.com/ai_assistant_code_quality_2025_research) — data on AI's observable impact on code contribution metrics

---

*Feature research for: git analytics / engineering insights (AI adoption focus)*
*Researched: 2026-03-22*
