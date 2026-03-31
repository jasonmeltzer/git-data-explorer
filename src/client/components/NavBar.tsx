import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';

interface NavBarProps {
  activePage: 'dashboard' | 'landing' | 'repos' | 'collection' | 'settings';
}

export default function NavBar({ activePage }: NavBarProps) {
  const { theme, toggle } = useTheme();

  const linkClass = (page: 'dashboard' | 'repos' | 'collection' | 'settings') =>
    activePage === page
      ? 'px-3 py-1.5 rounded-full bg-muted text-sm font-medium text-foreground'
      : 'px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground';

  return (
    <nav className="h-12 bg-card border-b border-border flex items-center px-4">
      <div className="flex items-center justify-between w-full max-w-5xl mx-auto">
        <a
          href="#/dashboard"
          className="text-sm font-semibold text-foreground hover:text-foreground"
        >
          Git Data Explorer
        </a>
        <div className="flex items-center gap-1">
          <a href="#/dashboard" className={linkClass('dashboard')}>
            Dashboard
          </a>
          <a href="#/repos" className={linkClass('repos')}>
            Repos
          </a>
          <a href="#/collection" className={linkClass('collection')}>
            Collection
          </a>
          <a href="#/settings" className={linkClass('settings')}>
            Settings
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
