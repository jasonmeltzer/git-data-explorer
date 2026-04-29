// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import '@testing-library/jest-dom/vitest';
import type { ExportBundle } from '@shared/export-types.js';

// ── Recharts + ResizeObserver polyfills ──────────────────────────────────────
// Must be set before any component that imports Recharts is loaded.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 800,
      height: 400,
      top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0,
      toJSON: () => ({}),
    }),
  });
});

// ── Recharts ResponsiveContainer passthrough ─────────────────────────────────
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) => {
      return React.cloneElement(children, { width: 800, height: 400 });
    },
  };
});

// ── sonner toast mock (used by OrgMetadataForm) ──────────────────────────────
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Hook mocks for OrgDashboard integration tests ────────────────────────────
// vi.mock is hoisted — these replace useOrg + useSnapshotData wherever imported
// within the component under test. Hook unit tests use vi.importActual below.
vi.mock('../../hooks/useOrgs.js', () => ({
  useOrg: vi.fn(),
  useDeleteOrg: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateOrg: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSnapshot: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/useSnapshotData.js', () => ({
  useSnapshotData: vi.fn(),
}));

// ── Typed mock accessors (for integration tests) ─────────────────────────────
import { useOrg as _mockUseOrg } from '../../hooks/useOrgs.js';
import { useSnapshotData as _mockUseSnapshotData } from '../../hooks/useSnapshotData.js';
const mockUseOrg = _mockUseOrg as ReturnType<typeof vi.fn>;
const mockUseSnapshotData = _mockUseSnapshotData as ReturnType<typeof vi.fn>;

// ── Fetch stub helpers ────────────────────────────────────────────────────────
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
    })
  );
}

function mockFetch500() {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
  );
}

// ── QueryClient wrapper ───────────────────────────────────────────────────────
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

// ── Minimal ExportBundle fixture ─────────────────────────────────────────────
function minimalBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    metadata: {
      exportTimestamp: '2026-04-01T00:00:00Z',
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2026-04-01T00:00:00Z',
      aiMarkerDate: '2025-07-01',
      tenureMode: 'global',
      repoIds: [1],
      repoNames: ['test-org/repo'],
      cohortConfig: { thresholds: [] } as never,
      toolVersion: '1.0.0',
      rollingGranularity: 'month',
      orgName: 'test-org',
    },
    cohortCommits: [],
    cohortPrs: [],
    rampUp: [],
    rolling: null,
    contributors: [],
    prTurnaround: [],
    botRatio: [],
    executiveSummary: null,
    periodMetrics: null,
    concentrationMonthly: [
      { month: '2025-06', basis: 'prs',     top1Share: 40, top3Share: 60, top5Share: 75, hhi: 0.15, gini: 0.3, busFactor: 3, activeDevs: 8, topContributor: 'alice' },
      { month: '2025-06', basis: 'commits', top1Share: 45, top3Share: 65, top5Share: 80, hhi: 0.18, gini: 0.32, busFactor: 3, activeDevs: 8, topContributor: 'alice' },
      { month: '2025-06', basis: 'lines',   top1Share: 50, top3Share: 70, top5Share: 85, hhi: 0.20, gini: 0.35, busFactor: 2, activeDevs: 8, topContributor: 'alice' },
    ],
    headcountMonthly: [],
    developerMonthly: [],   // Phase 9.5-01 — type-skeleton stub
    ...overrides,
  };
}

// ── Org fixture ───────────────────────────────────────────────────────────────
const TEST_ORG = {
  id: 1,
  label: 'Test Org',
  sizeCategory: null,
  importSource: 'file',
  createdAt: '2026-01-01T00:00:00Z',
  snapshotCount: 1,
  snapshots: [{
    id: 10, orgId: 1, importedAt: '2026-01-01T00:00:00Z',
    startDate: null, endDate: null, contributorCount: null, repoCount: null, isDuplicate: 0,
  }],
};

// ═══════════════════════════════════════════════════════════════════════════════
// TASK 2: Hook unit tests
//
// These hooks feed OrgDashboard with:
//   - useOrg → org metadata + snapshot list
//   - useSnapshotData → ExportBundle with concentrationMonthly + periodMetrics
//
// We use vi.importActual to get the real hook implementations (bypassing the
// vi.mock at the top of this file, which only affects OrgDashboard's module
// graph for component integration tests below).
// ═══════════════════════════════════════════════════════════════════════════════

// Fetch the real hook modules via importActual so fetch-stub tests work
const { useOrg: realUseOrg } = await vi.importActual<typeof import('../../hooks/useOrgs.js')>('../../hooks/useOrgs.js');
const { useSnapshotData: realUseSnapshotData } = await vi.importActual<typeof import('../../hooks/useSnapshotData.js')>('../../hooks/useSnapshotData.js');

describe('useOrg hook', () => {
  test('returns org data on 200', async () => {
    mockFetch200(TEST_ORG);
    const { result } = renderHook(() => realUseOrg(1), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe(1);
    expect(result.current.data?.snapshots?.length).toBe(1);
  });

  test('sets isError on 500', async () => {
    mockFetch500();
    const { result } = renderHook(() => realUseOrg(1), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  test('does NOT fetch when orgId is null (enabled: false)', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    renderHook(() => realUseOrg(null), { wrapper: createWrapper() });
    await new Promise(r => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useSnapshotData hook', () => {
  test('returns ExportBundle on 200 — concentrationMonthly and periodMetrics are present', async () => {
    const bundle = minimalBundle({
      periodMetrics: [
        { period: { startDate: '2025-01-01', endDate: '2025-06-30', label: 'Pre-AI' }, metrics: { avgCommitSize: 150 } },
      ],
    });
    mockFetch200(bundle);
    const { result } = renderHook(() => realUseSnapshotData(1, 10), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.concentrationMonthly?.length).toBe(3);
    expect(result.current.data?.periodMetrics?.length).toBe(1);
  });

  test('returns bundle with null periodMetrics when no AI marker is set', async () => {
    mockFetch200(minimalBundle({ periodMetrics: null }));
    const { result } = renderHook(() => realUseSnapshotData(1, 10), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.periodMetrics).toBeNull();
  });

  test('sets isError on HTTP 500', async () => {
    mockFetch500();
    const { result } = renderHook(() => realUseSnapshotData(1, 10), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/HTTP 500/);
  });

  test('does NOT fetch when orgId is null (enabled: false)', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    renderHook(() => realUseSnapshotData(null, 10), { wrapper: createWrapper() });
    await new Promise(r => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does NOT fetch when snapshotId is null (enabled: false)', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    renderHook(() => realUseSnapshotData(1, null), { wrapper: createWrapper() });
    await new Promise(r => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TASK 3: OrgDashboard component integration smoke tests
//
// Mounts the real OrgDashboard component with mocked hooks (via vi.mock above).
// Verifies Team Distribution render + concentration state wiring.
// ═══════════════════════════════════════════════════════════════════════════════

// Dynamic import AFTER mocks are registered (required for vi.mock hoisting)
const { default: OrgDashboard } = await import('../../pages/OrgDashboard.js');

function renderDashboard(bundle?: Partial<ExportBundle>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockUseOrg.mockReturnValue({ data: TEST_ORG, isLoading: false });
  mockUseSnapshotData.mockReturnValue({ data: minimalBundle(bundle), isFetching: false });
  render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement('div', { style: { width: 1024, height: 768 } },
        React.createElement(OrgDashboard, { orgId: 1 })
      )
    )
  );
}

describe('OrgDashboard — render + state wiring', () => {
  test('renders "Team Distribution" section heading', () => {
    renderDashboard();
    expect(screen.getByText('Team Distribution')).toBeInTheDocument();
  });

  test('renders TeamDistributionChart (concentration risk chart) as default view', () => {
    renderDashboard();
    expect(
      screen.getByRole('img', { name: /concentration risk chart/i })
    ).toBeInTheDocument();
  });

  test('concentration basis defaults to PRs — PRs tab is present and active', () => {
    renderDashboard();
    // CONCENTRATION_BASIS_OPTIONS renders "PRs" / "Commits" / "Lines" tabs
    // The "PRs" tab is the first option → concentrationBasis state defaults to 'prs'
    const prsTabs = screen.getAllByRole('tab', { name: 'PRs' });
    // At least one PRs tab should be present (the concentrationBasis selector)
    expect(prsTabs.length).toBeGreaterThanOrEqual(1);
    // The first PRs tab (concentrationBasis) should be the active one
    const activePrsTab = prsTabs.find(t => t.getAttribute('data-state') === 'active' || t.getAttribute('aria-selected') === 'true');
    expect(activePrsTab).toBeDefined();
  });

  test('concentrationView toggle: switching to table view shows "Active Devs" column header', async () => {
    renderDashboard();
    const user = userEvent.setup();
    // OrgDashboard renders multiple "Table view" tabs; the concentration one is the
    // FIRST in document order (Team Distribution section appears before Commit/PR sections)
    const tableViewTabs = screen.getAllByRole('tab', { name: /table view/i });
    await user.click(tableViewTabs[0]);
    // TeamDistributionTable has "Active Devs" as a column header
    expect(await screen.findByText('Active Devs')).toBeInTheDocument();
  });

  test('renders org label in the page header', () => {
    renderDashboard();
    expect(screen.getByText('Test Org')).toBeInTheDocument();
  });

  test('does not use productivity or performance ranking language (privacy framing)', () => {
    renderDashboard();
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).not.toMatch(/productivity ranking/i);
    expect(bodyText).not.toMatch(/performance ranking/i);
  });
});
