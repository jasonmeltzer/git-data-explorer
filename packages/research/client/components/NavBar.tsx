import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';

interface NavBarProps {
  activeRoute: 'import' | 'orgs' | 'org' | 'cross-org';
}

export default function NavBar({ activeRoute }: NavBarProps) {
  const { theme, toggle } = useTheme();

  const linkClass = (route: string) =>
    activeRoute === route
      ? 'px-3 py-1.5 rounded-full bg-muted text-sm font-medium text-foreground'
      : 'px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground';

  return (
    <nav className="h-12 bg-card border-b border-border flex items-center px-4">
      <div className="flex items-center justify-between w-full max-w-5xl mx-auto">
        <span className="text-sm font-semibold text-foreground">
          Research Tool
        </span>
        <div className="flex items-center gap-1">
          <a href="#/import" className={linkClass('import')}>
            Import
          </a>
          <a href="#/orgs" className={linkClass('orgs')}>
            Orgs
          </a>
          <a href="#/cross-org" className={linkClass('cross-org')}>
            Cross-Org
          </a>
        </div>
        <button
          onClick={toggle}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className="p-2 rounded-md text-muted-foreground hover:text-foreground transition-colors"
        >
          {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
      </div>
    </nav>
  );
}
