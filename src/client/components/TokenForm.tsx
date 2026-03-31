import { useState, useEffect } from 'react';
import { Button } from '@shared/components/ui/button';

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

interface TokenFormProps {
  onTokenSaved?: () => void;
}

export default function TokenForm({ onTokenSaved }: TokenFormProps) {
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
        if (onTokenSaved) onTokenSaved();
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setSaving(false);
    }
  };

  // Per D-06: Show required scopes guidance near the input
  const scopeGuidance = (
    <div className="mt-3 rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Required PAT scopes:</p>
      <ul className="mt-1 list-disc list-inside space-y-0.5">
        <li><code className="bg-background px-1 rounded border border-border">repo</code> -- for private repositories</li>
        <li><code className="bg-background px-1 rounded border border-border">public_repo</code> -- if tracking only public repos</li>
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
    return <p className="text-muted-foreground">Loading token status...</p>;
  }

  // Per D-05: If token is configured and not editing, show masked token + Change button
  if (status.configured && !isEditing) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Current token:</p>
            <p className="font-mono text-sm text-foreground mt-1">{status.maskedToken}</p>
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="rounded-md bg-card px-3 py-1.5 text-sm font-medium text-foreground shadow-sm ring-1 ring-inset ring-border hover:bg-muted"
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
      <label htmlFor="github-token" className="block text-sm font-medium text-foreground">
        Personal Access Token
      </label>
      <input
        id="github-token"
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        className="mt-1 block w-full rounded-md border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        autoComplete="off"
      />

      {scopeGuidance}

      {error && (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={saving || !token.trim()}
        >
          {saving ? 'Validating...' : 'Save Token'}
        </Button>
        {isEditing && (
          <button
            onClick={() => { setIsEditing(false); setToken(''); setError(null); }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
