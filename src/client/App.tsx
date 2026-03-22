import { useState, useEffect } from 'react';
import LandingPage from './pages/LandingPage.js';
import SettingsPage from './pages/SettingsPage.js';
import ReposPage from './pages/ReposPage.js';
import NavBar from './components/NavBar.js';

type Page = 'landing' | 'repos' | 'settings';

function getPageFromHash(): Page {
  const hash = window.location.hash;
  if (hash === '#/settings') return 'settings';
  if (hash === '#/repos') return 'repos';
  return 'landing';
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
    } else {
      window.location.hash = '#/';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar activePage={page} />
      <main>
        {page === 'repos' && (
          <ReposPage />
        )}
        {page === 'settings' && (
          <SettingsPage
            onBack={() => navigate('landing')}
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
