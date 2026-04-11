import { useState } from 'react';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Badge } from '@shared/components/ui/badge.js';
import { Button } from '@shared/components/ui/button.js';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shared/components/ui/alert-dialog.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shared/components/ui/table.js';
import type { Snapshot } from '../hooks/useOrgs.js';
import { useDeleteSnapshot } from '../hooks/useOrgs.js';

interface SnapshotHistoryProps {
  orgId: number;
  orgLabel: string;
  snapshots: Snapshot[];
  activeSnapshotId: number | null;
  onSelectSnapshot: (snapshotId: number) => void;
}

export default function SnapshotHistory({
  orgId,
  orgLabel,
  snapshots,
  activeSnapshotId,
  onSelectSnapshot,
}: SnapshotHistoryProps) {
  const deleteSnapshot = useDeleteSnapshot();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (snapshotId: number) => {
    setDeletingId(snapshotId);
    await deleteSnapshot.mutateAsync({ orgId, snapshotId }).catch(() => null);
    setDeletingId(null);
    if (activeSnapshotId === snapshotId && snapshots.length > 1) {
      const next = snapshots.find(s => s.id !== snapshotId);
      if (next) onSelectSnapshot(next.id);
    }
  };

  if (snapshots.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">No snapshots yet.</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Imported</TableHead>
          <TableHead>Date Range</TableHead>
          <TableHead>Contributors</TableHead>
          <TableHead>Repos</TableHead>
          <TableHead className="w-8"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {snapshots.map(snapshot => {
          const isActive = snapshot.id === activeSnapshotId;
          const importedAt = snapshot.importedAt
            ? format(new Date(snapshot.importedAt), 'MMM d, yyyy')
            : '—';
          const dateRange =
            snapshot.startDate && snapshot.endDate
              ? `${format(new Date(snapshot.startDate), 'MMM yyyy')} – ${format(new Date(snapshot.endDate), 'MMM yyyy')}`
              : '—';

          return (
            <TableRow
              key={snapshot.id}
              className={`cursor-pointer ${isActive ? 'bg-primary/5' : 'hover:bg-muted/50'}`}
              onClick={() => onSelectSnapshot(snapshot.id)}
            >
              <TableCell>
                <div className="flex items-center gap-2">
                  <span>{importedAt}</span>
                  <Badge variant="outline" className="text-xs h-4 px-1.5 text-muted-foreground">
                    Imported
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="text-sm">{dateRange}</TableCell>
              <TableCell className="text-sm">{snapshot.contributorCount ?? '—'}</TableCell>
              <TableCell className="text-sm">{snapshot.repoCount ?? '—'}</TableCell>
              <TableCell>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={e => e.stopPropagation()}
                      aria-label={`Remove snapshot from ${importedAt}`}
                      disabled={deletingId === snapshot.id}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove snapshot?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes the {importedAt} snapshot from{' '}
                        <span className="font-medium">{orgLabel}</span>. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel onClick={e => e.stopPropagation()}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={e => {
                          e.stopPropagation();
                          handleDelete(snapshot.id);
                        }}
                      >
                        Remove
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
