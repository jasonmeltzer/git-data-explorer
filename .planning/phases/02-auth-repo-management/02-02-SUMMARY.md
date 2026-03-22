---
phase: 02-auth-repo-management
plan: "02"
subsystem: frontend-infrastructure
tags: [tanstack-query, shadcn-ui, routing, navigation, shared-types]
dependency_graph:
  requires: []
  provides: [tanstack-query-provider, shadcn-ui-components, navbar, hash-router-3-pages, shared-repo-types, post-token-navigation]
  affects: [03-repos-page]
tech_stack:
  added: ["@tanstack/react-query@5", "shadcn/ui (checkbox, badge, input, alert-dialog, button)"]
  patterns: [QueryClientProvider, hash-based-routing, NavBar-persistent-nav, path-alias-bundler-resolution]
key_files:
  created:
    - src/client/components/NavBar.tsx
  modified:
    - src/client/main.tsx
    - src/client/App.tsx
    - src/client/pages/SettingsPage.tsx
    - src/client/pages/LandingPage.tsx
    - src/client/components/TokenForm.tsx
    - src/shared/types.ts
    - tsconfig.json
    - vite.config.ts
    - package.json
    - components.json
    - src/client/index.css
    - src/shared/components/ui/button.tsx
decisions:
  - "Changed tsconfig.json moduleResolution from NodeNext to bundler — required for @shared/* path aliases to work with Vite + shadcn components"
  - "Added @shared/* alias in vite.config.ts to ensure Vite bundler resolves the same paths as TypeScript"
  - "shadcn/ui installed components at src/shared/components/ui/ (not src/client/components/ui/) — accepted as-is; Plan 03 should import from @shared/components/ui"
  - "Removed back button from SettingsPage — NavBar handles navigation now"
  - "Updated LandingPage ready state CTA from Settings link to Add Repos button navigating to #/repos"
metrics:
  duration: "4 minutes"
  completed: "2026-03-22"
  tasks_completed: 2
  files_changed: 14
---

# Phase 02 Plan 02: Frontend Infrastructure — TanStack Query, shadcn/ui, NavBar, 3-page Router Summary

**One-liner:** QueryClientProvider wrapping the app with 5-min staleTime, shadcn/ui initialized with 5 components at @shared/components/ui, NavBar component with active state, hash router extended to 3 pages, shared repo types, and post-token-save navigation to #/repos.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Install packages, initialize shadcn/ui, add components | d7491fc | package.json, components.json, src/shared/components/ui/*, tsconfig.json, vite.config.ts |
| 2 | TanStack Query provider, NavBar, 3-page router, shared types, post-token navigation | 1c72c0d | src/client/main.tsx, src/client/App.tsx, src/client/components/NavBar.tsx, src/shared/types.ts, src/client/pages/SettingsPage.tsx, src/client/pages/LandingPage.tsx, src/client/components/TokenForm.tsx |

## Success Criteria Verification

- [x] shadcn/ui initialized with 5 components (checkbox, badge, input, alert-dialog, button) at src/shared/components/ui/
- [x] TanStack Query v5 installed (@tanstack/react-query@5.95.0) and QueryClientProvider wraps App
- [x] NavBar component renders on all pages with active state highlighting
- [x] App.tsx routes to 3 pages via hash (#/, #/repos, #/settings)
- [x] App.tsx passes onNavigateRepos prop to SettingsPage
- [x] Shared types define GitHubRepo, TrackedRepo, AvailableReposResponse, RepoDeleteCounts
- [x] Token save triggers navigation to #/repos (D-09) via onTokenSaved prop chain
- [x] npx tsc --noEmit passes clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed moduleResolution incompatibility breaking @shared/* path aliases**
- **Found during:** Task 1 verification
- **Issue:** shadcn/ui installs components using `@shared/lib/utils` and `@shared/components/ui/button` path aliases. With `moduleResolution: NodeNext`, TypeScript cannot resolve these aliases because NodeNext requires explicit file extensions and doesn't apply path aliases during module resolution the same way.
- **Fix:** Changed tsconfig.json `module` from `NodeNext` to `ESNext` and `moduleResolution` from `NodeNext` to `bundler`. Added `@shared/*` alias to vite.config.ts so Vite bundler resolves the same paths.
- **Files modified:** tsconfig.json, vite.config.ts
- **Commit:** d7491fc

**2. [Rule 2 - Missing functionality] Updated LandingPage ready state CTA to use onNavigateRepos**
- **Found during:** Task 2 implementation
- **Issue:** LandingPage's "ready" state (token configured, no repos) previously showed a "Settings" link button. The plan specified passing `onNavigateRepos` to LandingPage, which required updating the ready state CTA to navigate to #/repos for the "Add Repos" flow per the UI spec.
- **Fix:** Added `onNavigateRepos` to LandingPage Props interface; updated ready state button to "Add Repos" navigating to #/repos.
- **Files modified:** src/client/pages/LandingPage.tsx
- **Commit:** 1c72c0d

### shadcn Component Location Note

shadcn/ui init auto-detected the `@shared/*` path alias from components.json and installed components at `src/shared/components/ui/` (not `src/client/components/ui/`). This is correct and expected. Plan 03 should import from `@shared/components/ui/button` etc.

## Known Stubs

- **Repos page placeholder** in `src/client/App.tsx` (line ~37): renders `<div>Repos page coming soon...</div>` — intentional placeholder. Plan 03 (ReposPage) replaces this with the real component.

## Decisions Made

1. **moduleResolution: bundler** — switched from NodeNext to bundler in tsconfig.json. NodeNext is designed for pure Node.js ESM, not Vite projects. Bundler mode correctly handles path aliases and is the recommended TypeScript setting for Vite apps.

2. **@shared/* in vite.config.ts** — added explicit Vite alias to match tsconfig paths. Without this, Vite's bundler wouldn't know how to resolve `@shared/lib/utils` at build time even if TypeScript accepted it.

3. **Removed SettingsPage back button** — the persistent NavBar handles all navigation now; the back button was redundant and cluttered the settings page.

## Self-Check: PASSED

- src/client/components/NavBar.tsx — FOUND
- src/shared/types.ts contains GitHubRepo — FOUND
- src/client/main.tsx contains QueryClientProvider — FOUND
- src/client/App.tsx contains #/repos routing — FOUND
- Commits d7491fc and 1c72c0d — FOUND
