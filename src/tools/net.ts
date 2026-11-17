/**
 * Network helpers for background tools: URL / host checks, fetch with timeout + size cap, and
 * HTML -> readable text without a DOM (service workers have no `DOMParser`).
 */
import { CcError } from '../shared/types';

/** Parse an http(s) URL (optionally relative to `base`), or throw `CcError('invalid')`. */
export function parseHttpUrl(raw: string, base?: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    throw new CcError('invalid', `Not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CcError('invalid', `Only http and https URLs are allowed (got ${url.protocol}).`);
  }
  if (url.username || url.password) throw new CcError('invalid', 'URLs with embedded credentials are not allowed.');
  return url;
}

const PRIVATE_SUFFIXES = ['.localhost', '.local', '.lan', '.home', '.internal', '.intranet', '.corp', '.localdomain', '.home.arpa', '.private'];

/**
 * Public DNS names that resolve to an address written into the name (`10.1.2.3.nip.io`,
 * `10-1-2-3.sslip.io`, ...) or always to loopback (`lvh.me`, `localtest.me`, ...). Refused as a
 * whole: there is no legitimate reason for the model to fetch them, and they are the common way to
 * aim a hostname check at a private address.
 */
const LOOPBACK_OR_WILDCARD_IP_DOMAINS = [
  'nip.io', 'sslip.io', 'xip.io', 'traefik.me', 'localtest.me', 'lvh.me', 'vcap.me', 'localhost.direct',
];

function privateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && Number(m[3]) === 0) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

function privateIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h.startsWith('::')) return true; // ::, ::1, IPv4-mapped / -compatible (::ffff:7f00:1)
  if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true; // fe80::/10 link-local
  if (h.startsWith('ff')) return true; // multicast
  if (h.startsWith('64:ff9b:')) return true; // NAT64, may embed a private IPv4
  return false;
}

/**
 * Why `url`'s host must not be fetched by the model, or null when it looks public.
 *
 * This is a hostname check only. It refuses: `localhost` and `*.localhost`; private, loopback,
 * link-local, CGNAT, multicast and reserved IPv4 literals in any notation the URL parser
 * normalises (`0x7f.1`, `2130706433`, ...); loopback / unspecified / IPv4-mapped / ULA /
 * link-local / multicast / NAT64 IPv6 literals; single-label and `.local`-style intranet names;
 * well-known wildcard / loopback DNS services (`nip.io`, `sslip.io`, `lvh.me`, ...); and names that
 * embed a private IPv4 address (`10.1.2.3.example.com`, `10-1-2-3.example.com`).
 *
 * It cannot see DNS: any other public name that resolves to a private address (DNS rebinding, a
 * custom wildcard domain) passes. Extensions have no DNS API to close that gap. `fetch_url` does
 * not follow redirects (so a public URL cannot bounce the request to a private host), sends no
 * cookies, and asks the user before every request.
 */
export function blockedHostReason(url: URL): string | null {
  let host = url.hostname.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.startsWith('[') && host.endsWith(']')) {
    return privateIpv6(host.slice(1, -1)) ? `${host} is a loopback, link-local or private IPv6 address` : null;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return `${host} is the local machine`;
  if (privateIpv4(host)) return `${host} is a private, loopback or reserved IPv4 address`;
  if (/^\d+(\.\d+)*$/.test(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return `${host} is not a valid public address`;
  if (!host.includes('.')) return `"${host}" is a single-label (intranet) host name`;
  if (PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return `${host} is a local-network host name`;
  if (LOOPBACK_OR_WILDCARD_IP_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
    return `${host} belongs to a DNS service that maps names to arbitrary or loopback addresses`;
  }
  const embedded = embeddedPrivateIpv4(host);
  if (embedded) return `${host} embeds the private address ${embedded} (wildcard DNS names resolve to it)`;
  return null;
}

/**
 * A private IPv4 address written into a host name, as wildcard DNS services read it: leading dotted
 * labels (`10.1.2.3.example.com`) or a dashed label (`10-1-2-3.example.com`, `app-192-168-1-2.x`).
 */
function embeddedPrivateIpv4(host: string): string | null {
  const dotted = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\./.exec(host)?.[1];
  if (dotted && privateIpv4(dotted)) return dotted;
  for (const label of host.split('.')) {
    const m = /(?:^|[^0-9])(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})(?:$|[^0-9])/.exec(label);
    if (!m) continue;
    const ip = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
    if (privateIpv4(ip)) return ip;
  }
  return null;
}

/** Combine the run's signal with a timeout. */
export function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

/** Read a response body as text, stopping after `maxBytes`. */
export async function readTextCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean; bytes: number }> {
  const charset = /charset=([^;]+)/i.exec(res.headers.get('content-type') ?? '')?.[1]?.trim().replace(/"/g, '') ?? 'utf-8';
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset);
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    const slice = buf.subarray(0, maxBytes);
    return { text: decoder.decode(slice), truncated: buf.length > maxBytes, bytes: slice.length };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - bytes;
    if (value.length > room) {
      chunks.push(value.subarray(0, room));
      bytes += room;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    bytes += value.length;
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  return { text: decoder.decode(all), truncated, bytes };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
  middot: '·', bull: '•', times: '×', deg: '°', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§',
  para: '¶', shy: '', zwj: '', zwnj: '', larr: '←', rarr: '→', uarr: '↑', darr: '↓', hearts: '♥',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4]) : undefined;
};

/**
 * Reduce an HTML document to readable markdown-ish text with regexes (no DOM in a service
 * worker). Good enough for articles and docs; not a full HTML parser.
 */
export function htmlToText(html: string, baseUrl?: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|head|iframe|object|canvas|math|select|button)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(nav|footer)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+\baria-hidden\s*=\s*["']?true["']?[^>]*\/?>/gi, ' ');

  // Prefer the main content region when it has real text.
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(s)?.[1] ?? /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i.exec(s)?.[1];
  if (main && main.replace(/<[^>]+>/g, '').trim().length > 400) s = main;

  // Keep preformatted blocks verbatim (placeholders survive whitespace collapsing).
  const pres: string[] = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_, body: string) => {
    pres.push(decodeEntities(body.replace(/<[^>]+>/g, '')).replace(/\n+$/, ''));
    return `\n\n\uE000${pres.length - 1}\uE000\n\n`;
  });

  const abs = (href: string): string => {
    try {
      return new URL(decodeEntities(href), baseUrl).href;
    } catch {
      return '';
    }
  };
  // Entities are decoded once at the end, after the last tag strip, so "&lt;b&gt;" stays text.
  const inlineText = (h: string): string => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  s = s
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_, n: string, body: string) => `\n\n${'#'.repeat(Number(n))} ${inlineText(body)}\n\n`)
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_, attrs: string, body: string) => {
      const text = inlineText(body);
      const href = attr(attrs, 'href');
      if (!text) return ' ';
      if (!href || /^(javascript|data):|^#/i.test(href.trim())) return text;
      const url = abs(href);
      return url ? `[${text}](${url})` : text;
    })
    .replace(/<img\b([^>]*)>/gi, (_, attrs: string) => {
      const alt = attr(attrs, 'alt');
      return alt ? ` [image: ${alt}] ` : ' ';
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n\n---\n\n')
    .replace(/<\/(td|th)\s*>/gi, ' | ')
    .replace(/<tr\b[^>]*>/gi, '\n| ')
    .replace(/<\/?(p|div|section|article|main|header|aside|ul|ol|dl|dt|dd|table|thead|tbody|tfoot|blockquote|figure|figcaption|details|summary|h[1-6])\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');

  s = decodeEntities(s)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v\r]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\uE000(\d+)\uE000/g, (_, i: string) => '```\n' + (pres[Number(i)] ?? '') + '\n```')
    .trim();
  return { title, text: s };
}
