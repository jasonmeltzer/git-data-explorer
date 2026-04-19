// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, test, expect, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { BeforeAfterComparison } from '../BeforeAfterComparison.js';
import type { PeriodMetric } from '@shared/types.js';

// ResizeObserver polyfill — jsdom does not implement it
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// ── Shared fixtures ───────────────────────────────────────────────────────────
const PRE: PeriodMetric = {
  period: { startDate: '2025-01-01', endDate: '2025-06-30', label: 'Pre-AI' },
  metrics: { avgCommitSize: 150, prFrequency: 3, rampUpSpeed: 8, activeContributors: 10 },
};
const POST: PeriodMetric = {
  period: { startDate: '2025-07-01', endDate: '2025-12-31', label: 'Post-AI', markerDate: '2025-07-01' },
  metrics: { avgCommitSize: 180, prFrequency: 4, rampUpSpeed: 6, activeContributors: 12 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Task 1: null/empty branch
// ─────────────────────────────────────────────────────────────────────────────
describe('BeforeAfterComparison — null/empty branch', () => {
  test('renders empty-state prompt when periodMetrics is null', () => {
    render(<BeforeAfterComparison periodMetrics={null} />);
    expect(
      screen.getByText(/Set an AI adoption marker date in Settings/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to Settings/i })).toHaveAttribute(
      'href',
      '#/settings',
    );
  });

  test('renders empty-state prompt when periodMetrics is an empty array', () => {
    render(<BeforeAfterComparison periodMetrics={[]} />);
    expect(
      screen.getByText(/Set an AI adoption marker date in Settings/i),
    ).toBeInTheDocument();
  });

  test('renders skeleton cards when loading with null periodMetrics', () => {
    const { container } = render(
      <BeforeAfterComparison periodMetrics={null} isLoading={true} />,
    );
    // Skeleton cards use animate-pulse class; at least 2 should render
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });

  test('null-branch renders the section header "Before/After AI Adoption"', () => {
    render(<BeforeAfterComparison periodMetrics={null} />);
    expect(screen.getByText('Before/After AI Adoption')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: length-1 (All-time) branch
// ─────────────────────────────────────────────────────────────────────────────
describe('BeforeAfterComparison — length-1 branch', () => {
  const ALL_TIME: PeriodMetric = {
    period: { startDate: '2025-01-01', endDate: '2025-12-31', label: 'All-time' },
    metrics: { avgCommitSize: 140, prFrequency: 3, rampUpSpeed: 7, activeContributors: 9 },
  };

  test('renders the period label as CardTitle', () => {
    render(<BeforeAfterComparison periodMetrics={[ALL_TIME]} />);
    expect(screen.getByText('All-time')).toBeInTheDocument();
  });

  test('renders all 4 METRIC_DEFS rows', () => {
    render(<BeforeAfterComparison periodMetrics={[ALL_TIME]} />);
    expect(screen.getByText('Avg Commit Size (lines)')).toBeInTheDocument();
    expect(screen.getByText('PRs / week / contributor')).toBeInTheDocument();
    expect(screen.getByText('New dev ramp-up (weeks)')).toBeInTheDocument();
    expect(screen.getByText('Active Contributors')).toBeInTheDocument();
  });

  test('does NOT render chart/table toggle (only 2-period has Tabs)', () => {
    render(<BeforeAfterComparison periodMetrics={[ALL_TIME]} />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  test('does NOT render Change column', () => {
    render(<BeforeAfterComparison periodMetrics={[ALL_TIME]} />);
    // 'Change' appears as a header/badge only in length-2/length-N cases
    expect(screen.queryByText('Change')).toBeNull();
  });

  test('renders metric value for each row (using formatNum)', () => {
    render(<BeforeAfterComparison periodMetrics={[ALL_TIME]} />);
    // avgCommitSize = 140 should appear rendered via formatNum (>=100 → rounds to integer)
    expect(screen.getByText('140')).toBeInTheDocument();
  });

  test('renders em-dash for null metric values', () => {
    const withNull: PeriodMetric = {
      period: { startDate: '2025-01-01', endDate: '2025-12-31', label: 'All-time' },
      metrics: { avgCommitSize: null, prFrequency: 3, rampUpSpeed: null, activeContributors: 9 },
    };
    render(<BeforeAfterComparison periodMetrics={[withNull]} />);
    // formatVal uses U+2014 em-dash for null
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2); // both null metrics
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3: length-2 standard branch — chart view
// ─────────────────────────────────────────────────────────────────────────────
describe('BeforeAfterComparison — length-2 chart view', () => {
  test('renders chart view by default', () => {
    render(<BeforeAfterComparison periodMetrics={[PRE, POST]} />);
    expect(screen.getByText('Impact of AI Adoption')).toBeInTheDocument();
    // Chart view row layout — look for the MetricRow col headers
    // "Pre-AI" appears both as subtitle AND as column headers
    const preLabels = screen.getAllByText('Pre-AI');
    expect(preLabels.length).toBeGreaterThanOrEqual(1);
  });

  test('column headers come from period.label, not hardcoded strings', () => {
    const P0: PeriodMetric = {
      period: { startDate: '2024-01-01', endDate: '2024-06-30', label: 'Q1-Q2' },
      metrics: PRE.metrics,
    };
    const P1: PeriodMetric = {
      period: {
        startDate: '2024-07-01',
        endDate: '2024-12-31',
        label: 'Q3-Q4',
        markerDate: '2024-07-01',
      },
      metrics: POST.metrics,
    };
    render(<BeforeAfterComparison periodMetrics={[P0, P1]} />);
    // Labels appear in multiple places (subtitle + column headers) — use getAllByText
    expect(screen.getAllByText(/Q1-Q2/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Q3-Q4/).length).toBeGreaterThanOrEqual(1);
    // Negative: the hardcoded Pre-AI text from prior versions should NOT appear.
    expect(screen.queryByText('Pre-AI')).toBeNull();
    expect(screen.queryByText('Post-AI')).toBeNull();
  });

  test('renders delta badge for each metric', () => {
    const { container } = render(<BeforeAfterComparison periodMetrics={[PRE, POST]} />);
    // Each MetricRow ends with a Badge showing the delta string.
    // For avgCommitSize: 150 → 180 = +20%, positive (lowerIsBetter=false, increase = green → emerald)
    const greenBadges = container.querySelectorAll('[class*="emerald"]');
    const redBadges = container.querySelectorAll('[class*="red-"]');
    // 4 METRIC_DEFS → 4 badges total across green + red
    expect(greenBadges.length + redBadges.length).toBeGreaterThanOrEqual(4);
  });

  test('rampUpSpeed DECREASE (lowerIsBetter=true) produces green delta', () => {
    // PRE.rampUpSpeed = 8, POST.rampUpSpeed = 6 → improvement → green (emerald)
    const { container } = render(<BeforeAfterComparison periodMetrics={[PRE, POST]} />);
    const greenBadges = container.querySelectorAll('[class*="emerald"]');
    expect(greenBadges.length).toBeGreaterThanOrEqual(1);
  });

  test('rampUpSpeed INCREASE produces red delta (polarity inverted)', () => {
    const worse: PeriodMetric = {
      ...POST,
      metrics: { ...POST.metrics, rampUpSpeed: 10 },
    };
    const { container } = render(<BeforeAfterComparison periodMetrics={[PRE, worse]} />);
    // Look for at least one red badge
    const redBadges = container.querySelectorAll('[class*="red-2"], [class*="border-red"]');
    expect(redBadges.length).toBeGreaterThanOrEqual(1);
  });

  test('N/A renders when a metric value is null on either side', () => {
    const withNull: PeriodMetric = {
      ...POST,
      metrics: { ...POST.metrics, prFrequency: null },
    };
    render(<BeforeAfterComparison periodMetrics={[PRE, withNull]} />);
    // pctDelta returns { str: 'N/A', positive: true } when either side is null.
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(1);
  });

  test('HelpPanel is present and expands to show polarity explanation', async () => {
    const user = userEvent.setup();
    render(<BeforeAfterComparison periodMetrics={[PRE, POST]} />);
    // HelpPanel renders collapsed by default — the trigger button is always visible
    const helpBtn = screen.getByText(/What does this mean\?/i);
    expect(helpBtn).toBeInTheDocument();
    // Clicking the trigger expands the panel — then "polarity" text is visible
    await user.click(helpBtn);
    expect(screen.getByText(/polarity/i)).toBeInTheDocument();
  });

  test('HelpPanel copy does NOT contain "productivity" or "performance ranking"', () => {
    render(<BeforeAfterComparison periodMetrics={[PRE, POST]} />);
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/productivity/i);
    expect(body).not.toMatch(/performance ranking/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3 (continued): length-2 table view toggle
// ─────────────────────────────────────────────────────────────────────────────
describe('BeforeAfterComparison — length-2 table view toggle', () => {
  test('clicking the Table tab switches to table rendering', async () => {
    const user = userEvent.setup();
    render(<BeforeAfterComparison periodMetrics={[PRE, POST]} />);
    // Tabs use aria-label="Table view"
    const tableTab = screen.getByRole('tab', { name: /Table view/i });
    await user.click(tableTab);
    // After click, a <table> element should be present
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  test('table view has exactly 4 columns: Metric, <p0.label>, <p1.label>, Change', async () => {
    const user = userEvent.setup();
    render(<BeforeAfterComparison periodMetrics={[PRE, POST]} />);
    await user.click(screen.getByRole('tab', { name: /Table view/i }));
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(4);
    expect(headers[0].textContent).toMatch(/Metric/);
    expect(headers[1].textContent).toMatch(/Pre-AI/);
    expect(headers[2].textContent).toMatch(/Post-AI/);
    expect(headers[3].textContent).toMatch(/Change/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 4: length-N (>=3) multi-period branch
// ─────────────────────────────────────────────────────────────────────────────
describe('BeforeAfterComparison — length-N branch', () => {
  const Q1: PeriodMetric = {
    period: { startDate: '2025-01-01', endDate: '2025-03-31', label: 'Q1 2025' },
    metrics: { avgCommitSize: 100, prFrequency: 2, rampUpSpeed: 9, activeContributors: 8 },
  };
  const Q2: PeriodMetric = {
    period: { startDate: '2025-04-01', endDate: '2025-06-30', label: 'Q2 2025' },
    metrics: { avgCommitSize: 120, prFrequency: 2.5, rampUpSpeed: 8, activeContributors: 9 },
  };
  const Q3: PeriodMetric = {
    period: { startDate: '2025-07-01', endDate: '2025-09-30', label: 'Q3 2025' },
    metrics: { avgCommitSize: 140, prFrequency: 3, rampUpSpeed: 7, activeContributors: 10 },
  };
  const Q4: PeriodMetric = {
    period: { startDate: '2025-10-01', endDate: '2025-12-31', label: 'Q4 2025' },
    metrics: { avgCommitSize: 160, prFrequency: 3.5, rampUpSpeed: 6, activeContributors: 11 },
  };

  test('renders "Period Comparison" title and {N} periods subtitle', () => {
    render(<BeforeAfterComparison periodMetrics={[Q1, Q2, Q3]} />);
    expect(screen.getByText('Period Comparison')).toBeInTheDocument();
    expect(screen.getByText('3 periods')).toBeInTheDocument();
  });

  test('3-period case has 4 columns (Metric + 3 periods)', () => {
    render(<BeforeAfterComparison periodMetrics={[Q1, Q2, Q3]} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(4);
    expect(headers[0].textContent).toMatch(/Metric/);
    expect(headers[1].textContent).toMatch(/Q1 2025/);
    expect(headers[2].textContent).toMatch(/Q2 2025/);
    expect(headers[3].textContent).toMatch(/Q3 2025/);
  });

  test('4-period case has 5 columns', () => {
    render(<BeforeAfterComparison periodMetrics={[Q1, Q2, Q3, Q4]} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(5);
  });

  test('does NOT render chart/table toggle', () => {
    render(<BeforeAfterComparison periodMetrics={[Q1, Q2, Q3]} />);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  test('does NOT render Change column (no pairwise delta in N>2 mode)', () => {
    render(<BeforeAfterComparison periodMetrics={[Q1, Q2, Q3]} />);
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers.some((h) => h && /Change/.test(h))).toBe(false);
  });

  test('each METRIC_DEF appears as a row (4 body rows total)', () => {
    render(<BeforeAfterComparison periodMetrics={[Q1, Q2, Q3]} />);
    expect(screen.getByText('Avg Commit Size (lines)')).toBeInTheDocument();
    expect(screen.getByText('PRs / week / contributor')).toBeInTheDocument();
    expect(screen.getByText('New dev ramp-up (weeks)')).toBeInTheDocument();
    expect(screen.getByText('Active Contributors')).toBeInTheDocument();
  });

  test('null metric values render as em-dash in N>2 mode', () => {
    const withNull: PeriodMetric = {
      ...Q1,
      metrics: { ...Q1.metrics, avgCommitSize: null },
    };
    render(<BeforeAfterComparison periodMetrics={[withNull, Q2, Q3]} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});
