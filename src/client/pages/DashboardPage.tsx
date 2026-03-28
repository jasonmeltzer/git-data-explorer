import { useDashboardFilters } from '../hooks/useDashboardFilters.js';
import { ContributorTable } from '../components/ContributorTable.js';

export default function DashboardPage() {
  const { startDate, endDate, tenureMode, repoIds } = useDashboardFilters();

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground mt-2">
        Chart sections will be added in the next phase.
      </p>

      {/* Contributor Patterns — collapsed by default (per D-15) */}
      <section>
        <ContributorTable
          startDate={startDate}
          endDate={endDate}
          tenureMode={tenureMode}
          repoIds={repoIds}
        />
      </section>
    </div>
  );
}
