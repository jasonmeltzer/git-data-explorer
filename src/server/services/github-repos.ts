import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

const ThrottledOctokit = Octokit.plugin(throttling);
type OctokitInstance = InstanceType<typeof ThrottledOctokit>;

/**
 * List all repos accessible to the authenticated user.
 * Uses pagination to fetch all repos sorted by most recently updated.
 */
export async function listAllRepos(octokit: OctokitInstance) {
  return octokit.paginate(
    octokit.rest.repos.listForAuthenticatedUser,
    { per_page: 100, sort: 'updated', direction: 'desc' },
    (response) => response.data
  );
}

/**
 * Get the GitHub login of the authenticated user.
 */
export async function getAuthenticatedLogin(octokit: OctokitInstance): Promise<string> {
  const { data } = await octokit.rest.users.getAuthenticated();
  return data.login;
}
