interface NavBarProps {
  activePage: 'dashboard' | 'landing' | 'repos' | 'settings';
}

export default function NavBar({ activePage }: NavBarProps) {
  const linkClass = (page: 'dashboard' | 'repos' | 'settings') =>
    activePage === page
      ? 'px-3 py-1.5 rounded-full bg-gray-100 text-sm font-medium text-gray-900'
      : 'px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900';

  return (
    <nav className="h-12 bg-white border-b border-gray-200 flex items-center px-4">
      <div className="flex items-center justify-between w-full max-w-5xl mx-auto">
        <a
          href="#/dashboard"
          className="text-sm font-semibold text-gray-900 hover:text-gray-700"
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
          <a href="#/settings" className={linkClass('settings')}>
            Settings
          </a>
        </div>
      </div>
    </nav>
  );
}
