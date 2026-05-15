import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, BarChart3, TableProperties } from 'lucide-react';
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@shared/components/ui/chart.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@shared/components/ui/table.js';
import { usePrTurnaround, type PrTurnaroundRow } from '../../hooks/usePrTurnaround.js';
import { computePrTurnaroundInsights } from '../../lib/insights.js';
import { formatNum } from '../../lib/deltaFormat.js';
import { SectionHeader } from '../SectionHeader.js';
import { HelpPanel } from '../HelpPanel.js';
import { StatCalloutRow } from './StatCalloutRow.js';
import { StatCalloutBox } from './StatCalloutBox.js';
import NarrativeCard from './NarrativeCard.js';

interface PrTurnaroundChartProps {
  startDate: string;
  endDate: string;
  repoIds: number[];
}

const chartConfig = {
  medianHoursToMerge: {
    label: 'Median Hours to Merge',
    color: 'var(--chart-1)',
  },
};

const prTurnaroundColumns: ColumnDef<PrTurnaroundRow>[] = [
  { accessorKey: 'periodMonth', header: 'Month', enableSorting: true },
  {
    accessorKey: 'medianHoursToMerge',
    header: 'Median Hours to Merge',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => {
      const hours = getValue<number>();
      return (
        <span className="tabular-nums">
          {hours < 24 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)}d`}
        </span>
      );
    },
  },
  {
    accessorKey: 'avgHoursToMerge',
    header: 'Avg Hours to Merge',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => {
      const hours = getValue<number>();
      return (
        <span className="tabular-nums">
          {hours < 24 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)}d`}
        </span>
      );
    },
  },
  {
    accessorKey: 'prCount',
    header: 'PR Count',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => <span className="tabular-nums">{formatNum(getValue<number>())}</span>,
  },
];

export function PrTurnaroundChart({ startDate, endDate, repoIds }: PrTurnaroundChartProps) {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [sorting, setSorting] = useState<SortingState>([]);
  const { data = [], isFetching } = usePrTurnaround({ startDate, endDate, repoIds });

  const tableInstance = useReactTable({
    data,
    columns: prTurnaroundColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  const insights = computePrTurnaroundInsights(data);

  const narrativeText = data.length > 0
    ? `Showing PR review turnaround across ${data.length} month${data.length !== 1 ? 's' : ''}. ${
        insights[2]?.value !== '--' ? `Trend: ${insights[2].value}.` : ''
      }`
    : '';

  return (
    <section>
      <div className="flex items-center justify-between">
        <SectionHeader title="PR Review Turnaround" scope="filtered" />
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'chart' | 'table')}>
          <TabsList className="h-7 gap-0 bg-transparent border border-border rounded-md p-0">
            <TabsTrigger value="chart" className="h-full px-2 py-0.5 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view"><BarChart3 className="h-3.5 w-3.5" /></TabsTrigger>
            <TabsTrigger value="table" className="h-full px-2 py-0.5 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view"><TableProperties className="h-3.5 w-3.5" /></TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {(() => {
        // D-06 coverage caveat: surfaces when some PRs in the window lack first_commit_at data.
        // Window-wide rollup of totalCovered vs totalAll; hides at 100% coverage (self-cleaning).
        const totalCovered = data.reduce((s, r) => s + r.prCount, 0);
        const totalAll = data.reduce((s, r) => s + r.totalPrCount, 0);
        if (totalCovered >= totalAll || totalAll === 0) return null;
        return (
          <p className="text-xs text-muted-foreground -mt-1 mb-2">
            Based on {totalCovered.toLocaleString()} of {totalAll.toLocaleString()} PRs in window. PRs without first-commit data are excluded from the median; re-collection populates the rest.
          </p>
        );
      })()}
      <div className="mt-4">
        <StatCalloutRow>
          {insights.map((insight) => (
            <StatCalloutBox
              key={insight.label}
              label={insight.label}
              value={insight.value}
              delta={insight.delta}
              deltaDir={insight.deltaDir}
              isLoading={isFetching && data.length === 0}
            />
          ))}
        </StatCalloutRow>
      </div>

      <div className="mt-4">
        {viewMode === 'chart' ? (
          <>
            {isFetching && data.length === 0 ? (
              <div className="min-h-[240px] w-full flex flex-col justify-end gap-2 p-4">
                <Skeleton className="h-[60%] w-full" />
                <Skeleton className="h-[80%] w-full" />
                <Skeleton className="h-[50%] w-full" />
              </div>
            ) : data.length === 0 ? (
              <div className="min-h-[240px] w-full flex items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  Not enough merged PRs in this range to calculate a reliable median.
                </p>
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[300px] w-full">
                <LineChart accessibilityLayer data={data}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="periodMonth"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(v: number) => v < 24 ? `${v}h` : `${(v / 24).toFixed(1)}d`}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => {
                          const hours = Number(value);
                          return hours < 24 ? `${Math.round(hours)}h` : `${(hours / 24).toFixed(1)}d`;
                        }}
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="medianHoursToMerge"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    dot={{ r: 4, fill: 'var(--chart-1)' }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ChartContainer>
            )}
          </>
        ) : (
          <>
            {isFetching && data.length === 0 ? (
              <Skeleton className="h-[300px] w-full" />
            ) : data.length === 0 ? (
              <div className="min-h-[120px] flex items-center justify-center">
                <p className="text-sm text-muted-foreground">No data for selected filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    {tableInstance.getHeaderGroups().map((headerGroup) => (
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
                    {tableInstance.getRowModel().rows.map((row) => (
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
          </>
        )}
      </div>

      {viewMode === 'chart' && narrativeText && (
        <NarrativeCard text={narrativeText} isFetching={isFetching && data.length === 0} />
      )}

      <HelpPanel>
        <p>
          "Cycle time" here means <strong>first commit to merge</strong>, not PR open to
          merge. This matches the LDX3 reference methodology — the time from when work
          actually started (the first commit on the branch) to when it landed on the
          default branch.
        </p>
        <p className="mt-2">
          For each PR we fetch every commit and take{' '}
          <code className="text-xs">MIN(authoredDate, committedDate)</code> per commit, then
          the overall <code className="text-xs">MIN</code> across all the PR's commits to
          determine when work began. This <strong>diverges from LDX3</strong>, which uses
          <code className="text-xs"> committedDate</code> only. The divergence is intentional:
          LDX3's <code className="text-xs">committedDate</code>-only choice resets to the
          rebase time and biases cycle time short for long-running branches.{' '}
          <code className="text-xs">MIN(authoredDate, committedDate)</code> preserves true
          "work started" timing through rebases.
        </p>
        <p className="mt-2">
          Each data point is the <strong>median</strong> hours-to-merge for PRs whose first
          commit landed in that month. The median is a real PR's cycle time (lower-midpoint
          for even-N months), not an interpolated average — large outliers do not distort it.
          The secondary "Mean" column in the table view shows the arithmetic mean for
          reference.
        </p>
        <p className="mt-2">
          PRs whose elapsed time exceeds a configurable outlier cap (default 90 days,
          editable on the Settings page) are excluded from the median. Very long-running
          branches or rebase-onto-old-base PRs are kept in the underlying PR table but do
          not skew the cycle-time trend. PRs missing first-commit data are also excluded;
          the coverage caveat above shows current coverage. Re-collection populates the
          rest.
        </p>
      </HelpPanel>
    </section>
  );
}
