---
plan: "03-04"
status: complete
started: 2026-03-22T21:10:00Z
completed: 2026-03-22T21:25:00Z
---

## Summary

Human verification of the data collection flow. Found and fixed three UI issues during testing:

1. **Bot toggle invisible** — Base UI Switch component wasn't rendering visibly; replaced with hand-rolled toggle
2. **Tabs layout broken** — Base UI Tabs rendered as vertical column; replaced with simple pill-style tab bar
3. **Server won't shut down** — Added graceful shutdown (SIGTERM/SIGINT handler, forced exit fallback, SQLite close)
4. **Token guard on repos page** — Added `enabled: tokenData?.configured` guard so `/api/repos/available` doesn't fire before token is set

## Verified

- Settings page shows "Include bot accounts" toggle — visible, defaults OFF
- Repos page shows horizontal "Repos" and "Collection" tab bar
- "Sync now" triggers collection, live progress visible
- Repo completes with "Up to date" status
- Bot accounts excluded count shown

## Not fully verified

- Resume banner after app restart — repo synced too quickly to interrupt; logic is correct per code review
- Rate-limit messaging — not triggered during test (small repo)

## Key files

- `src/client/pages/ReposPage.tsx` — hand-rolled tabs, token guard
- `src/client/pages/SettingsPage.tsx` — hand-rolled toggle
- `src/server/index.ts` — graceful shutdown
- `src/server/services/collection-engine.ts` — timer unref

## Deviations

- D-TABS: Replaced shadcn/Base UI Tabs with hand-rolled pill tabs (rendering issues)
- D-SWITCH: Replaced shadcn/Base UI Switch with hand-rolled toggle (not visible on white bg)
