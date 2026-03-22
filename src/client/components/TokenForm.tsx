import { useState, useEffect } from 'react';

interface TokenStatus {
  configured: boolean;
  maskedToken: string | null;
}

interface SaveResult {
  success: boolean;
  error?: string;
  maskedToken?: string;
  scopes?: string[];
  login?: string;
}

export default function TokenForm() {
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SaveResult | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    fetch('/api/settings/token')
      .then(r => r.json())
      .then((data: TokenStatus) => setStatus(data))
      .catch(() => setStatus({ configured: false, maskedToken: null }));
  }, []);

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const res = await fetch('/api/settings/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data: SaveResult = await res.json();

      if (!data.success) {
        setError(data.error ?? 'Failed to save token');
      } else {
        setSuccess(data);
        setStatus({ configured: true, maskedToken: data.maskedToken ?? null });
        setToken('');
        setIsEditing(false);
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setSaving(false);
    }
  };

  // Per D-06: Show required scopes guidance near the input
  const scopeGuidance = (
    <div className="mt-3 rounded-md bg-blue-50 p-3 text-sm text-blue-800">
      <p className="font-medium">Required PAT scopes:</p>
      <ul className="mt-1 list-disc list-inside space-y-0.5">
        <li><code className="bg-blue-100 px-1 rounded">repo</code> -- for private repositories</li>
        <li><code className="bg-blue-100 px-1 rounded">public_repo</code> -- if tracking only public repos</li>
      </ul>
      <p className="mt-2">
        <a
          href="https://github.com/settings/tokens"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-blue-900"
        >
          Create a token on GitHub &rarr;
        </a>
      </p>
    </div>
  );

  if (status === null) {
    return <p className="text-gray-400">Loading token status...</p>;
  }

  // Per D-05: If token is configured and not editing, show masked token + Change button
  if (status.configured && !isEditing) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Current token:</p>
            <p className="font-mono text-sm text-gray-800 mt-1">{status.maskedToken}</p>
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            Change
          </button>
        </div>
        {success && success.login && (
          <p className="mt-3 text-sm text-green-700">
            Authenticated as <strong>{success.login}</strong>
            {success.scopes && success.scopes.length > 0 && (
              <> (scopes: {success.scopes.join(', ')})</>
            )}
          </p>
        )}
      </div>
    );
  }

  // Token entry form (shown on first launch or when editing)
  return (
    <div>
      <label htmlFor="github-token" className="block text-sm font-medium text-gray-700">
        Personal Access Token
      </label>
      <input
        id="github-token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
        autoComplete="off"
      />

      {scopeGuidance}

      {error && (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !token.trim()}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Validating...' : 'Save Token'}
        </button>
        {isEditing && (
          <button
            onClick={() => { setIsEditing(false); setToken(''); setError(null); }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
