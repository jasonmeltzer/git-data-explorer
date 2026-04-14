import { flexRender, type Header } from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export function SortableHeader({
  header,
  isRightAligned,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  header: Header<any, any>;
  isRightAligned: boolean;
}) {
  const sorted = header.column.getIsSorted();
  if (!header.column.getCanSort()) {
    return <>{flexRender(header.column.columnDef.header, header.getContext())}</>;
  }
  return (
    <button
      className="flex items-center gap-1 hover:text-foreground transition-colors"
      style={isRightAligned ? { marginLeft: 'auto' } : undefined}
      onClick={header.column.getToggleSortingHandler()}
    >
      {flexRender(header.column.columnDef.header, header.getContext())}
      {sorted === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-50" />
      )}
    </button>
  );
}
