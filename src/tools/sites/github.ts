/**
 * GitHub: a site toolset over the public REST API (https://docs.github.com/rest), available on
 * github.com pages. Requests are unauthenticated and cookie-less, so they see public data only
 * and share GitHub's anonymous rate limit (60 requests / hour / IP). The repository defaults to
 * the one open in the current tab.
 */
import type { ToolCallContext, ToolDefinition } from '../../shared/types';
import { defineBackgroundTool, defineToolset } from '../define';
import type { ToolDeps } from '../deps';
import { getJson, getText } from './http';

const API = 'https://api.github.com';
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const RAW = { Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' };

export const isGitHub = (url: URL): boolean => url.hostname === 'github.com';

const RESERVED = new Set([
  'settings', 'orgs', 'organizations', 'marketplace', 'explore', 'topics', 'notifications', 'login', 'logout',
  'signup', 'join', 'about', 'features', 'pricing', 'sponsors', 'search', 'new', 'codespaces', 'issues', 'pulls',
  'trending', 'collections', 'enterprise', 'apps', 'site', 'security', 'customer-stories', 'readme', 'dashboard',
]);
const NAME = /^[A-Za-z0-9_.-]+$/;

/** `owner/repo` from a github.com URL, if it points into a repository. */
export function repoFromUrl(rawUrl: string): string | undefined {
  try {
    const u = new URL(rawUrl);
    if (!isGitHub(u)) return undefined;
    const [owner, repo] = u.pathname.split('/').filter(Boolean);
    if (!owner || !repo || RESERVED.has(owner.toLowerCase()) || !NAME.test(owner) || !NAME.test(repo)) return undefined;
    return `${owner}/${repo.replace(/\.git$/, '')}`;
  } catch {
    return undefined;
  }
}

function resolveRepo(arg: string | undefined, ctx: ToolCallContext): string {
  const repo = (arg ?? repoFromUrl(ctx.tab.url) ?? '').trim();
  const [owner, name, extra] = repo.split('/');
  if (!owner || !name || extra !== undefined || !NAME.test(owner) || !NAME.test(name)) {
    throw new Error(repo ? `"${repo}" is not an owner/repo name.` : 'No repo given and the current tab is not inside a GitHub repository.');
  }
  return `${owner}/${name}`;
}

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + `\n…[truncated, ${s.length - n} more characters]` : s);

interface Repo {
  full_name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  language: string | null;
  license: { spdx_id?: string | null } | null;
  topics?: string[];
  pushed_at: string;
  archived: boolean;
}

interface Issue {
  number: number;
  title: string;
  state: string;
  user: { login: string } | null;
  comments: number;
  created_at: string;
  html_url: string;
  labels: ({ name?: string } | string)[];
  pull_request?: unknown;
}

export function createGitHubTools(deps: Pick<ToolDeps, 'fetch'>): ToolDefinition[] {
  const repoInfo = defineBackgroundTool<{ repo?: string; include_readme?: boolean }>({
    name: 'github_repo_info',
    description: 'Get a public GitHub repository summary (description, stars, language, license, topics) and its README. Defaults to the repo in the current tab.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '"owner/name" (default: the repository open in the current tab).' },
        include_readme: { type: 'boolean', description: 'Include the README text (default true).' },
      },
    },
    run: async (args, ctx) => {
      const repo = resolveRepo(args.repo, ctx);
      const r = await getJson<Repo>(deps.fetch, `${API}/repos/${repo}`, ctx.signal, HEADERS);
      const lines = [
        `# ${r.full_name}${r.archived ? ' (archived)' : ''}`,
        r.description ?? '',
        `${r.stargazers_count} stars, ${r.forks_count} forks, ${r.open_issues_count} open issues+PRs; language ${r.language ?? 'n/a'}; license ${r.license?.spdx_id ?? 'none'}; default branch ${r.default_branch}; last push ${r.pushed_at}`,
        r.topics?.length ? `Topics: ${r.topics.join(', ')}` : '',
        r.homepage ? `Homepage: ${r.homepage}` : '',
        r.html_url,
      ].filter(Boolean);
      if (args.include_readme !== false) {
        const readme = await getText(deps.fetch, `${API}/repos/${repo}/readme`, ctx.signal, RAW).catch(() => '');
        lines.push('', readme ? `README:\n${clip(readme, 8000)}` : '(No README.)');
      }
      return { ok: true, content: lines.join('\n') };
    },
  });

  const listIssues = defineBackgroundTool<{ repo?: string; state?: string; kind?: string; limit?: number }>({
    name: 'github_list_issues',
    description: 'List recent issues and/or pull requests of a public GitHub repository. Defaults to the repo in the current tab.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '"owner/name" (default: current tab).' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Default "open".' },
        kind: { type: 'string', enum: ['issues', 'pulls', 'both'], description: 'Default "both".' },
        limit: { type: 'integer', description: 'Default 20, max 50.' },
      },
    },
    run: async (args, ctx) => {
      const repo = resolveRepo(args.repo, ctx);
      const limit = Math.min(Math.max(args.limit ?? 20, 1), 50);
      const kind = args.kind ?? 'both';
      const params = new URLSearchParams({ state: args.state ?? 'open', per_page: String(kind === 'issues' ? 100 : limit) });
      const path = kind === 'pulls' ? 'pulls' : 'issues';
      const items = await getJson<Issue[]>(deps.fetch, `${API}/repos/${repo}/${path}?${params.toString()}`, ctx.signal, HEADERS);
      const filtered = items.filter((i) => kind !== 'issues' || !i.pull_request).slice(0, limit);
      const lines = filtered.map((i) => {
        const isPr = kind === 'pulls' || i.pull_request !== undefined;
        const labels = (i.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
        return `#${i.number} [${isPr ? 'PR' : 'issue'}, ${i.state}] ${i.title} — ${i.user?.login ?? '?'}, ${i.created_at}${i.comments !== undefined ? `, ${i.comments} comments` : ''}${labels.length ? `, labels: ${labels.join(', ')}` : ''}\n   ${i.html_url}`;
      });
      return { ok: true, content: `${repo}: ${filtered.length} ${kind === 'both' ? 'issues/PRs' : kind}:\n${lines.join('\n') || '(none)'}` };
    },
  });

  const getFile = defineBackgroundTool<{ repo?: string; path: string; ref?: string }>({
    name: 'github_get_file',
    description: 'Read a text file from a public GitHub repository. Defaults to the repo in the current tab and its default branch.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: '"owner/name" (default: current tab).' },
        path: { type: 'string', description: 'File path in the repository, e.g. "src/index.ts".' },
        ref: { type: 'string', description: 'Branch, tag or commit (default: the default branch).' },
      },
      required: ['path'],
    },
    run: async (args, ctx) => {
      const repo = resolveRepo(args.repo, ctx);
      const path = args.path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
      const q = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : '';
      const text = await getText(deps.fetch, `${API}/repos/${repo}/contents/${path}${q}`, ctx.signal, RAW);
      if (text.trimStart().startsWith('[')) {
        // A directory comes back as a JSON array of entries even with the raw media type.
        try {
          const entries = JSON.parse(text) as unknown;
          if (Array.isArray(entries) && entries.length > 0 && entries.every((e) => typeof (e as { name?: unknown }).name === 'string' && typeof (e as { type?: unknown }).type === 'string' && typeof (e as { sha?: unknown }).sha === 'string')) {
            const list = (entries as { name: string; type: string }[]).map((e) => `${e.type === 'dir' ? 'dir ' : 'file'} ${e.name}`);
            return { ok: true, content: `${repo}/${args.path} is a directory:\n${list.join('\n')}` };
          }
        } catch {
          // a file that merely starts with "["
        }
      }
      return { ok: true, content: `${repo}/${args.path}${args.ref ? ` @ ${args.ref}` : ''}:\n${clip(text, 40_000)}` };
    },
  });

  return defineToolset({ id: 'github', matches: isGitHub, tools: [repoInfo, listIssues, getFile] });
}
