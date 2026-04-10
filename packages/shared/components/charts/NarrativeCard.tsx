import { Card, CardContent } from '@shared/components/ui/card';
import { Skeleton } from '@shared/components/ui/skeleton';

interface NarrativeCardProps {
  text: string;
  isFetching?: boolean;
}

export default function NarrativeCard({ text, isFetching }: NarrativeCardProps) {
  if (isFetching) {
    return (
      <Card className="bg-muted/50 mb-4">
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-4 w-[60%]" />
          <Skeleton className="h-4 w-[40%]" />
        </CardContent>
      </Card>
    );
  }

  if (!text) return null;

  return (
    <Card className="bg-muted/50 mb-4">
      <CardContent className="p-4">
        <p className="text-sm text-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}
