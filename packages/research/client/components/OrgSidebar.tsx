import { Skeleton } from '@shared/components/ui/skeleton.js';
import { Badge } from '@shared/components/ui/badge.js';
import { ScrollArea } from '@shared/components/ui/scroll-area.js';
import { useOrgs } from '../hooks/useOrgs.js';

interface OrgSidebarProps {
  activeOrgId: number | null;
}

export default function OrgSidebar({ activeOrgId }: OrgSidebarProps) {
  const { data: orgs, isLoading } = useOrgs();

  if (isLoading) {
    return (
      <aside className="w-60 shrink-0 border-r border-border h-full min-h-screen p-4 space-y-2">
        {[0, 1, 2].map(i => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </aside>
    );
  }

  if (!orgs || orgs.length === 0) {
    return (
      <aside className="w-60 shrink-0 border-r border-border h-full min-h-screen p-4">
        <p className="text-sm text-muted-foreground">
          No data yet. Import a bundle to get started.
        </p>
        <a
          href="#/import"
          className="mt-4 block text-sm text-primary hover:underline"
        >
          Import more data
        </a>
      </aside>
    );
  }

  return (
    <aside className="w-60 shrink-0 border-r border-border min-h-screen flex flex-col">
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {orgs.map(org => {
            const isActive = org.id === activeOrgId;
            return (
              <a
                key={org.id}
                href={`#/org/${org.id}`}
                className={`flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 border-l-2 border-primary pl-[calc(0.75rem-2px)]'
                    : 'hover:bg-muted'
                }`}
              >
                <span className="font-semibold text-base truncate">{org.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground capitalize">{org.importSource}</span>
                  <Badge variant="outline" className="text-xs h-4 px-1.5">
                    {org.snapshotCount} snapshot{org.snapshotCount !== 1 ? 's' : ''}
                  </Badge>
                </div>
              </a>
            );
          })}
        </div>
      </ScrollArea>
      <div className="px-3 pb-4 pt-2 border-t border-border">
        <a
          href="#/import"
          className="text-sm text-primary hover:underline"
        >
          Import more data
        </a>
      </div>
    </aside>
  );
}
