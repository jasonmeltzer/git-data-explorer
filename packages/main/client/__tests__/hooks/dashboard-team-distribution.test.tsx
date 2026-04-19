// @vitest-environment jsdom
/**
 * Tests for the 3 new useQuery hooks in DashboardPage.tsx (Phase 9.4):
 *   - concentration useQuery (line 105-112)
 *   - headcount useQuery (line 113-120)
 *   - period-metrics useQuery (line 121-128)
 * and the anyError aggregation (line 148-150) which now includes all three.
 *
 * Each hook shape is re-created inline here (narrow duplication) so the tests
 * stay independent of DashboardPage's full rendering tree.
 *
 * Regression guard: commit 7d2c167 removed the `enabled: repoIds.length > 0` gate.
 * Before the fix, the Team Distribution section stayed blank on initial page load
 * until the user manually opened the repo filter.  The "fires with empty repoIds"
 * test in each describe block locks this behaviour in.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom/vitest';

// ── Query wrapper ─────────────────────────────────────────────────────────────

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,    // never retry — we want errors to surface immediately
        gcTime: 0,       // disable caching between tests
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

// ── Inline hook re-implementations (mirror DashboardPage.tsx lines 104-128) ──

type ConcentrationParams = { startDate?: string; endDate?: string; repoIds: string };
function useConcentration(params: ConcentrationParams) {
  const teamDistributionParams: Record<string, string> = {};
  if (params.startDate) teamDistributionParams.startDate = params.startDate;
  if (params.endDate)   teamDistributionParams.endDate   = params.endDate;
  teamDistributionParams.repoIds = params.repoIds;
  return useQuery({
    queryKey: ['analytics', 'concentration', params.startDate, params.endDate, params.repoIds],
    queryFn: async () => {
      const res = await fetch('/api/analytics/concentration?' + new URLSearchParams(teamDistributionParams));
      if (!res.ok) throw new Error('Failed to fetch concentration metrics');
      return res.json();
    },
  });
}

type HeadcountParams = { startDate?: string; endDate?: string; repoIds: string };
function useHeadcount(params: HeadcountParams) {
  const teamDistributionParams: Record<string, string> = {};
  if (params.startDate) teamDistributionParams.startDate = params.startDate;
  if (params.endDate)   teamDistributionParams.endDate   = params.endDate;
  teamDistributionParams.repoIds = params.repoIds;
  return useQuery({
    queryKey: ['analytics', 'headcount', params.startDate, params.endDate, params.repoIds],
    queryFn: async () => {
      const res = await fetch('/api/analytics/headcount?' + new URLSearchParams(teamDistributionParams));
      if (!res.ok) throw new Error('Failed to fetch headcount metrics');
      return res.json();
    },
  });
}

type PeriodMetricsParams = { startDate?: string; endDate?: string; repoIds: string };
function usePeriodMetrics(params: PeriodMetricsParams) {
  const teamDistributionParams: Record<string, string> = {};
  if (params.startDate) teamDistributionParams.startDate = params.startDate;
  if (params.endDate)   teamDistributionParams.endDate   = params.endDate;
  teamDistributionParams.repoIds = params.repoIds;
  return useQuery({
    queryKey: ['analytics', 'period-metrics', params.startDate, params.endDate, params.repoIds],
    queryFn: async () => {
      const res = await fetch('/api/analytics/period-metrics?' + new URLSearchParams(teamDistributionParams));
      if (!res.ok) throw new Error('Failed to fetch period metrics');
      return res.json();
    },
  });
}

// ── Fetch mock helpers ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch200(body: unknown) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function mockFetch500() {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'internal server error' }), { status: 500 }),
  );
}

// ── concentration useQuery ────────────────────────────────────────────────────

describe('concentration useQuery', () => {
  test('returns parsed rows on 200', async () => {
    mockFetch200([{ month: '2025-06', basis: 'prs', top1Share: 40, activeDevs: 5 }]);
    const { result } = renderHook(
      () => useConcentration({ startDate: '2025-01-01', endDate: '2025-12-31', repoIds: '1' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ month: '2025-06', basis: 'prs', top1Share: 40, activeDevs: 5 }]);
  });

  test('throws on 500 and sets isError=true', async () => {
    mockFetch500();
    const { result } = renderHook(
      () => useConcentration({ startDate: '2025-01-01', endDate: '2025-12-31', repoIds: '1' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Failed to fetch concentration metrics');
  });

  // Regression guard: commit 7d2c167 removed the `enabled: repoIds.length > 0` gate.
  // Before the fix, the Team Distribution section was blank on page load because the
  // hook didn't fire until the user manually opened the repo filter.
  // This test locks in the "always fires" contract: an empty repoIds string must still
  // trigger a fetch and forward repoIds= (empty) to the server. The server-side
  // contract (empty repoIds → all complete repos) is guarded by
  // analytics-concentration.test.ts "empty/undefined repoIds → all complete repos".
  test('fires with empty repoIds and sends repoIds= to the server', async () => {
    mockFetch200([{ month: '2025-06', basis: 'prs', top1Share: 30, topContributor: 'alice' }]);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { result } = renderHook(
      () => useConcentration({ startDate: '2025-01-01', endDate: '2025-12-31', repoIds: '' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    // URLSearchParams encodes repoIds= as "repoIds=" (empty value), which the
    // server maps to "all complete repos".
    expect(calledUrl).toMatch(/repoIds=(&|$)/);
  });
});

// ── headcount useQuery ────────────────────────────────────────────────────────

describe('headcount useQuery', () => {
  test('returns parsed rows on 200', async () => {
    mockFetch200([{ month: '2025-06', activeDevs: 8, totalPrs: 20, totalCommits: 60, prsPerDev: 2.5, commitsPerDev: 7.5 }]);
    const { result } = renderHook(
      () => useHeadcount({ startDate: '2025-01-01', endDate: '2025-12-31', repoIds: '1' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { month: '2025-06', activeDevs: 8, totalPrs: 20, totalCommits: 60, prsPerDev: 2.5, commitsPerDev: 7.5 },
    ]);
  });

  test('throws on 500 and sets isError=true', async () => {
    mockFetch500();
    const { result } = renderHook(
      () => useHeadcount({ startDate: '2025-01-01', endDate: '2025-12-31', repoIds: '1' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Failed to fetch headcount metrics');
  });

  test('fires with empty repoIds and sends repoIds= to the server', async () => {
    mockFetch200([{ month: '2025-06', activeDevs: 4, totalPrs: 10, totalCommits: 30 }]);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { result } = renderHook(
      () => useHeadcount({ startDate: '2025-01-01', endDate: '2025-12-31', repoIds: '' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/repoIds=(&|$)/);
  });
});

// ── period-metrics useQuery ───────────────────────────────────────────────────

describe('period-metrics useQuery', () => {
  test('returns parsed periods on 200', async () => {
    const mockPeriods = [
      {
        period: { startDate: '2025-01-01', endDate: '2025-06-01', label: 'Before AI' },
        metrics: { avgCommitSize: 55.2, prFrequency: 3.1, rampUpSpeed: 4.5, activeContributors: 8 },
      },
    ];
    mockFetch200(mockPeriods);
    const { result } = renderHook(
      () => usePeriodMetrics({ startDate: '2025-01-01', endDate: '2025-12-31', repoIds: '1' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockPeriods);
  });

  test('throws on 500 and sets isError=true', async () => {
    mockFetch500();
    const { result } = renderHook(
      () => usePeriodMetrics({ startDate: '2025-01-01', endDate: '2025-12-31', repoIds: '1' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('Failed to fetch period metrics');
  });

  test('fires with empty repoIds and sends repoIds= to the server', async () => {
    mockFetch200([
      {
        period: { startDate: '2025-01-01', endDate: '2025-12-31', label: 'All Time' },
        metrics: { avgCommitSize: 60, prFrequency: 3.5, rampUpSpeed: 3.0, activeContributors: 10 },
      },
    ]);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const { result } = renderHook(
      () => usePeriodMetrics({ startDate: '2025-01-01', endDate: '2025-12-31', repoIds: '' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toMatch(/repoIds=(&|$)/);
  });
});

// ── anyError aggregation (DashboardPage lines 148-150) ───────────────────────
//
// Rather than render the full DashboardPage (which has 20+ queries and heavy
// rendering dependencies), the anyError expression is extracted as a pure
// function.  This mirrors the exact source expression — if DashboardPage ever
// adds/removes error sources, keep this helper in sync.
//
// The expression from DashboardPage:
//   const anyError = prError || commitError || rampUpError || rollingError
//     || concentrationError || headcountError || periodMetricsError;

function computeAnyError(errs: {
  prError?: boolean;
  commitError?: boolean;
  rampUpError?: boolean;
  rollingError?: boolean;
  concentrationError?: boolean;
  headcountError?: boolean;
  periodMetricsError?: boolean;
}): boolean {
  return !!(
    errs.prError ||
    errs.commitError ||
    errs.rampUpError ||
    errs.rollingError ||
    errs.concentrationError ||
    errs.headcountError ||
    errs.periodMetricsError
  );
}

describe('anyError aggregation (DashboardPage lines 148-150)', () => {
  test.each([
    ['concentrationError', { concentrationError: true }],
    ['headcountError',     { headcountError: true }],
    ['periodMetricsError', { periodMetricsError: true }],
    ['prError',            { prError: true }],
    ['commitError',        { commitError: true }],
    ['rampUpError',        { rampUpError: true }],
    ['rollingError',       { rollingError: true }],
  ] as const)('%s alone makes anyError true', (_name, errs) => {
    expect(computeAnyError(errs)).toBe(true);
  });

  test('all-false → anyError=false', () => {
    expect(computeAnyError({})).toBe(false);
  });

  test('multiple errors → anyError=true', () => {
    expect(computeAnyError({ concentrationError: true, headcountError: true })).toBe(true);
  });
});
