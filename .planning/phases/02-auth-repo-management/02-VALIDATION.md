---
phase: 2
slug: auth-repo-management
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-03-22
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.0 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- --reporter=verbose src/server/__tests__/repo-management.test.ts` |
| **Full suite command** | `npm test` |
| **Type check command** | `npx tsc --noEmit` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/server/__tests__/repo-management.test.ts`
- **After every plan wave:** Run `npm test && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green + tsc clean
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-1a | 01 | 1 | AUTH-01 | unit | `npm test -- src/server/__tests__/octokit.test.ts` | no W0 | pending |
| 02-01-1b | 01 | 1 | AUTH-04, AUTH-05, AUTH-06 | unit | `npm test -- src/server/__tests__/repo-management.test.ts` | no W0 | pending |
| 02-01-02 | 01 | 1 | AUTH-03 | integration (mock) | `npm test -- src/server/__tests__/repositories.test.ts` | no W0 | pending |
| 02-02-01 | 02 | 1 | AUTH-03 | type check | `npx tsc --noEmit` | n/a | pending |
| 02-02-02 | 02 | 1 | AUTH-03 | type check | `npx tsc --noEmit` | n/a | pending |
| 02-03-01 | 03 | 2 | AUTH-03, AUTH-04, AUTH-05, AUTH-06 | type check + unit | `npm test && npx tsc --noEmit` | n/a | pending |
| 02-03-02 | 03 | 2 | AUTH-03 | type check + unit | `npm test && npx tsc --noEmit` | n/a | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `src/server/__tests__/octokit.test.ts` — stubs for AUTH-01 (Octokit factory with/without token)
- [ ] `src/server/__tests__/repo-management.test.ts` — stubs for AUTH-04, AUTH-05, AUTH-06
- [ ] `src/server/__tests__/repositories.test.ts` — stubs for AUTH-03 route behavior (mocked Octokit)

*Existing test infrastructure: Vitest configured, `__tests__` pattern established in Phase 1. No framework install needed — just new test files.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Auto-navigate to repos page after token save | AUTH-01 | Browser navigation side-effect | 1. Go to Settings, 2. Enter valid PAT, 3. Save, 4. Verify URL changes to `#/repos` |
| Repo list grouped by owner with search filter | AUTH-03 | Visual layout verification | 1. Navigate to Repos page, 2. Verify personal repos appear first, 3. Verify org groups sorted alphabetically, 4. Type in search box, verify filtering |
| Delete confirmation dialog shows accurate counts | AUTH-06 | UI interaction flow | 1. Stop tracking a repo, 2. Click "Delete data", 3. Verify dialog shows commit/PR counts, 4. Confirm deletion, 5. Verify data removed |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
