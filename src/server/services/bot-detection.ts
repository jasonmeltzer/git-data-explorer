export const KNOWN_BOTS = new Set([
  'dependabot', 'dependabot[bot]',
  'renovate', 'renovate[bot]',
  'github-actions', 'github-actions[bot]',
  'codecov', 'codecov[bot]',
  'snyk-bot', 'greenkeeper[bot]',
  'allcontributors[bot]', 'semantic-release-bot',
  'stale[bot]', 'mergify[bot]',
  'imgbot[bot]', 'whitesource-bolt-for-github[bot]',
  'depfu[bot]', 'mend-bolt-for-github[bot]',
]);

export function isBot(login: string, userType?: string | null): boolean {
  if (userType === 'Bot') return true;
  if (login.endsWith('[bot]')) return true;
  return KNOWN_BOTS.has(login.toLowerCase());
}
