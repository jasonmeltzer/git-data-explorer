import TokenForm from '../components/TokenForm.js';

interface Props {
  onBack: () => void;
  onNavigateRepos: () => void;
}

export default function SettingsPage({ onNavigateRepos }: Props) {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Settings</h1>
        <p className="text-gray-600 mb-8">Configure your GitHub connection.</p>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">GitHub Personal Access Token</h2>
          <TokenForm onTokenSaved={onNavigateRepos} />
        </div>
      </div>
    </div>
  );
}
