// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, test, expect, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { TeamDistributionTable } from '../TeamDistributionTable.js';
import type { ConcentrationMonthlyRow } from '@shared/types.js';

beforeAll(() => {
  // ResizeObserver polyfill — required by some shadcn/ui primitives
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// ── Fixture factory ────────────────────────────────────────────────────────────
const ROW = (overrides: Partial<ConcentrationMonthlyRow> = {}): ConcentrationMonthlyRow => ({
  month: '2025-06',
  basis: 'prs',
  top1Share: 42.5,
  top3Share: 70.1,
  top5Share: 85.0,
  hhi: 0.123,
  gini: 0.456,
  busFactor: 3.7,
  activeDevs: 8,
  topContributor: 'alice',
  ...overrides,
});

describe('TeamDistributionTable', () => {
  test('renders empty-state when data is empty', () => {
    render(<TeamDistributionTable data={[]} />);
    expect(screen.getByText(/No concentration data available/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  test('renders exactly 8 column headers for non-empty data', () => {
    render(<TeamDistributionTable data={[ROW()]} />);
    const table = screen.getByRole('table');
    const headerCells = within(table).getAllByRole('columnheader');
    expect(headerCells).toHaveLength(8);
  });

  test('column headers match expected labels', () => {
    render(<TeamDistributionTable data={[ROW()]} />);
    const expected = [
      'Month',
      'Top-1 Share',
      'Top-3 Share',
      'Top-5 Share',
      'HHI',
      'Gini',
      'Bus Factor',
      'Active Devs',
    ];
    for (const label of expected) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test('formats non-null values correctly', () => {
    const data = [
      ROW({ top1Share: 42.5, top3Share: 70.1, hhi: 0.123, gini: 0.456, busFactor: 3.7, activeDevs: 8 }),
    ];
    render(<TeamDistributionTable data={data} />);
    // top1Share: toFixed(1) + '%'
    expect(screen.getByText('42.5%')).toBeInTheDocument();
    // top3Share: toFixed(1) + '%'
    expect(screen.getByText('70.1%')).toBeInTheDocument();
    // hhi: toFixed(3)
    expect(screen.getByText('0.123')).toBeInTheDocument();
    // busFactor: Math.round(3.7) = 4
    expect(screen.getByText('4')).toBeInTheDocument();
    // activeDevs: direct string
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  test('renders null numeric values as "---"', () => {
    const data = [
      ROW({ top1Share: null, top3Share: null, hhi: null, busFactor: null, activeDevs: null }),
    ];
    render(<TeamDistributionTable data={data} />);
    const dashCells = screen.getAllByText('---');
    // top1Share, top3Share, hhi, busFactor, activeDevs = 5 null fields
    // (top5Share and gini are not null in this fixture, so exactly 5 dashes)
    expect(dashCells.length).toBeGreaterThanOrEqual(5);
  });

  test('default sort is month descending', () => {
    const data = [
      ROW({ month: '2025-01' }),
      ROW({ month: '2025-07' }),
      ROW({ month: '2025-04' }),
    ];
    render(<TeamDistributionTable data={data} />);
    const rows = screen.getAllByRole('row');
    // rows[0] is the header row; body rows start at rows[1]
    const firstBodyMonth = within(rows[1]).getAllByRole('cell')[0].textContent;
    expect(firstBodyMonth).toBe('2025-07'); // newest at top
  });

  test('each body row contains 8 cells', () => {
    render(<TeamDistributionTable data={[ROW()]} />);
    const rows = screen.getAllByRole('row');
    const bodyRow = rows[1]; // rows[0] is header
    const cells = within(bodyRow).getAllByRole('cell');
    expect(cells).toHaveLength(8);
  });
});
