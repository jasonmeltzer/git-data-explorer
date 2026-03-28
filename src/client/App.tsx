import { useState, useEffect } from 'react';
import LandingPage from './pages/LandingPage.js';
import SettingsPage from './pages/SettingsPage.js';
import ReposPage from './pages/ReposPage.js';
import DashboardPage from './pages/DashboardPage.js';
import NavBar from './components/NavBar.js';

type Page = 'dashboard' | 'landing' | 'repos' | 'settings';

function getPageFromHash(): Page {
  const hash = window.location.hash;
  if (hash === '#/settings') return 'settings';
  if (hash === '#/repos') return 'repos';
  if (hash === '#/landing') return 'landing';
  if (hash === '#/dashboard') return 'dashboard';
  return 'dashboard';
}

export default function App() {
  const [page, setPage] = useState<Page>(getPageFromHash);

  useEffect(() => {
    const handleHash = () => {
      setPage(getPageFromHash());
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigate = (to: Page) => {
    if (to === 'settings') {
      window.location.hash = '#/settings';
    } else if (to === 'repos') {
      window.location.hash = '#/repos';
    } else if (to === 'landing') {
      window.location.hash = '#/landing';
    } else {
      window.location.hash = '#/dashboard';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar activePage={page} />
      <main>
        {page === 'dashboard' && (
          <DashboardPage />
        )}
        {page === 'repos' && (
          <ReposPage />
        )}
        {page === 'settings' && (
          <SettingsPage
            onNavigateRepos={() => navigate('repos')}
          />
        )}
        {page === 'landing' && (
          <LandingPage
            onNavigateSettings={() => navigate('settings')}
            onNavigateRepos={() => navigate('repos')}
          />
        )}
      </main>
    </div>
  );
}
