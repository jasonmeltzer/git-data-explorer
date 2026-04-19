// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, test, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { HeadcountMonthlyRow } from '@shared/types.js';

// Polyfills needed by Recharts in jsdom ─────────────────────────────────────
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // Recharts 3.x calls getBoundingClientRect to measure chart wrapper size.
  // jsdom returns 0x0 which causes Recharts to skip rendering the SVG tree.
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 600,
      height: 300,
      top: 0,
      left: 0,
      right: 600,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
});

// Replace ResponsiveContainer with a passthrough that sets explicit dimensions.
// ChartContainer wraps ResponsiveContainer — without this Recharts measures 0x0.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement;
    }) => {
      const React = require('react');
      return React.cloneElement(children, { width: 600, height: 300 });
    },
  };
});

const { ScaryRealPanel } = await import('../ScaryRealPanel.js');

// ── Fixture data ───────────────────────────────────────────────────────────────
const DATA: HeadcountMonthlyRow[] = [
  { month: '2025-05', activeDevs: 5, totalPrs: 20, totalCommits: 100, prsPerDev: 4, commitsPerDev: 20 },
  { month: '2025-06', activeDevs: 7, totalPrs: 30, totalCommits: 140, prsPerDev: 4.3, commitsPerDev: 20 },
  { month: '2025-07', activeDevs: 8, totalPrs: 35, totalCommits: 160, prsPerDev: 4.4, commitsPerDev: 20 },
];

describe('ScaryRealPanel', () => {
  test('renders Skeleton when loading with empty data', () => {
    const { container } = render(
      <ScaryRealPanel data={[]} aiMarkerDate={null} isLoading={true} />
    );
    // Skeleton renders a pulse div — no SVG chart
    expect(container.querySelector('svg')).toBeNull();
  });

  test('renders empty-state copy when no data', () => {
    render(<ScaryRealPanel data={[]} aiMarkerDate={null} isLoading={false} />);
    expect(screen.getByText(/No team size data available/i)).toBeInTheDocument();
  });

  test('renders TWO distinct chart panels (2 SVGs) with multi-month data', () => {
    const { container } = render(
      <ScaryRealPanel data={DATA} aiMarkerDate={null} isLoading={false} />
    );
    // Each Recharts chart (BarChart + ComposedChart) renders its own <svg>
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(2);
  });

  test('panel headings are "Total PRs" and "PRs / Developer"', () => {
    render(<ScaryRealPanel data={DATA} aiMarkerDate={null} isLoading={false} />);
    expect(screen.getByText('Total PRs')).toBeInTheDocument();
    expect(screen.getByText('PRs / Developer')).toBeInTheDocument();
  });

  test('AI marker appears in BOTH panels when aiMarkerDate is set', () => {
    const { container } = render(
      <ScaryRealPanel data={DATA} aiMarkerDate="2025-06-01" isLoading={false} />
    );
    // Each panel gets one ReferenceLine <line> with the marker stroke variable
    const markers = Array.from(container.querySelectorAll('line')).filter(
      l => l.getAttribute('stroke') === 'var(--chart-ai-marker)'
    );
    // One marker per panel → at least 2 marker lines
    expect(markers.length).toBeGreaterThanOrEqual(2);
  });

  test('AI marker is ABSENT in both panels when aiMarkerDate is null', () => {
    const { container } = render(
      <ScaryRealPanel data={DATA} aiMarkerDate={null} isLoading={false} />
    );
    const markers = Array.from(container.querySelectorAll('line')).filter(
      l => l.getAttribute('stroke') === 'var(--chart-ai-marker)'
    );
    expect(markers.length).toBe(0);
  });

  test('single-row data still renders both panels (no crash)', () => {
    const data: HeadcountMonthlyRow[] = [
      { month: '2025-06', activeDevs: 5, totalPrs: 20, totalCommits: 100, prsPerDev: 4, commitsPerDev: 20 },
    ];
    const { container } = render(
      <ScaryRealPanel data={data} aiMarkerDate={null} isLoading={false} />
    );
    expect(container.querySelectorAll('svg').length).toBe(2);
  });

  test('handles null prsPerDev and commitsPerDev gracefully (no crash)', () => {
    // Recharts connectNulls={false} should produce a gap, not throw.
    const data: HeadcountMonthlyRow[] = [
      { month: '2025-05', activeDevs: 0, totalPrs: 0, totalCommits: 0, prsPerDev: null, commitsPerDev: null },
      { month: '2025-06', activeDevs: 5, totalPrs: 20, totalCommits: 100, prsPerDev: 4, commitsPerDev: 20 },
    ];
    const { container } = render(
      <ScaryRealPanel data={data} aiMarkerDate={null} isLoading={false} />
    );
    expect(container.querySelectorAll('svg').length).toBe(2);
  });
});
