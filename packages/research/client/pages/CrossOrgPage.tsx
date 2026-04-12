import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/components/ui/table.js';
import { InlineCohortChart, InlineRampUpChart } from '../components/InlineCharts.js';
import AggregationToggle from '../components/AggregationToggle.js';
import { useOrgs } from '../hooks/useOrgs.js';
import {
  useCrossOrgCohortMetrics,
  useCrossOrgRampUp,
  useOrgComparison,
  type AggregationMode,
  type OrgComparisonRow,
} from '../hooks/useAggregation.js';

export default function CrossOrgPage() {
  const { data: orgs, isLoading: orgsLoading } = useOrgs();
  const [mode, setMode] = useState<AggregationMode>('weighted');
  const [selectedOrgIds, setSelectedOrgIds] = useState<Set<number>>(new Set());
  const [sorting, setSorting] = useState<SortingState>([]);

  const orgIds = Array.from(selectedOrgIds);
  const hasEnough = orgIds.length >= 2;

  const { data: commitMetrics, isFetching: commitsFetching } = useCrossOrgCohortMetrics(mode, orgIds, 'commits');
  const { data: prMetrics, isFetching: prsFetching } = useCrossOrgCohortMetrics(mode, orgIds, 'prs');
  const { data: rampUpData, isFetching: rampUpFetching } = useCrossOrgRampUp(mode, orgIds);
  const { data: comparisonData, isFetching: comparisonFetching } = useOrgComparison(orgIds);

  const toggleOrg = (id: number) => {
    setSelectedOrgIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const columns: ColumnDef<OrgComparisonRow>[] = [
    {
      accessorKey: 'label',
      header: ({ column }) => (
        <button
          className="flex items-center gap-1 text-sm font-medium hover:text-foreground"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Label
          {column.getIsSorted() === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : column.getIsSorted() === 'desc' ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
      ),
    },
    {
      accessorKey: 'sizeCategory',
      header: 'Size',
      cell: ({ getValue }) => (getValue() as string | null) ?? '—',
    },
    {
      accessorKey: 'snapshotCount',
      header: 'Snapshots',
    },
    {
      accessorKey: 'contributorCount',
      header: 'Contributors',
      cell: ({ getValue }) => (getValue() as number | null) ?? '—',
    },
    {
      accessorKey: 'avgCommitSize',
      header: 'Avg Commit Size',
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return v != null ? `${Math.round(v)} lines` : '—';
      },
    },
    {
      accessorKey: 'rampUpWeeks',
      header: 'Ramp-Up (wks)',
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return v != null ? String(Math.round(v)) : '—';
      },
    },
  ];

  const table = useReactTable({
    data: comparisonData ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 pb-12 space-y-8">
      <h1 className="text-3xl font-semibold mt-8">Cross-Org Analysis</h1>

      {/* Aggregation toggle */}
      <AggregationToggle mode={mode} onChange={setMode} />

      {/* Org selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Orgs to Compare</CardTitle>
        </CardHeader>
        <CardContent>
          {orgsLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-6 w-48" />)}
            </div>
          ) : !orgs || orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No orgs available.{' '}
              <a href="#/import" className="text-primary hover:underline">Import data</a> first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {orgs.map(org => (
                <label key={org.id} className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={selectedOrgIds.has(org.id)}
                    onChange={() => toggleOrg(org.id)}
                    className="h-4 w-4 accent-primary"
                    aria-label={`Select ${org.label}`}
                  />
                  <span className="text-sm">{org.label}</span>
                  <span className="text-xs text-muted-foreground">({org.snapshotCount} snapshots)</span>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Empty state */}
      {!hasEnough && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Select at least two orgs to run a comparison.
        </p>
      )}

      {/* Aggregated commit chart */}
      {hasEnough && (
        <Card>
          <CardHeader>
            <CardTitle>Aggregated Cohort Commits</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineCohortChart data={commitMetrics ?? []} metric="avgLinesAdded" aiMarkerDate={null} />
          </CardContent>
        </Card>
      )}

      {/* Aggregated PR chart */}
      {hasEnough && (
        <Card>
          <CardHeader>
            <CardTitle>Aggregated Cohort Pull Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineCohortChart data={prMetrics ?? []} metric="totalCount" aiMarkerDate={null} />
          </CardContent>
        </Card>
      )}

      {/* Aggregated ramp-up */}
      {hasEnough && (
        <Card>
          <CardHeader>
            <CardTitle>Aggregated Ramp-Up Speed</CardTitle>
          </CardHeader>
          <CardContent>
            <InlineRampUpChart data={rampUpData ?? []} />
          </CardContent>
        </Card>
      )}

      {/* Org comparison table */}
      {hasEnough && (
        <Card>
          <CardHeader>
            <CardTitle>Org Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            {comparisonFetching && !comparisonData ? (
              <div className="space-y-2">
                {[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map(headerGroup => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map(header => (
                        <TableHead key={header.id}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={columns.length} className="text-center text-muted-foreground text-sm py-6">
                        No comparison data available.
                      </TableCell>
                    </TableRow>
                  ) : (
                    table.getRowModel().rows.map(row => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map(cell => (
                          <TableCell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
