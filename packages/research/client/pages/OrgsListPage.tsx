import { ChevronRight } from 'lucide-react';
import { Card, CardContent } from '@shared/components/ui/card.js';
import { Badge } from '@shared/components/ui/badge.js';
import { Skeleton } from '@shared/components/ui/skeleton.js';
import { useOrgs } from '../hooks/useOrgs.js';

export default function OrgsListPage() {
  const { data: orgs, isLoading } = useOrgs();

  return (
    <div className="max-w-4xl mx-auto px-6 pb-16">
      <div className="pt-12 pb-8">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">Organizations</h1>
        <p className="text-muted-foreground mt-2">
          Imported data bundles, organized by source.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      )}

      {!isLoading && (!orgs || orgs.length === 0) && (
        <p className="text-sm text-muted-foreground">
          No organizations yet.{' '}
          <a href="#/import" className="text-primary hover:underline">Import a bundle</a> to get started.
        </p>
      )}

      {orgs && orgs.length > 0 && (
        <div className="space-y-3">
          {orgs.map(org => (
            <a key={org.id} href={`#/org/${org.id}`} className="block">
              <Card className="hover:bg-muted/40 hover:border-primary/30 transition-colors cursor-pointer">
                <CardContent className="flex items-center justify-between py-4 px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{org.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 capitalize">{org.importSource}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    <Badge variant="outline" className="text-xs">
                      {org.snapshotCount} snapshot{org.snapshotCount !== 1 ? 's' : ''}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
