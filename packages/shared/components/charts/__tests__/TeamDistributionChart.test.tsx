// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, test, expect, beforeAll, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { ConcentrationMonthlyRow } from '@shared/types.js';

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

  // getBoundingClientRect polyfill — Recharts reads this to get chart dims.
  // Without this, the chart wrapper measures 0x0 and Recharts renders nothing.
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

// vi.mock must be at module scope (hoisted by Vite). The dynamic import below
// ensures the component loads AFTER the mock is registered.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    // Replace ResponsiveContainer with a passthrough that carries fixed dims.
    // This ensures ChartContainer renders the chart tree even in jsdom.
    ResponsiveContainer: ({
      children,
    }: {
      children: React.ReactElement;
    }) => {
      // Clone the child and pass explicit width/height so Recharts Surface renders
      return React.cloneElement(children, { width: 800, height: 400 });
    },
  };
});

const { TeamDistributionChart, getBarFill } = await import('../TeamDistributionChart.js');

// ── Fixture factory ────────────────────────────────────────────────────────────
const ROW = (overrides: Partial<ConcentrationMonthlyRow> = {}): ConcentrationMonthlyRow => ({
  month: '2025-06',
  basis: 'prs',
  top1Share: 25,
  top3Share: 55,
  top5Share: 75,
  hhi: 0.15,
  gini: 0.4,
  busFactor: 3,
  activeDevs: 8,
  topContributor: 'alice',
  ...overrides,
});

function renderChart(props: Parameters<typeof TeamDistributionChart>[0]) {
  return render(<TeamDistributionChart {...props} />);
}

// ── getBarFill unit tests (no DOM render needed) ───────────────────────────────
describe('getBarFill (color threshold logic)', () => {
  test('returns red for top1Share >= 60', () => {
    expect(getBarFill(60)).toBe('oklch(0.577 0.245 27.325)');
    expect(getBarFill(65)).toBe('oklch(0.577 0.245 27.325)');
    expect(getBarFill(100)).toBe('oklch(0.577 0.245 27.325)');
  });

  test('returns amber for 50 <= top1Share < 60', () => {
    expect(getBarFill(50)).toBe('oklch(0.75 0.15 85)');
    expect(getBarFill(55)).toBe('oklch(0.75 0.15 85)');
    expect(getBarFill(59)).toBe('oklch(0.75 0.15 85)');
  });

  test('returns purple for top1Share < 50', () => {
    expect(getBarFill(0)).toBe('var(--chart-concentration)');
    expect(getBarFill(25)).toBe('var(--chart-concentration)');
    expect(getBarFill(49)).toBe('var(--chart-concentration)');
  });

  test('returns purple fallback when top1Share is null', () => {
    expect(getBarFill(null)).toBe('var(--chart-concentration)');
  });
});

// ── Component render tests ─────────────────────────────────────────────────────
describe('TeamDistributionChart', () => {
  test('renders Skeleton when loading with empty data', () => {
    const { container } = renderChart({ data: [], aiMarkerDate: null, isLoading: true });
    // Skeleton renders a div; no SVG chart should appear
    expect(container.querySelector('svg')).toBeNull();
  });

  test('renders empty-state copy when data is empty and not loading', () => {
    renderChart({ data: [], aiMarkerDate: null, isLoading: false });
    expect(screen.getByText(/No concentration data available/i)).toBeInTheDocument();
  });

  test('renders the chart SVG with multi-month data', () => {
    const data = [
      ROW({ month: '2025-05', top1Share: 30 }),
      ROW({ month: '2025-06', top1Share: 45 }),
      ROW({ month: '2025-07', top1Share: 55 }),
    ];
    const { container } = renderChart({ data, aiMarkerDate: null, isLoading: false });
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  test('renders single-row data without crash', () => {
    const { container } = renderChart({
      data: [ROW()],
      aiMarkerDate: null,
      isLoading: false,
    });
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  // ── AI marker presence ───────────────────────────────────────────────────────
  test('renders AI marker ReferenceLine when aiMarkerDate is set', () => {
    const data = [ROW({ month: '2025-06' }), ROW({ month: '2025-07' })];
    const { container } = renderChart({ data, aiMarkerDate: '2025-07-01', isLoading: false });
    // ReferenceLine renders as a <line> element with the marker stroke variable
    const lines = Array.from(container.querySelectorAll('line'));
    const marker = lines.find(l => l.getAttribute('stroke') === 'var(--chart-ai-marker)');
    expect(marker).toBeDefined();
  });

  test('does NOT render AI marker ReferenceLine when aiMarkerDate is null', () => {
    const data = [ROW({ month: '2025-06' })];
    const { container } = renderChart({ data, aiMarkerDate: null, isLoading: false });
    const lines = Array.from(container.querySelectorAll('line'));
    const marker = lines.find(l => l.getAttribute('stroke') === 'var(--chart-ai-marker)');
    expect(marker).toBeUndefined();
  });

  test('AI marker label guard (M4): chart renders without crash when aiMarkerDate is set', () => {
    // Verifies the M4 fix: label render-fn guards against undefined viewBox.x
    // during Recharts early mount cycles. If the guard were absent the render
    // would throw. A clean render (no thrown error) proves the guard is present.
    const data = [ROW({ month: '2025-06' }), ROW({ month: '2025-07' })];
    expect(() =>
      renderChart({ data, aiMarkerDate: '2025-07-01', isLoading: false })
    ).not.toThrow();
  });
});
