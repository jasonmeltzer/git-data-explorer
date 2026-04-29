// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import '@testing-library/jest-dom/vitest';

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return React.cloneElement(children, { width: 800, height: 400 } as any);
    },
  };
});

// ── sonner toast mock (used by OrgMetadataForm) ──────────────────────────────
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Hook mocks ───────────────────────────────────────────────────────────────
// vi.mock is hoisted — these replace useOrg + useSnapshotData wherever imported
// within the component under test.
vi.mock('../../../hooks/useOrgs.js', () => ({
  useOrg: vi.fn(),
  useDeleteOrg: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateOrg: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSnapshot: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../../../hooks/useSnapshotData.js', () => ({
  useSnapshotData: vi.fn(),
}));

// ── Typed mock accessors ─────────────────────────────────────────────────────
import { useOrg as _mockUseOrg } from '../../../hooks/useOrgs.js';
import { useSnapshotData as _mockUseSnapshotData } from '../../../hooks/useSnapshotData.js';
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

// ── Test fixtures ────────────────────────────────────────────────────────────
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

const SYNTHETIC_BUNDLE = {
  metadata: {
    exportTimestamp: '2026-04-01T00:00:00Z',
    startDate: '2025-01-01T00:00:00Z',
    endDate: '2026-04-01T00:00:00Z',
    aiMarkerDate: '2025-06-01',
    tenureMode: 'global' as const,
    repoIds: [1],
    repoNames: ['test-org/repo'],
    cohortConfig: { thresholds: [] } as never,
    toolVersion: '1.0.0',
    rollingGranularity: 'month' as const,
    orgName: 'test-org',
  },
  contributors: [
    { authorLogin: 'amber-bear', cohort: 'mid', firstCommitAt: '2024-01-01' },
    { authorLogin: 'crystal-fox', cohort: 'new', firstCommitAt: '2025-03-01' },
    { authorLogin: 'jade-eagle', cohort: 'senior', firstCommitAt: '2022-05-01' },
  ],
  cohortCommits: [],
  cohortPrs: [],
  rampUp: [],
  rolling: null,
  prTurnaround: [],
  botRatio: [],
  executiveSummary: null,
  periodMetrics: null,
  concentrationMonthly: [],
  headcountMonthly: [],
  developerMonthly: [
    { authorLogin: 'amber-bear', month: '2025-01', prCount: 3, commitCount: 10, meanLinesPerCommit: 50, medianLinesPerCommit: 40, meanFilesPerCommit: 2, medianFilesPerCommit: 1 },
    { authorLogin: 'amber-bear', month: '2025-07', prCount: 8, commitCount: 25, meanLinesPerCommit: 30, medianLinesPerCommit: 25, meanFilesPerCommit: 2, medianFilesPerCommit: 1 },
    { authorLogin: 'crystal-fox', month: '2025-04', prCount: 1, commitCount: 3, meanLinesPerCommit: 80, medianLinesPerCommit: 70, meanFilesPerCommit: 3, medianFilesPerCommit: 2 },
    { authorLogin: 'jade-eagle', month: '2025-03', prCount: 2, commitCount: 5, meanLinesPerCommit: 60, medianLinesPerCommit: 50, meanFilesPerCommit: 2, medianFilesPerCommit: 2 },
  ],
};

// Dynamic import AFTER mocks are registered (required for vi.mock hoisting)
const { default: OrgDashboard } = await import('../../../pages/OrgDashboard.js');

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockUseOrg.mockReturnValue({ data: TEST_ORG, isLoading: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockUseSnapshotData.mockReturnValue({ data: SYNTHETIC_BUNDLE as any, isFetching: false });
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement('div', { style: { width: 1024, height: 768 } },
        React.createElement(OrgDashboard, { orgId: 1 })
      )
    )
  );
}

describe('OrgDashboard Contribution Patterns section (Phase 9.5 D-12/D-13/D-14/D-15)', () => {
  it('renders the verbatim D-13 HelpPanel copy', () => {
    renderDashboard();
    expect(screen.getByText(/Per-developer monthly trajectories for this snapshot/)).toBeDefined();
    expect(screen.getByText(/Pseudonyms are applied at export time/)).toBeDefined();
    expect(screen.getByText(/Click any chart for a larger view with cohort-band context/)).toBeDefined();
  });

  it('renders the section title "Contribution Patterns"', () => {
    renderDashboard();
    // There should be at least one heading element with the exact title
    const headings = screen.getAllByText(/Contribution Patterns/);
    expect(headings.length).toBeGreaterThan(0);
  });

  it('section is always-expanded — NO collapsible trigger that hides the HelpPanel content', () => {
    const { container } = renderDashboard();
    // Verify the HelpPanel content is in the DOM by default — no Collapsible wrapper hides it
    expect(container.textContent ?? '').toContain('Per-developer monthly trajectories for this snapshot');
  });

  it('Cohort filter dropdown contains all 4 D-15 options (All, Senior, Mid, Junior)', async () => {
    const user = userEvent.setup();
    renderDashboard();

    // base-ui Select hosts options inside a Portal that mounts on trigger click.
    // OrgDashboard renders only ONE Select (the Cohort filter) — it's the only
    // combobox in the rendered tree. (DeveloperTrajectoryList's Select would
    // appear only in Layout C / >8 active devs; the synthetic bundle has 3 devs
    // so Layout A renders without that secondary Select.)
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const options = await screen.findAllByRole('option');
    const optionLabels = options.map(o => (o.textContent ?? '').toLowerCase());

    // The 4 D-15 labels must all appear in the option list
    expect(optionLabels.some(l => l.includes('all'))).toBe(true);
    expect(optionLabels.some(l => l.includes('senior'))).toBe(true);
    expect(optionLabels.some(l => l.includes('mid'))).toBe(true);
    expect(optionLabels.some(l => l.includes('junior'))).toBe(true);
  });

  it('Min Activity slider has range 1-12 with default 1', () => {
    const { container } = renderDashboard();
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement | null;
    expect(slider).not.toBeNull();
    expect(slider!.min).toBe('1');
    expect(slider!.max).toBe('12');
    expect(slider!.value).toBe('1');
  });

  it('does NOT contain real-name reveal or profile-link controls (privacy)', () => {
    const { container } = renderDashboard();
    const html = container.innerHTML.toLowerCase();
    expect(html.includes('show real name')).toBe(false);
    expect(html.includes('reveal name')).toBe(false);
    expect(html.includes('unmask')).toBe(false);
    expect(html.includes('profile page')).toBe(false);
  });

  it('renders authorLogin pseudonyms (not real names) — module never re-anonymizes', () => {
    renderDashboard();
    // The mock fed in pre-pseudonymized animal-name logins; verify they appear
    // unchanged. Use getAllByText because the chart label + chart series may
    // surface the login in multiple DOM nodes — we only need to assert
    // presence (no real-name lookup happens client-side).
    const matches = screen.getAllByText(/amber-bear|crystal-fox|jade-eagle/);
    expect(matches.length).toBeGreaterThan(0);
  });
});
