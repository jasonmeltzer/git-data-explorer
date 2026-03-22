interface NavBarProps {
  activePage: 'landing' | 'repos' | 'settings';
}

export default function NavBar({ activePage }: NavBarProps) {
  const linkClass = (page: 'repos' | 'settings') =>
    activePage === page
      ? 'px-3 py-1.5 rounded-full bg-gray-100 text-sm font-medium text-gray-900'
      : 'px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900';

  return (
    <nav className="h-12 bg-white border-b border-gray-200 flex items-center px-4">
      <div className="flex items-center justify-between w-full max-w-5xl mx-auto">
        <a
          href="#/"
          className="text-sm font-semibold text-gray-900 hover:text-gray-700"
        >
          Git Data Explorer
        </a>
        <div className="flex items-center gap-1">
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
