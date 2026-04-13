import { FilterScopeBadge } from './FilterScopeBadge.js';

export interface SectionHeaderProps {
  title: string;
  scope: 'filtered' | 'independent';
}

export function SectionHeader({ title, scope }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      <FilterScopeBadge scope={scope} />
    </div>
  );
}
