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
import { useBotRatio, type BotRatioRow } from '../../hooks/useBotRatio.js';
import { computeBotRatioInsights } from '../../lib/insights.js';
import { SectionHeader } from '../SectionHeader.js';
import { HelpPanel } from '../HelpPanel.js';
import { StatCalloutRow } from './StatCalloutRow.js';
import { StatCalloutBox } from './StatCalloutBox.js';
import NarrativeCard from './NarrativeCard.js';

interface BotRatioChartProps {
  startDate: string;
  endDate: string;
  repoIds: number[];
}

const chartConfig = {
  botPercentage: {
    label: 'Bot Commit %',
    color: 'var(--chart-2)',
  },
};

const botRatioColumns: ColumnDef<BotRatioRow>[] = [
  { accessorKey: 'periodMonth', header: 'Month', enableSorting: true },
  {
    accessorKey: 'botPercentage',
    header: 'Bot %',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue<number>().toFixed(1)}%</span>
    ),
  },
  {
    accessorKey: 'botCommits',
    header: 'Bot Commits',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue<number>().toLocaleString()}</span>
    ),
  },
  {
    accessorKey: 'humanCommits',
    header: 'Human Commits',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => (
      <span className="tabular-nums">{getValue<number>().toLocaleString()}</span>
    ),
  },
];

export function BotRatioChart({ startDate, endDate, repoIds }: BotRatioChartProps) {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [sorting, setSorting] = useState<SortingState>([]);
  const { data = [], isFetching } = useBotRatio({ startDate, endDate, repoIds });

  const tableInstance = useReactTable({
    data,
    columns: botRatioColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  const insights = computeBotRatioInsights(data);

  const narrativeText = data.length > 0
    ? `Bot contribution trend across ${data.length} month${data.length !== 1 ? 's' : ''}. ${
        insights[2]?.value !== '--' ? `${insights[2].value} trend in bot activity.` : ''
      }`
    : '';

  return (
    <section>
      <div className="flex items-center justify-between">
        <SectionHeader title="Bot vs Human Contributions" scope="filtered" />
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'chart' | 'table')}>
          <TabsList className="h-7 gap-0 bg-transparent border border-border rounded-md p-0">
            <TabsTrigger value="chart" className="h-full px-2 py-0.5 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view"><BarChart3 className="h-3.5 w-3.5" /></TabsTrigger>
            <TabsTrigger value="table" className="h-full px-2 py-0.5 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view"><TableProperties className="h-3.5 w-3.5" /></TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
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
                  No commit data available for this period.
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
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => `${Math.round(Number(value))}%`}
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="botPercentage"
                    stroke="var(--chart-2)"
                    strokeWidth={2}
                    dot={{ r: 4, fill: 'var(--chart-2)' }}
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
          This section shows the percentage of total commits attributed to bots
          (Dependabot, Renovate, GitHub Actions, and similar accounts) versus human
          contributors over time. A rising bot ratio may reflect increasing adoption
          of automated dependency management or CI/CD pipelines. This is not a problem, but
          context that helps you read the human-contributor data accurately.
        </p>
        <p className="mt-2">
          Bot commits are excluded from all cohort and ramp-up analysis. If your bot
          ratio spikes unexpectedly, check whether a new automation was introduced
          around that time. A consistently high bot ratio (over 30%) may indicate your
          collection window captures a lot of infrastructure repos. Consider filtering
          to application repos for cleaner contributor analysis.
        </p>
        <p className="mt-2">
          This view counts commit events, not code volume. A bot that opens many small
          dependency bumps will appear more dominant than its actual code contribution.
        </p>
      </HelpPanel>
    </section>
  );
}
