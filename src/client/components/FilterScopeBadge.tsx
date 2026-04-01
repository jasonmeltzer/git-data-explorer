import { Badge } from '@shared/components/ui/badge';

export interface FilterScopeBadgeProps {
  scope: 'filtered' | 'independent';
}

export function FilterScopeBadge({ scope }: FilterScopeBadgeProps) {
  if (scope === 'filtered') {
    return (
      <Badge className="bg-secondary text-secondary-foreground font-semibold text-xs">
        Filtered
      </Badge>
    );
  }

  return (
    <Badge className="bg-muted text-muted-foreground font-semibold text-xs">
      independent
    </Badge>
  );
}
