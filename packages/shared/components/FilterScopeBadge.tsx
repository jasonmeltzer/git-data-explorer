import { Badge } from '@shared/components/ui/badge.js';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@shared/components/ui/tooltip.js';

export interface FilterScopeBadgeProps {
  scope: 'filtered' | 'independent';
}

export function FilterScopeBadge({ scope }: FilterScopeBadgeProps) {
  const label = scope === 'filtered' ? 'Filtered' : 'All Data';
  const description = scope === 'filtered'
    ? 'Respects date range and repo filters from the filter bar above'
    : 'Uses all available data regardless of filter bar settings';
  const badgeClass = scope === 'filtered'
    ? 'bg-secondary text-secondary-foreground font-semibold text-xs cursor-help'
    : 'bg-muted text-muted-foreground font-semibold text-xs cursor-help';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={badgeClass}>{label}</Badge>
        </TooltipTrigger>
        <TooltipContent side="left">{description}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
