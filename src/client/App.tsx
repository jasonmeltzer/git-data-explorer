import { useState, useEffect } from 'react';
import LandingPage from './pages/LandingPage.js';
import SettingsPage from './pages/SettingsPage.js';

type Page = 'landing' | 'settings';

export default function App() {
  const [page, setPage] = useState<Page>(() => {
    return window.location.hash === '#/settings' ? 'settings' : 'landing';
  });

  useEffect(() => {
    const handleHash = () => {
      setPage(window.location.hash === '#/settings' ? 'settings' : 'landing');
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigate = (to: Page) => {
    window.location.hash = to === 'settings' ? '#/settings' : '#/';
  };

  if (page === 'settings') {
    return <SettingsPage onBack={() => navigate('landing')} />;
  }
  return <LandingPage onNavigateSettings={() => navigate('settings')} />;
}
