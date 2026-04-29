// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Recharts 3.x uses useElementOffset / getBoundingClientRect internally.
// jsdom always returns 0x0, causing Recharts to skip SVG rendering.
// Stub getBoundingClientRect on HTMLElement to return a realistic chart size
// before any Recharts component mounts.
beforeAll(() => {
  // ResizeObserver polyfill (Recharts uses it for responsive containers)
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
      top: 0,
      left: 0,
      right: 800,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
});

// vi.mock must be at module scope (hoisted by Vite). Replace ResponsiveContainer
// with a passthrough so ChartContainer renders the chart tree even in jsdom.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement;
    }) => {
      return React.cloneElement(children, { width: 800, height: 400 });
    },
  };
});

const { DeveloperTrajectoryGrid, chooseDevLayout, DEV_LAYOUT_THRESHOLD } = await import('../DeveloperTrajectoryGrid.js');
const { DeveloperTrajectoryList } = await import('../DeveloperTrajectoryList.js');
const { DeveloperZoomModal } = await import('../DeveloperZoomModal.js');

import type { DeveloperWithRows } from '../DeveloperTrajectoryGrid.js';

function makeDevs(n: number): DeveloperWithRows[] {
  return Array.from({ length: n }).map((_, i) => ({
    authorLogin: `dev-${i}`,
    tenureJoinedAt: `2024-0${(i % 9) + 1}-15`,
    cohortKey: 'mid',
    rows: [
      { authorLogin: `dev-${i}`, month: '2025-01', prCount: 3, commitCount: 10, meanLinesPerCommit: 100, medianLinesPerCommit: 80, meanFilesPerCommit: 2, medianFilesPerCommit: 1 },
    ],
  }));
}

describe('DeveloperTrajectoryGrid + List + ZoomModal (Phase 9.5)', () => {
  const noopOnClick = () => undefined;
  const emptyCohortMeans = new Map<string, Map<string, number | null>>();

  it('Grid renders nothing when developers is empty', () => {
    const { container } = render(
      <DeveloperTrajectoryGrid
        developers={[]}
        metric="prCount"
        aiMarkerMonth="2025-06"
        cohortMeanByMonthAndCohort={emptyCohortMeans}
        onChartClick={noopOnClick}
      />
    );
    expect(container.querySelectorAll('.recharts-wrapper')).toHaveLength(0);
  });

  it('Grid preserves order from parent (does not re-sort)', () => {
    const devs = makeDevs(3);
    render(
      <DeveloperTrajectoryGrid
        developers={devs}
        metric="prCount"
        aiMarkerMonth={null}
        cohortMeanByMonthAndCohort={emptyCohortMeans}
        onChartClick={noopOnClick}
      />
    );
    const labels = screen.getAllByText(/^dev-\d$/);
    expect(labels.map(l => l.textContent)).toEqual(['dev-0', 'dev-1', 'dev-2']);
  });

  it('List sort dropdown excludes ALL volume metrics (D-06)', async () => {
    const user = userEvent.setup();
    const devs = makeDevs(10);
    render(
      <DeveloperTrajectoryList
        developers={devs}
        metric="prCount"
        aiMarkerMonth={null}
        cohortMeanByMonthAndCohort={emptyCohortMeans}
        onChartClick={noopOnClick}
      />
    );

    // base-ui Select hosts options in a Portal that mounts on trigger click.
    // Open the dropdown so the SelectItems are accessible to queries.
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    // base-ui places options inside its Portal; querying any of the visible
    // option labels confirms the popup mounted. Use findAllByRole to wait
    // for the listbox to populate.
    const options = await screen.findAllByRole('option');
    const optionLabels = options.map(o => o.textContent?.toLowerCase() ?? '');

    // The 4 allowed sort labels must appear (D-06).
    expect(optionLabels.some(l => l.includes('tenure (newest first)'))).toBe(true);
    expect(optionLabels.some(l => l.includes('tenure (oldest first)'))).toBe(true);
    expect(optionLabels.some(l => l.includes('name (a→z)'))).toBe(true);
    expect(optionLabels.some(l => l.includes('name (z→a)'))).toBe(true);

    // Volume-metric sort labels must NOT appear in any option.
    for (const forbidden of ['prs', 'commits', 'lines per commit', 'files per commit', 'volume', 'output']) {
      expect(optionLabels.some(l => l.includes(forbidden))).toBe(false);
    }
  });

  it('ZoomModal does NOT contain real-name reveal or profile-link controls', () => {
    const dev = makeDevs(1)[0];
    const { container } = render(
      <DeveloperZoomModal
        open={true}
        onOpenChange={() => {}}
        authorLogin={dev.authorLogin}
        rows={dev.rows}
        cohortMeanByMonth={new Map()}
        cohortBandByMonth={new Map()}
        aiMarkerMonth="2025-06"
      />
    );
    const html = container.innerHTML.toLowerCase();
    expect(html.includes('show real name')).toBe(false);
    expect(html.includes('reveal name')).toBe(false);
    expect(html.includes('unmask')).toBe(false);
    expect(html.includes('profile page')).toBe(false);
  });

  it('ZoomModal renders authorLogin as text (XSS-safe)', () => {
    const malicious = '<script>alert(1)</script>';
    const dev = { ...makeDevs(1)[0], authorLogin: malicious };
    const { container } = render(
      <DeveloperZoomModal
        open={true}
        onOpenChange={() => {}}
        authorLogin={dev.authorLogin}
        rows={dev.rows}
        cohortMeanByMonth={new Map()}
        cohortBandByMonth={new Map()}
        aiMarkerMonth={null}
      />
    );
    // React auto-escaping: the literal '<script>' string appears as TEXT, no <script> element is created.
    expect(container.querySelector('script')).toBeNull();
    // Modal renders into a portal; check document body for the escaped text.
    expect(document.body.textContent ?? '').toContain('<script>alert(1)</script>');
  });

  it('chooseDevLayout returns grid for ≤8, list for >8 (D-01)', () => {
    expect(DEV_LAYOUT_THRESHOLD).toBe(8);
    for (const n of [0, 1, 5, 7, 8]) {
      expect(chooseDevLayout(n)).toBe('grid');
    }
    for (const n of [9, 10, 50]) {
      expect(chooseDevLayout(n)).toBe('list');
    }
  });
});
