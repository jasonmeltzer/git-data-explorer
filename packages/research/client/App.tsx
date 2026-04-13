import { useState, useEffect } from 'react';
import NavBar from './components/NavBar.js';
import ImportPage from './pages/ImportPage.js';
import OrgDashboard from './pages/OrgDashboard.js';
import OrgsListPage from './pages/OrgsListPage.js';
import CrossOrgPage from './pages/CrossOrgPage.js';

type Route =
  | { type: 'import' }
  | { type: 'orgs' }
  | { type: 'org'; orgId: number }
  | { type: 'cross-org' };

function getRouteFromHash(): Route {
  const hash = window.location.hash;
  if (hash === '#/orgs') return { type: 'orgs' };
  if (hash.startsWith('#/org/')) {
    const orgId = parseInt(hash.slice('#/org/'.length), 10);
    if (!isNaN(orgId)) return { type: 'org', orgId };
    return { type: 'orgs' };
  }
  if (hash === '#/cross-org') return { type: 'cross-org' };
  return { type: 'import' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(getRouteFromHash);

  useEffect(() => {
    const handleHash = () => setRoute(getRouteFromHash());
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar activeRoute={route.type} />
      <main>
        {route.type === 'import' && <ImportPage />}
        {route.type === 'orgs' && <OrgsListPage />}
        {route.type === 'org' && <OrgDashboard orgId={route.orgId} />}
        {route.type === 'cross-org' && <CrossOrgPage />}
      </main>
    </div>
  );
}
