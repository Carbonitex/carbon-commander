/**
 * Hacker News: a worked example of a site toolset. Available only on news.ycombinator.com
 * (`matches`), runs in the background, and uses HN's stable public APIs instead of scraping:
 * the official Firebase API (https://github.com/HackerNews/API) for ranked lists and Algolia's
 * HN Search API (https://hn.algolia.com/api) for search and whole comment trees.
 */
import type { ToolDefinition } from '../../shared/types';
import { defineBackgroundTool, defineToolset } from '../define';
import type { ToolDeps } from '../deps';
import { htmlToText } from '../net';
import { getJson } from './http';

const FIREBASE = 'https://hacker-news.firebaseio.com/v0';
const ALGOLIA = 'https://hn.algolia.com/api/v1';

export const isHackerNews = (url: URL): boolean => url.hostname === 'news.ycombinator.com';

interface FirebaseItem {
  id: number;
  type?: string;
  by?: string;
  time?: number;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  text?: string;
  dead?: boolean;
  deleted?: boolean;
}

interface AlgoliaItem {
  id: number;
  type?: string;
  author?: string | null;
  title?: string | null;
  url?: string | null;
  text?: string | null;
  points?: number | null;
  created_at?: string;
  children?: AlgoliaItem[];
}

interface AlgoliaHit {
  objectID: string;
  title?: string | null;
  url?: string | null;
  author?: string;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string;
  story_title?: string | null;
  story_id?: number | null;
  comment_text?: string | null;
}

const htmlText = (html: string | null | undefined): string => (html ? htmlToText(html).text : '');
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const itemUrl = (id: number | string): string => `https://news.ycombinator.com/item?id=${id}`;

/** `item?id=123` on the current tab, if any. */
export function itemIdFromUrl(rawUrl: string): number | undefined {
  try {
    const u = new URL(rawUrl);
    const id = Number(u.searchParams.get('id'));
    return isHackerNews(u) && u.pathname === '/item' && Number.isInteger(id) && id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export function createHackerNewsTools(deps: Pick<ToolDeps, 'fetch'>): ToolDefinition[] {
  const listStories = defineBackgroundTool<{ list?: string; limit?: number; offset?: number }>({
    name: 'hn_list_stories',
    description: 'List Hacker News stories from a ranked list (top, new, best, ask, show, job) with score, author, comment count and links.',
    parameters: {
      type: 'object',
      properties: {
        list: { type: 'string', enum: ['top', 'new', 'best', 'ask', 'show', 'job'], description: 'Which list (default "top").' },
        limit: { type: 'integer', description: 'How many stories (default 15, max 30).' },
        offset: { type: 'integer', description: 'Skip this many stories (default 0).' },
      },
    },
    run: async (args, ctx) => {
      const list = args.list ?? 'top';
      const limit = Math.min(Math.max(args.limit ?? 15, 1), 30);
      const offset = Math.max(args.offset ?? 0, 0);
      const ids = await getJson<number[]>(deps.fetch, `${FIREBASE}/${list}stories.json`, ctx.signal);
      const page = ids.slice(offset, offset + limit);
      const items = await Promise.all(page.map((id) => getJson<FirebaseItem | null>(deps.fetch, `${FIREBASE}/item/${id}.json`, ctx.signal).catch(() => null)));
      const lines = items.flatMap((it, i) => {
        if (!it || it.deleted || it.dead) return [];
        const meta = [it.score !== undefined && `${it.score} points`, it.by && `by ${it.by}`, it.descendants !== undefined && `${it.descendants} comments`].filter(Boolean).join(', ');
        return [`${offset + i + 1}. ${it.title ?? '(untitled)'}${it.url ? ` <${it.url}>` : ''}\n   ${meta} — id ${it.id} ${itemUrl(it.id)}`];
      });
      return {
        ok: true,
        content: `Hacker News ${list} stories ${offset + 1}-${offset + page.length} of ${ids.length}:\n${lines.join('\n')}`,
        data: items.filter(Boolean),
      };
    },
  });

  const getItem = defineBackgroundTool<{ id?: number; max_comments?: number; max_depth?: number }>({
    name: 'hn_get_item',
    description:
      'Read a Hacker News story (or comment) with its comment tree. Defaults to the item open in the current tab.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Item id (default: the item in the current tab URL).' },
        max_comments: { type: 'integer', description: 'Maximum comments to include (default 60, max 300).' },
        max_depth: { type: 'integer', description: 'Maximum reply depth (default 4).' },
      },
    },
    run: async (args, ctx) => {
      const id = args.id ?? itemIdFromUrl(ctx.tab.url);
      if (!id) return { ok: false, content: 'No item id given and the current tab is not a Hacker News item page.' };
      const maxComments = Math.min(Math.max(args.max_comments ?? 60, 0), 300);
      const maxDepth = Math.min(Math.max(args.max_depth ?? 4, 1), 20);
      const item = await getJson<AlgoliaItem>(deps.fetch, `${ALGOLIA}/items/${id}`, ctx.signal);

      const lines: string[] = [];
      let shown = 0;
      let total = 0;
      const walk = (children: AlgoliaItem[] | undefined, depth: number): void => {
        for (const c of children ?? []) {
          total++;
          if (shown < maxComments && depth <= maxDepth && c.author) {
            shown++;
            const pad = '  '.repeat(depth - 1);
            lines.push(`${pad}- ${c.author} (id ${c.id}): ${clip(htmlText(c.text).replace(/\n+/g, ' '), 1500)}`);
          }
          walk(c.children, depth + 1);
        }
      };
      walk(item.children, 1);
      const head = [
        item.title ? `# ${item.title}` : `Item ${item.id} (${item.type ?? 'item'})`,
        item.url && `Link: ${item.url}`,
        [item.points != null && `${item.points} points`, item.author && `by ${item.author}`, item.created_at && `at ${item.created_at}`].filter(Boolean).join(', '),
        `HN: ${itemUrl(item.id)}`,
        item.text && `\n${htmlText(item.text)}`,
      ].filter(Boolean);
      const tail = total > shown ? `\n[Showing ${shown} of ${total} comments; raise max_comments / max_depth for more.]` : '';
      return { ok: true, content: `${head.join('\n')}\n\nComments:\n${lines.join('\n') || '(none)'}${tail}` };
    },
  });

  const search = defineBackgroundTool<{ query: string; type?: string; sort?: string; limit?: number }>({
    name: 'hn_search',
    description: 'Search Hacker News stories or comments (Algolia HN Search).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms.' },
        type: { type: 'string', enum: ['story', 'comment', 'ask_hn', 'show_hn', 'all'], description: 'What to search (default "story").' },
        sort: { type: 'string', enum: ['relevance', 'date'], description: 'Order (default "relevance").' },
        limit: { type: 'integer', description: 'Results (default 15, max 50).' },
      },
      required: ['query'],
    },
    run: async (args, ctx) => {
      const params = new URLSearchParams({ query: args.query, hitsPerPage: String(Math.min(Math.max(args.limit ?? 15, 1), 50)) });
      const type = args.type ?? 'story';
      if (type !== 'all') params.set('tags', type);
      const endpoint = args.sort === 'date' ? 'search_by_date' : 'search';
      const res = await getJson<{ hits: AlgoliaHit[]; nbHits?: number }>(deps.fetch, `${ALGOLIA}/${endpoint}?${params.toString()}`, ctx.signal);
      const lines = res.hits.map((h, i) => {
        if (h.comment_text) {
          return `${i + 1}. Comment by ${h.author ?? '?'} on "${h.story_title ?? '?'}" (${h.created_at ?? ''}): ${clip(htmlText(h.comment_text).replace(/\n+/g, ' '), 400)}\n   ${itemUrl(h.objectID)}`;
        }
        const meta = [h.points != null && `${h.points} points`, h.author && `by ${h.author}`, h.num_comments != null && `${h.num_comments} comments`, h.created_at].filter(Boolean).join(', ');
        return `${i + 1}. ${h.title ?? '(untitled)'}${h.url ? ` <${h.url}>` : ''}\n   ${meta} — ${itemUrl(h.objectID)}`;
      });
      return { ok: true, content: `${res.nbHits ?? res.hits.length} results for "${args.query}":\n${lines.join('\n') || '(none)'}` };
    },
  });

  return defineToolset({ id: 'hackernews', matches: isHackerNews, tools: [listStories, getItem, search] });
}
