/**
 * Phase 9.5 (Plan 08): This file was promoted to @shared/components/charts/ so the
 * research tool's OrgDashboard can import it via the existing @shared/* path mapping
 * (no @main/* mapping exists in research tsconfig). The original file location is
 * preserved as a thin re-export shim so Plan 07's DashboardPage import paths and
 * test imports continue to resolve unchanged.
 *
 * For new code, prefer importing directly from '@shared/components/charts/DeveloperMiniChart.js'.
 */
export {
  DeveloperMiniChart,
  type DeveloperMiniChartDatum,
  type DeveloperMiniChartProps,
} from '@shared/components/charts/DeveloperMiniChart.js';
