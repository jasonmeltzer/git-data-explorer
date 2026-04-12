import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
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
            ) : !comparisonData || comparisonData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No comparison data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium">Label</th>
                      <th className="text-left py-2 px-3 font-medium">Size</th>
                      <th className="text-right py-2 px-3 font-medium">Snapshots</th>
                      <th className="text-right py-2 px-3 font-medium">Contributors</th>
                      <th className="text-right py-2 px-3 font-medium">Avg Commit Size</th>
                      <th className="text-right py-2 px-3 font-medium">Ramp-Up (wks)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonData.map(row => (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 px-3 font-medium">{row.label}</td>
                        <td className="py-2 px-3 text-muted-foreground">{row.sizeCategory ?? '—'}</td>
                        <td className="py-2 px-3 text-right">{row.snapshotCount}</td>
                        <td className="py-2 px-3 text-right">{row.contributorCount ?? '—'}</td>
                        <td className="py-2 px-3 text-right">{row.avgCommitSize != null ? `${Math.round(row.avgCommitSize)} lines` : '—'}</td>
                        <td className="py-2 px-3 text-right">{row.rampUpWeeks != null ? Math.round(row.rampUpWeeks) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
