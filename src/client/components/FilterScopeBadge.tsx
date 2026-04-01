import { Badge } from '@shared/components/ui/badge';

export interface FilterScopeBadgeProps {
  scope: 'filtered' | 'independent';
}

export function FilterScopeBadge({ scope }: FilterScopeBadgeProps) {
  if (scope === 'filtered') {
    return (
      <Badge
        className="bg-secondary text-secondary-foreground font-semibold text-xs cursor-help"
        title="Respects date range and repo filters from the filter bar above"
      >
        Filtered
      </Badge>
    );
  }

  return (
    <Badge
      className="bg-muted text-muted-foreground font-semibold text-xs cursor-help"
      title="Uses all available data regardless of filter bar settings"
    >
      All Data
    </Badge>
  );
}
