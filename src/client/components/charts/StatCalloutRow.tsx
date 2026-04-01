import type { ReactNode } from 'react';

export interface StatCalloutRowProps {
  children: ReactNode;
}

export function StatCalloutRow({ children }: StatCalloutRowProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {children}
    </div>
  );
}
