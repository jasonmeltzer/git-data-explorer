import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { TrendingUp, TrendingDown, Minus, ArrowUpDown, ArrowUp, ArrowDown, BarChart3, TableProperties } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@shared/components/ui/card.js';
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
import type { RollingComparisonResult } from '@shared/types.js';

interface RollingCardsProps {
  data: RollingComparisonResult | undefined;
  isFetching: boolean;
  granularity: 'month' | 'quarter';
  onGranularityChange: (g: 'month' | 'quarter') => void;
}

interface RollingTableRow {
  metric: string;
  current: string;
  prior: string;
  change: string;
  changeValue: number | null | undefined;
  isVolume: boolean;
}

interface MetricCardData {
  label: string;
  value: number | undefined;
  change: number | null | undefined;
  unit?: string;
  isVolume: boolean; // for color direction: volume up = green, size changes neutral
}

function ChangeIndicator({ change, isVolume }: { change: number | null | undefined; isVolume: boolean }) {
  if (change === null || change === undefined) {
    return <span className="text-muted-foreground text-sm">N/A</span>;
  }
  const isPositive = change >= 0;
  const pct = Math.abs(Math.round(change));
  const positiveClass = isVolume ? 'text-emerald-500' : 'text-muted-foreground';
  const negativeClass = isVolume ? 'text-red-500' : 'text-muted-foreground';
  const colorClass = isPositive ? positiveClass : negativeClass;

  return (
    <span className={`flex items-center gap-1 text-sm font-medium ${colorClass}`}>
      {isPositive ? (
        <TrendingUp className="h-4 w-4" />
      ) : change === 0 ? (
        <Minus className="h-4 w-4" />
      ) : (
        <TrendingDown className="h-4 w-4" />
      )}
      {pct}%
    </span>
  );
}

const ROLLING_TABLE_COLUMNS: ColumnDef<RollingTableRow>[] = [
  { accessorKey: 'metric', header: 'Metric', enableSorting: true },
  {
    accessorKey: 'current',
    header: 'Current Period',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => <span className="tabular-nums">{getValue<string>()}</span>,
  },
  {
    accessorKey: 'prior',
    header: 'Prior Period',
    enableSorting: true,
    meta: { align: 'right' as const },
    cell: ({ getValue }) => <span className="tabular-nums">{getValue<string>()}</span>,
  },
  {
    accessorKey: 'change',
    header: 'Change',
    enableSorting: false,
    meta: { align: 'right' as const },
    cell: ({ row }) => {
      const { changeValue, isVolume } = row.original;
      if (changeValue === null || changeValue === undefined) {
        return <span className="text-muted-foreground text-sm">N/A</span>;
      }
      const isPositive = changeValue >= 0;
      const positiveClass = isVolume ? 'text-emerald-500' : 'text-muted-foreground';
      const negativeClass = isVolume ? 'text-red-500' : 'text-muted-foreground';
      return (
        <span className={`tabular-nums text-xs font-medium ${isPositive ? positiveClass : negativeClass}`}>
          {row.original.change}
        </span>
      );
    },
  },
];

export default function RollingCards({
  data,
  isFetching,
  granularity,
  onGranularityChange,
}: RollingCardsProps) {
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [sorting, setSorting] = useState<SortingState>([]);

  const cards: MetricCardData[] = [
    {
      label: 'PR Count',
      value: data?.current.prCount,
      change: data?.changes.prFrequency,
      isVolume: true,
    },
    {
      label: 'Commit Count',
      value: data?.current.commitCount,
      change: data?.changes.commitFrequency,
      isVolume: true,
    },
    {
      label: 'Avg PR Size',
      value: data?.current.avgPrSize != null ? Math.round(data.current.avgPrSize) : undefined,
      change: data?.changes.prSize,
      unit: 'lines',
      isVolume: false,
    },
    {
      label: 'Avg Commit Size',
      value: data?.current.avgCommitSize != null ? Math.round(data.current.avgCommitSize) : undefined,
      change: data?.changes.commitSize,
      unit: 'lines',
      isVolume: false,
    },
  ];

  const formatChange = (change: number | null | undefined) => {
    if (change === null || change === undefined) return 'N/A';
    const pct = Math.abs(Math.round(change));
    return change >= 0 ? `+${pct}%` : `-${pct}%`;
  };

  const tableRows: RollingTableRow[] = [
    { metric: 'PR Count', current: data?.current.prCount?.toLocaleString() ?? '—', prior: data?.prior.prCount?.toLocaleString() ?? '—', change: formatChange(data?.changes.prFrequency), changeValue: data?.changes.prFrequency, isVolume: true },
    { metric: 'Commit Count', current: data?.current.commitCount?.toLocaleString() ?? '—', prior: data?.prior.commitCount?.toLocaleString() ?? '—', change: formatChange(data?.changes.commitFrequency), changeValue: data?.changes.commitFrequency, isVolume: true },
    { metric: 'Avg PR Size', current: data?.current.avgPrSize != null ? `${Math.round(data.current.avgPrSize).toLocaleString()} lines` : '—', prior: data?.prior.avgPrSize != null ? `${Math.round(data.prior.avgPrSize).toLocaleString()} lines` : '—', change: formatChange(data?.changes.prSize), changeValue: data?.changes.prSize, isVolume: false },
    { metric: 'Avg Commit Size', current: data?.current.avgCommitSize != null ? `${Math.round(data.current.avgCommitSize).toLocaleString()} lines` : '—', prior: data?.prior.avgCommitSize != null ? `${Math.round(data.prior.avgCommitSize).toLocaleString()} lines` : '—', change: formatChange(data?.changes.commitSize), changeValue: data?.changes.commitSize, isVolume: false },
  ];

  const tableInstance = useReactTable({
    data: tableRows,
    columns: ROLLING_TABLE_COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Tabs value={granularity} onValueChange={(v) => onGranularityChange(v as 'month' | 'quarter')}>
          <TabsList className="h-8 gap-1">
            <TabsTrigger value="month" className="px-3 py-1 data-active:bg-primary data-active:text-primary-foreground">Month</TabsTrigger>
            <TabsTrigger value="quarter" className="px-3 py-1 data-active:bg-primary data-active:text-primary-foreground">Quarter</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'chart' | 'table')}>
          <TabsList className="h-7 gap-0 bg-transparent border border-border rounded-md p-0">
            <TabsTrigger value="chart" className="h-full px-2 py-0.5 rounded-r-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Chart view"><BarChart3 className="h-3.5 w-3.5" /></TabsTrigger>
            <TabsTrigger value="table" className="h-full px-2 py-0.5 rounded-l-none data-active:bg-primary data-active:text-primary-foreground" aria-label="Table view"><TableProperties className="h-3.5 w-3.5" /></TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {data && (
        <p className="text-xs text-muted-foreground">
          {data.current.label} vs {data.prior.label}
        </p>
      )}

      {viewMode === 'chart' ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:grid-cols-4">
          {cards.map((card) => (
            <Card key={card.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {card.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isFetching && card.value === undefined ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-24" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ) : (
                  <>
                    <div className="text-[28px] font-semibold leading-none mb-2">
                      {card.value !== undefined
                        ? card.value.toLocaleString()
                        : '—'}
                      {card.unit && card.value !== undefined && (
                        <span className="text-sm font-normal text-muted-foreground ml-1">
                          {card.unit}
                        </span>
                      )}
                    </div>
                    <ChangeIndicator change={card.change} isVolume={card.isVolume} />
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {isFetching && !data ? (
            <Skeleton className="h-[200px] w-full" />
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
  );
}
