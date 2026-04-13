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
import { useBeforeAfter } from '../../hooks/useBeforeAfter.js';
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

interface BeforeAfterComparisonProps {
  repoIds: number[];
  aiMarkerDate: string | null;
}

interface BeforeAfterTableRow {
  metric: string;
  before: string;
  after: string;
  change: string;
  changePositive: boolean;
}

interface MetricRowProps {
  label: string;
  beforeValue: string;
  afterValue: string;
  deltaStr: string;
  deltaPositive: boolean;
}

function MetricRow({ label, beforeValue, afterValue, deltaStr, deltaPositive }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm tabular-nums w-16 text-right">{beforeValue}</span>
        <span className="text-sm tabular-nums w-16 text-right font-medium">{afterValue}</span>
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


const TABLE_COLUMNS: ColumnDef<BeforeAfterTableRow>[] = [
  { accessorKey: 'metric', header: 'Metric', enableSorting: true },
  {
    accessorKey: 'before',
    header: 'Before',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => <span className="tabular-nums">{getValue<string>()}</span>,
  },
  {
    accessorKey: 'after',
    header: 'After',
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
        {row.original.change}
      </span>
    ),
  },
];

export function BeforeAfterComparison({ repoIds, aiMarkerDate }: BeforeAfterComparisonProps) {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [sorting, setSorting] = useState<SortingState>([]);
  const { data, isFetching } = useBeforeAfter({ repoIds });

  // Compute deltas (null-safe — only computed when data is present)
  const commitSizeDelta = data ? pctDelta(data.before.avgCommitSize, data.after.avgCommitSize) : null;
  const prFreqDelta = data ? pctDelta(data.before.prFrequency, data.after.prFrequency) : null;
  const rampUpDelta = data
    ? (data.before.rampUpSpeed != null && data.after.rampUpSpeed != null
        ? pctDelta(data.before.rampUpSpeed, data.after.rampUpSpeed, true)
        : { str: 'N/A', positive: true })
    : null;
  const contributorsDelta = data ? pctDelta(data.before.activeContributors, data.after.activeContributors) : null;
  const formatRampUp = (v: number | null) => (v == null ? '—' : formatNum(v));

  const tableRows: BeforeAfterTableRow[] = useMemo(() => {
    if (!data || !commitSizeDelta || !prFreqDelta || !rampUpDelta || !contributorsDelta) return [];
    return [
      { metric: 'Avg Commit Size (lines)', before: formatNum(data.before.avgCommitSize), after: formatNum(data.after.avgCommitSize), change: commitSizeDelta.str, changePositive: commitSizeDelta.positive },
      { metric: 'PRs / week / contributor', before: formatNum(data.before.prFrequency), after: formatNum(data.after.prFrequency), change: prFreqDelta.str, changePositive: prFreqDelta.positive },
      { metric: 'New dev ramp-up (weeks)', before: formatRampUp(data.before.rampUpSpeed), after: formatRampUp(data.after.rampUpSpeed), change: rampUpDelta.str, changePositive: rampUpDelta.positive },
      { metric: 'Active Contributors', before: formatNum(data.before.activeContributors), after: formatNum(data.after.activeContributors), change: contributorsDelta.str, changePositive: contributorsDelta.positive },
    ];
  }, [data]);

  const tableInstance = useReactTable({
    data: tableRows,
    columns: TABLE_COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  if (!aiMarkerDate) {
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

  if (isFetching && !data) {
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

  if (!data || !commitSizeDelta || !prFreqDelta || !rampUpDelta || !contributorsDelta) {
    return (
      <section>
        <SectionHeader title="Before/After AI Adoption" scope="filtered" />
        <Card className="mt-4">
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">
              Not enough data to calculate before/after comparison. Collect more data or adjust your date range.
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

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
          <p className="text-xs text-muted-foreground">AI marker date: {aiMarkerDate}</p>
        </CardHeader>
        <CardContent>
          {viewMode === 'chart' ? (
            <div className="space-y-0">
              <div className="flex justify-between text-xs text-muted-foreground pb-2 border-b">
                <span>Metric</span>
                <div className="flex gap-3">
                  <span className="w-16 text-right">Before</span>
                  <span className="w-16 text-right">After</span>
                  <span className="w-16 text-right">Change</span>
                </div>
              </div>
              <MetricRow
                label="Avg Commit Size (lines)"
                beforeValue={formatNum(data.before.avgCommitSize)}
                afterValue={formatNum(data.after.avgCommitSize)}
                deltaStr={commitSizeDelta.str}
                deltaPositive={commitSizeDelta.positive}
              />
              <MetricRow
                label="PRs / week / contributor"
                beforeValue={formatNum(data.before.prFrequency)}
                afterValue={formatNum(data.after.prFrequency)}
                deltaStr={prFreqDelta.str}
                deltaPositive={prFreqDelta.positive}
              />
              <MetricRow
                label="New dev ramp-up (weeks)"
                beforeValue={formatRampUp(data.before.rampUpSpeed)}
                afterValue={formatRampUp(data.after.rampUpSpeed)}
                deltaStr={rampUpDelta.str}
                deltaPositive={rampUpDelta.positive}
              />
              <MetricRow
                label="Active Contributors"
                beforeValue={formatNum(data.before.activeContributors)}
                afterValue={formatNum(data.after.activeContributors)}
                deltaStr={contributorsDelta.str}
                deltaPositive={contributorsDelta.positive}
              />
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
        </CardContent>
      </Card>
      <div className="mt-4">
        <HelpPanel>
          <p>
            This view compares contribution patterns from before and after the AI adoption
            date you set in Settings. The left column shows averages from before the date;
            the right column shows averages from after it. The change column shows the
            absolute and percentage shift.
          </p>
          <p className="mt-2">
            Green values mean the metric increased; red means it decreased. For metrics
            where a decrease is a positive signal (such as PR turnaround time or ramp-up
            weeks), the color polarity is inverted so that improvement always shows green.
          </p>
          <p className="mt-2">
            If you have not set an AI adoption date, this view will not show comparisons.
            Go to{' '}
            <a href="#/settings" className="underline hover:text-foreground">Settings &gt; AI Adoption Date</a>{' '}
            to configure it.
          </p>
          <p className="mt-2">
            Use this view to make a concrete case for the impact of AI tooling:
            "After AI adoption, new developers were opening PRs twice as large within
            their first month" is the kind of finding this view is designed to surface.
            Consider pairing this with the Cohort Trends chart to see whether the shift
            is concentrated in newer contributors or org-wide.
          </p>
          <p className="mt-2">
            This view shows how contribution patterns shifted across your team, not individual performance scores.
          </p>
        </HelpPanel>
      </div>
    </section>
  );
}
