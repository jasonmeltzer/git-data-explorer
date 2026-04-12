import { useQuery } from '@tanstack/react-query';
import type { CohortMetricsRow, RampUpBucket } from '@shared/types.js';

export type AggregationMode = 'weighted' | 'normalized';

export interface OrgComparisonRow {
  id: number;
  label: string;
  sizeCategory: string | null;
  snapshotCount: number;
  contributorCount: number | null;
  repoCount: number | null;
  aiMarkerDate: string | null;
  avgCommitSize: number | null;
  rampUpWeeks: number | null;
}

function buildOrgIdsParam(orgIds: number[]) {
  return orgIds.join(',');
}

export function useCrossOrgCohortMetrics(
  mode: AggregationMode,
  orgIds: number[],
  metricType: 'commits' | 'prs' = 'commits'
) {
  return useQuery<CohortMetricsRow[]>({
    queryKey: ['cross-org-cohort-metrics', mode, orgIds, metricType],
    queryFn: () => {
      const params = new URLSearchParams({
        mode,
        orgIds: buildOrgIdsParam(orgIds),
        metricType,
      });
      return fetch(`/api/analytics/cross-org/cohort-metrics?${params}`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },
    enabled: orgIds.length >= 2,
  });
}

export function useCrossOrgRampUp(mode: AggregationMode, orgIds: number[]) {
  return useQuery<RampUpBucket[]>({
    queryKey: ['cross-org-ramp-up', mode, orgIds],
    queryFn: () => {
      const params = new URLSearchParams({
        mode,
        orgIds: buildOrgIdsParam(orgIds),
      });
      return fetch(`/api/analytics/cross-org/ramp-up?${params}`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },
    enabled: orgIds.length >= 2,
  });
}

export function useOrgComparison(orgIds: number[]) {
  return useQuery<OrgComparisonRow[]>({
    queryKey: ['org-comparison', orgIds],
    queryFn: () => {
      const params = new URLSearchParams({
        orgIds: buildOrgIdsParam(orgIds),
      });
      return fetch(`/api/analytics/cross-org/comparison?${params}`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },
    enabled: orgIds.length >= 2,
  });
}
