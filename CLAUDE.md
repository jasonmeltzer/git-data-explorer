<!-- GSD:project-start source:PROJECT.md -->
## Project

**Git Data Explorer**

A local-first web application for engineering leaders to understand how AI tools are changing code contribution patterns across their GitHub repositories. It connects to the GitHub API, caches commit and PR data in a local SQLite database, and presents trend dashboards with drill-down exploration — showing how the nature of code changes is evolving over time, not measuring individual developer productivity.

**Core Value:** Engineering leaders can see concrete, data-backed trends in how code contributions are changing across their org — especially how AI adoption is accelerating new developer ramp-up and shifting the size and shape of PRs and commits.

### Constraints

- **Data source**: GitHub API only — must handle rate limits gracefully with incremental collection
- **Storage**: SQLite local database — no cloud dependency, data stays on user's machine
- **Deployment**: Local-first web app — runs on the user's machine
- **Privacy framing**: All UI copy, default views, and documentation must reinforce trend analysis, not individual evaluation
- **Data volume**: Must handle repos with thousands of commits efficiently — both in API collection and in query/display performance
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 24.x LTS | Runtime for the local server process | LTS stability, ships with native ESM, good SQLite support. Pinned via `.nvmrc` + `engines.node` range. Avoid Node 25 (non-LTS, EOL 2026-06); if upgrading past 24, jump to Node 26 LTS when it lands (~Oct 2026) for maximum support runway. |
| TypeScript | 5.x | Type safety across frontend and backend | Shared types between API layer and UI are essential for this project — DB schema types flow directly to chart components. |
| Vite | 8.x | Frontend dev server and build tool | No SSR needed for a local app. Vite 8 uses Rolldown (Rust-based), delivers 10-30x faster builds than Webpack. Much lighter than Next.js for a local SPA. |
| React | 19.x | UI framework | Current stable; has concurrent features, improved hooks. shadcn/ui and Recharts both support React 19. |
| Hono | 4.x | Local HTTP API server (Node.js adapter) | TypeScript-first, 4x faster than Express, same simple routing model. Perfect for the local REST API layer between SQLite and the React frontend. Express is a fine fallback but Hono is clearly the modern choice for new projects. |
| better-sqlite3 | 12.x | SQLite driver | Synchronous API is ideal here — no async complexity for what is essentially a local file database. Use v12.x on Node 24 (v11.x supports Node 20/22 only; v12 is required for Node 24+ prebuilds). |
| Drizzle ORM | 0.45.x | Schema definition, migrations, typed queries | SQL-first design means the generated SQL is predictable and debuggable. ~7kb, zero runtime dependencies. Drizzle Kit handles schema migrations automatically. Far better TypeScript inference than Prisma for SQLite. |
| @octokit/rest | 21.x | GitHub REST API client | Official GitHub client. Provides typed response shapes for PRs, commits, and rate limit headers. Use with the throttling plugin — do not roll your own rate-limit handling. |
| @octokit/plugin-throttling | 9.x | Automatic GitHub rate-limit handling | Automatically backs off on 429/403 rate-limit responses. Setting `onRateLimit` to return `true` enables automatic retry. Required for the incremental-collection architecture. |
| @octokit/auth-oauth-device | 7.x | GitHub auth for local apps | Device flow does not require a redirect URL or a server — perfect for a local app. User gets a code, opens github.com/login/device, app polls until authorized. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| TanStack Query (React Query) | 5.x | Client-side data fetching and cache | Manages the async boundary between Hono API and React components. DevTools are invaluable during development. Use for all `/api/` calls from the frontend. |
| shadcn/ui | latest (CLI-based) | UI component primitives | Copy-paste components styled with Tailwind. Not a dependency — components live in your repo. Use for all layout, navigation, tables, and form elements. |
| shadcn/ui charts | (bundled with shadcn) | Chart components built on Recharts | shadcn ships 53 pre-built chart primitives that copy into your repo. They use Recharts under the hood with shadcn theming (including dark mode). Use for line, area, and bar trend charts. Avoids adding Tremor as a separate heavy dependency. |
| Recharts | 3.x | Chart rendering engine | shadcn's charts are built on Recharts — you may need to drop down to Recharts directly for custom drill-down charts not covered by shadcn primitives. |
| Tailwind CSS | 4.x | Styling | shadcn/ui requires Tailwind. v4 is now the default in shadcn CLI. Zero-config Vite plugin. |
| Zod | 3.x | Schema validation | Validate GitHub API response shapes at runtime before storing to SQLite. Also validates API request parameters to the Hono layer. |
| date-fns | 3.x | Date math for cohort analysis | Lightweight, tree-shakable. Needed for rolling windows (month-over-month, quarter-over-quarter) and tenure cohort bucketing. |
| @tanstack/react-table | 8.x | Drill-down data tables | The drill-down explorer (repos, time ranges, cohorts) will need a sortable/filterable table. TanStack Table is headless — pairs naturally with shadcn/ui table primitives. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| drizzle-kit | Schema migrations and Studio UI | `npx drizzle-kit migrate` for schema evolution. `npx drizzle-kit studio` gives a local DB browser — useful for inspecting cached GitHub data during development. |
| Vitest | Unit and integration testing | Co-located with Vite, same config. Use for testing GitHub API pagination logic, cohort bucketing math, and rate-limit resume logic. |
| tsx | Run TypeScript files directly | `tsx src/server/index.ts` for local server dev. Faster than ts-node, no compilation step. |
| concurrently | Run Vite + Hono server together | `concurrently "npm run dev:server" "npm run dev:client"` — standard pattern for local full-stack dev without a framework. |
## Installation
# Runtime + framework
# Database
# GitHub API
# Data fetching + tables
# Validation + dates
# Charting (Recharts for direct use; shadcn charts are copy-pasted via CLI)
# Dev dependencies
# Initialize shadcn/ui (interactive, installs Tailwind v4 config)
# Add chart primitives (copies components into src/components/ui/)
# Add commonly needed components
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hono (Node adapter) | Express 4.x | If you need a specific Express middleware with no Hono equivalent, or the team is deeply Express-fluent and onboarding cost matters more than perf |
| Vite + React SPA | Next.js 15 | If you later want to add SSR, file-based routing, or deploy as a hosted service — the local-first constraint makes Next.js overkill right now |
| better-sqlite3 | Node.js native `node:sqlite` | Only if you're targeting Node 24+ and want zero native binary compilation — but the module is still experimental and lacks prepared statement warmth of better-sqlite3 |
| Drizzle ORM | Prisma | Prisma has a bigger community and better docs, but its binary engine adds ~50MB and it is slower for SQLite local workloads. Drizzle's SQL-first approach is better for a query-heavy analytics app |
| @octokit/rest + throttling plugin | GitHub GraphQL API (octokit/graphql) | GraphQL is more efficient for selective field fetching, but the REST API's pagination model is better documented for incremental collection with cursor tracking |
| shadcn/ui charts (Recharts) | Tremor | Tremor is an alternative but adds a full dependency tree on top of Recharts — shadcn's chart primitives give the same result with direct control and no extra package |
| TanStack Query | SWR | SWR is fine and smaller, but TanStack Query's DevTools are worth the extra 6kb for a data-heavy dashboard app during development |
| date-fns | dayjs / Temporal API | dayjs is slightly smaller; Temporal API is the future standard but has polyfill complexity in 2025 |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `sqlite3` (async callback driver) | Callback-based async adds complexity with no benefit for a local server where concurrent SQLite writes don't occur | `better-sqlite3` (synchronous) |
| Node.js `node:sqlite` (experimental) | Still experimental in Node 24, lacks the maturity and Drizzle integration of better-sqlite3 | `better-sqlite3` until the module stabilizes |
| Prisma ORM | Binary engine adds ~50MB, slow cold-start on first run, over-engineered for single-file SQLite analytics workload | `drizzle-orm` |
| Electron | Adds 200MB+ to distribution, complex IPC model, overkill when a local Node.js server + browser tab achieves the same UX at zero overhead | Hono server + Vite SPA opened in browser |
| Chart.js | React wrappers (react-chartjs-2) are a thin shim over an imperative API — awkward in React component model, worse TypeScript experience | Recharts (React-native, declarative) |
| D3 (directly) | 500+ function API surface is engineering overhead for standard time-series trend charts; use it only if you need truly custom geometries | Recharts (wraps the D3 parts you actually need) |
| Next.js | SSR features add build complexity and require understanding of client vs server component boundaries — none of this is needed for a local-only tool | Vite + React SPA |
| Webpack 5 / CRA | Create React App is dead (unmaintained). Webpack is much slower than Vite for dev. | Vite 8 |
## Stack Patterns by Variant
- Accept a Personal Access Token (PAT) from the user as plain text input, store in a local `.env` file or app config
- Because PAT is simpler to implement in Phase 1 and avoids OAuth App registration; device flow can be layered in later
- Add explicit SQLite indexes on `repo_id + committed_at` and `author_login + first_commit_at` columns
- Because cohort queries and rolling time windows will do date-range scans on these columns repeatedly
- Default to port 3001 for the API server, 5173 for Vite (Vite's default), with a `.env.local` override
- Because port 3000 is commonly occupied by other Node processes
- Add a `pkg` or `caxa` wrapper to produce a single binary with the Node server and Vite build bundled
- Because right now the target user (engineering leader) is assumed to be comfortable running `npm start`
## Version Compatibility
| Package | Compatible With | Notes |
|---------|-----------------|-------|
| better-sqlite3@12.x | Node.js 24.x (LTS) | v12 has Node 24 prebuilds; v11 does not. For Node 20 / Node 22, use better-sqlite3@11. |
| drizzle-orm@0.45.x | better-sqlite3@12.x | Verified integration on Node 24 (Phase 999.11); drizzle peer dep accepts `better-sqlite3 >=7`. |
| @octokit/plugin-throttling@9.x | @octokit/rest@21.x | Must match major Octokit core version; mixing majors breaks TypeScript types |
| recharts@3.x | React 19 | Recharts 3.0 rewrote internal state management; use 3.x with React 19 |
| shadcn/ui charts | recharts@3.x | shadcn CLI installs compatible Recharts version automatically |
| Tailwind CSS 4.x | Vite 8.x | Use `@tailwindcss/vite` plugin (not the PostCSS config) — it's the supported path for Tailwind v4 + Vite |
| TanStack Query 5.x | React 19 | TanStack Query v5 is fully compatible with React 19; v4 is not |
## Architecture Implications for This Stack
## Sources
- Node.js SQLite docs: https://nodejs.org/api/sqlite.html — confirmed experimental status in Node 22
- better-sqlite3 Node 22 compatibility: https://github.com/WiseLibs/better-sqlite3/discussions/1245
- better-sqlite3 v12 Node 22 build issues: https://github.com/WiseLibs/better-sqlite3/issues/1411
- Drizzle ORM npm: https://www.npmjs.com/package/drizzle-orm — confirmed v0.45.1 latest
- Hono vs Express comparison: https://betterstack.com/community/guides/scaling-nodejs/fastify-vs-express-vs-hono/
- Vite 8 release: https://vite.dev/blog/announcing-vite8 — confirmed v8.0.1 current stable
- React 19 release: https://react.dev/blog/2024/12/05/react-19
- Recharts 3.x migration: https://github.com/recharts/recharts/wiki/3.0-migration-guide
- shadcn/ui charts: https://ui.shadcn.com/docs/components/radix/chart
- @octokit/plugin-throttling: https://github.com/octokit/plugin-throttling.js/ — v11.0.1 latest (plugin), @octokit/rest v21.x
- @octokit/auth-oauth-device: https://github.com/octokit/auth-oauth-device.js
- GitHub device flow docs: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- TanStack Query vs SWR 2025: https://refine.dev/blog/react-query-vs-tanstack-query-vs-swr-2025/
- Tremor v3.18.7 acquired by Vercel: https://www.tremor.so/
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

### Phase Completion Checklist (MANDATORY)

Every GSD phase MUST follow this workflow. Do not skip any step.

1. **Branch first** — Create a dedicated branch before starting any phase work. Never work directly on `main`.
2. **Update docs** — At the end of the phase, update both:
   - `README.md`: Current status, what works, what's next
   - `ARCHITECTURE.md`: System diagram, layer descriptions, schema, file map, "What's Not Built Yet"
3. **Create a PR** — Push the branch and open a pull request for the phase work.
4. **Run code review** — Run `/code-review` against the PR before merging. Address any issues found.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
