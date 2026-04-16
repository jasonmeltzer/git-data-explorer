import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, BarChart3, TableProperties } from 'lucide-react';
import { SectionHeader } from '../SectionHeader.js';
import { HelpPanel } from '../HelpPanel.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Badge } from '@shared/components/ui/badge.js';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@shared/components/ui/table.js';
import { pctDelta, formatNum } from '../../lib/deltaFormat.js';
import type { PeriodMetric } from '@shared/types.js';

export interface BeforeAfterComparisonProps {
  periodMetrics: PeriodMetric[] | null;
  isLoading?: boolean;
}

// Metric definitions: key in metrics Record, display label, and whether lower is better
const METRIC_DEFS = [
  { key: 'avgCommitSize', label: 'Avg Commit Size (lines)', lowerIsBetter: false },
  { key: 'prFrequency', label: 'PRs / week / contributor', lowerIsBetter: false },
  { key: 'rampUpSpeed', label: 'New dev ramp-up (weeks)', lowerIsBetter: true },
  { key: 'activeContributors', label: 'Active Contributors', lowerIsBetter: false },
];

interface MetricRowProps {
  label: string;
  col0Value: string;
  col1Value: string;
  deltaStr: string;
  deltaPositive: boolean;
  col0Header: string;
  col1Header: string;
}

function MetricRow({ label, col0Value, col1Value, deltaStr, deltaPositive, col0Header, col1Header }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end">
          <span className="text-xs text-muted-foreground">{col0Header}</span>
          <span className="text-sm tabular-nums w-16 text-right">{col0Value}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs text-muted-foreground">{col1Header}</span>
          <span className="text-sm tabular-nums w-16 text-right font-medium">{col1Value}</span>
        </div>
        <Badge
          variant="outline"
          className={`text-xs w-16 justify-center ${deltaPositive ? 'text-emerald-500 border-emerald-200' : 'text-red-500 border-red-200'}`}
        >
          {deltaStr}
        </Badge>
      </div>
    </div>
  );
}

interface ComparisonTableRow {
  metric: string;
  [key: string]: string | boolean;
}

const formatVal = (v: number | null | undefined): string =>
  v == null ? '—' : formatNum(v);

export function BeforeAfterComparison({ periodMetrics, isLoading }: BeforeAfterComparisonProps) {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [sorting, setSorting] = useState<SortingState>([]);

  const periods = periodMetrics ?? [];
  const p0 = periods[0] ?? null;
  const p1 = periods[1] ?? null;

  // Build table rows for 2-period case (safe to call always — data is empty when not applicable)
  const twoPeriodsTableRows: ComparisonTableRow[] = useMemo(() => {
    if (!p0 || !p1) return [];
    return METRIC_DEFS.map(({ key, label, lowerIsBetter }) => {
      const before = p0.metrics[key] as number | null | undefined;
      const after = p1.metrics[key] as number | null | undefined;
      const delta = before != null && after != null
        ? pctDelta(before, after, lowerIsBetter)
        : { str: 'N/A', positive: true };
      return {
        metric: label,
        before: formatVal(before),
        after: formatVal(after),
        change: delta.str,
        changePositive: delta.positive,
      };
    });
  }, [p0, p1]);

  // Dynamic columns for 2-period table (label comes from period)
  const twoPeriodsColumns: ColumnDef<ComparisonTableRow>[] = useMemo(() => {
    return [
      { accessorKey: 'metric', header: 'Metric', enableSorting: true },
      {
        accessorKey: 'before',
        header: p0?.period.label ?? 'Before',
        enableSorting: true,
        meta: { align: 'right' as const },
        cell: ({ getValue }) => <span className="tabular-nums">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'after',
        header: p1?.period.label ?? 'After',
        enableSorting: true,
        meta: { align: 'right' as const },
        cell: ({ getValue }) => <span className="tabular-nums">{getValue<string>()}</span>,
      },
      {
        accessorKey: 'change',
        header: 'Change',
        enableSorting: true,
        meta: { align: 'right' as const },
        cell: ({ row }) => (
          <span
            className={`tabular-nums text-xs font-medium ${row.original.changePositive ? 'text-emerald-500' : 'text-red-500'}`}
          >
            {row.original.change as string}
          </span>
        ),
      },
    ];
  }, [p0, p1]);

  // Build table rows for multi-period case
  const multiTableRows: ComparisonTableRow[] = useMemo(() => {
    if (periods.length <= 2) return [];
    return METRIC_DEFS.map(({ key, label }) => {
      const row: ComparisonTableRow = { metric: label };
      periods.forEach((p, i) => {
        row[`period_${i}`] = formatVal(p.metrics[key] as number | null | undefined);
      });
      return row;
    });
  }, [periods]);

  const multiColumns: ColumnDef<ComparisonTableRow>[] = useMemo(() => {
    if (periods.length <= 2) return [];
    return [
      { accessorKey: 'metric', header: 'Metric', enableSorting: true },
      ...periods.map((p, i) => ({
        accessorKey: `period_${i}`,
        header: p.period.label,
        enableSorting: true,
        meta: { align: 'right' as const },
        cell: ({ getValue }: { getValue: () => unknown }) => (
          <span className="tabular-nums">{getValue() as string}</span>
        ),
      })),
    ];
  }, [periods]);

  // All useReactTable calls at top level (unconditional hooks)
  const twoPeriodsTable = useReactTable({
    data: twoPeriodsTableRows,
    columns: twoPeriodsColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  const multiTable = useReactTable({
    data: multiTableRows,
    columns: multiColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  // ── Empty / null / loading state ──────────────────────────────────────────
  if (!periodMetrics || periods.length === 0) {
    if (isLoading) {
      return (
        <section>
          <SectionHeader title="Before/After AI Adoption" scope="filtered" />
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="animate-pulse">
              <CardContent className="p-6 h-48" />
            </Card>
            <Card className="animate-pulse">
              <CardContent className="p-6 h-48" />
            </Card>
          </div>
        </section>
      );
    }
    return (
      <section>
        <SectionHeader title="Before/After AI Adoption" scope="filtered" />
        <Card className="mt-4">
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              Set an AI adoption marker date in Settings to compare before and after metrics.{' '}
              <a href="#/settings" className="text-primary hover:underline">
                Go to Settings
              </a>
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  // ── Single-period rendering ───────────────────────────────────────────────
  if (periods.length === 1 && p0) {
    return (
      <section>
        <SectionHeader title="Before/After AI Adoption" scope="filtered" />
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{p0.period.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {METRIC_DEFS.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between py-2 border-b last:border-0">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className="text-sm tabular-nums font-medium">
                    {formatVal(p0.metrics[key] as number | null | undefined)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <div className="mt-4">
          <HelpPanel>
            <p>
              This view compares contribution patterns from before and after the AI adoption
              date you set in Settings. Set an AI marker date to enable the full before/after comparison.
            </p>
          </HelpPanel>
        </div>
      </section>
    );
  }

  // ── Two-period rendering ──────────────────────────────────────────────────
  if (periods.length === 2 && p0 && p1) {
    return (
      <section>
        <div className="flex items-center justify-between">
          <SectionHeader title="Before/After AI Adoption" scope="filtered" />
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'chart' | 'table')}>
            <TabsList className="h-7 gap-0 bg-transparent border border-border rounded-md p-0">
              <TabsTrigger value="chart" className="h-full px-2 py-0.5 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view"><BarChart3 className="h-3.5 w-3.5" /></TabsTrigger>
              <TabsTrigger value="table" className="h-full px-2 py-0.5 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view"><TableProperties className="h-3.5 w-3.5" /></TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Impact of AI Adoption</CardTitle>
            <p className="text-xs text-muted-foreground">{p0.period.label} vs. {p1.period.label}</p>
          </CardHeader>
          <CardContent>
            {viewMode === 'chart' ? (
              <div className="space-y-0">
                <div className="flex justify-between text-xs text-muted-foreground pb-2 border-b">
                  <span>Metric</span>
                  <div className="flex gap-3">
                    <span className="w-16 text-right">{p0.period.label}</span>
                    <span className="w-16 text-right">{p1.period.label}</span>
                    <span className="w-16 text-right">Change</span>
                  </div>
                </div>
                {METRIC_DEFS.map(({ key, label, lowerIsBetter }) => {
                  const before = p0.metrics[key] as number | null | undefined;
                  const after = p1.metrics[key] as number | null | undefined;
                  const delta = before != null && after != null
                    ? pctDelta(before, after, lowerIsBetter)
                    : { str: 'N/A', positive: true };
                  return (
                    <MetricRow
                      key={key}
                      label={label}
                      col0Value={formatVal(before)}
                      col1Value={formatVal(after)}
                      deltaStr={delta.str}
                      deltaPositive={delta.positive}
                      col0Header={p0.period.label}
                      col1Header={p1.period.label}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    {twoPeriodsTable.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => {
                          const isRightAligned =
                            (header.column.columnDef.meta as { align?: string } | undefined)?.align === 'right';
                          const sorted = header.column.getIsSorted();
                          return (
                            <TableHead key={header.id} className={isRightAligned ? 'text-right' : ''}>
                              {header.column.getCanSort() ? (
                                <button
                                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                                  style={isRightAligned ? { marginLeft: 'auto' } : undefined}
                                  onClick={header.column.getToggleSortingHandler()}
                                >
                                  {flexRender(header.column.columnDef.header, header.getContext())}
                                  {sorted === 'asc' ? (
                                    <ArrowUp className="h-3 w-3" />
                                  ) : sorted === 'desc' ? (
                                    <ArrowDown className="h-3 w-3" />
                                  ) : (
                                    <ArrowUpDown className="h-3 w-3 opacity-50" />
                                  )}
                                </button>
                              ) : (
                                flexRender(header.column.columnDef.header, header.getContext())
                              )}
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {twoPeriodsTable.getRowModel().rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => {
                          const isRightAligned =
                            (cell.column.columnDef.meta as { align?: string } | undefined)?.align === 'right';
                          return (
                            <TableCell key={cell.id} className={isRightAligned ? 'text-right' : ''}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="mt-4">
          <HelpPanel>
            <p>
              This view compares contribution patterns from before and after the AI adoption
              date you set in Settings. The left column shows averages from before the date;
              the right column shows averages from after it. The change column shows the
              percentage shift.
            </p>
            <p className="mt-2">
              Green values mean the metric improved; red means it worsened. For metrics
              where a decrease is a positive signal (such as ramp-up weeks), the color
              polarity is inverted so that improvement always shows green.
            </p>
            <p className="mt-2">
              If you have not set an AI adoption date, this view will not show comparisons.
              Go to{' '}
              <a href="#/settings" className="underline hover:text-foreground">Settings &gt; AI Adoption Date</a>{' '}
              to configure it.
            </p>
            <p className="mt-2">
              This view shows how contribution patterns shifted across your team, not individual performance scores.
            </p>
          </HelpPanel>
        </div>
      </section>
    );
  }

  // ── Multi-period rendering (N > 2, Phase 10 ready) ────────────────────────
  return (
    <section>
      <SectionHeader title="Before/After AI Adoption" scope="filtered" />
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Period Comparison</CardTitle>
          <p className="text-xs text-muted-foreground">{periods.length} periods</p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {multiTable.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const isRightAligned =
                        (header.column.columnDef.meta as { align?: string } | undefined)?.align === 'right';
                      const sorted = header.column.getIsSorted();
                      return (
                        <TableHead key={header.id} className={isRightAligned ? 'text-right' : ''}>
                          {header.column.getCanSort() ? (
                            <button
                              className="flex items-center gap-1 hover:text-foreground transition-colors"
                              style={isRightAligned ? { marginLeft: 'auto' } : undefined}
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === 'asc' ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : sorted === 'desc' ? (
                                <ArrowDown className="h-3 w-3" />
                              ) : (
                                <ArrowUpDown className="h-3 w-3 opacity-50" />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {multiTable.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => {
                      const isRightAligned =
                        (cell.column.columnDef.meta as { align?: string } | undefined)?.align === 'right';
                      return (
                        <TableCell key={cell.id} className={isRightAligned ? 'text-right' : ''}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
