// Crawl poli d'un site d'entreprise (spec 4.2.2) : robots.txt respecté, User-Agent identifiable,
// au moins 2 s entre deux requêtes au même domaine (plus si Crawl-delay l'exige), 6 pages au maximum,
// 10 s de délai par requête, HTML uniquement, taille plafonnée. Aucune donnée n'est envoyée au site.
import { parseRobots, type Robots } from './robots';

export interface CrawlOptions {
  userAgent: string;
  delayMs: number;
  maxPages: number;
  timeoutMs: number;
  maxBytes: number;
  /** Catégorie → motif de chemin (regex), ex. { contact: "^/contact" }. Une page par catégorie. */
  pagePatterns: Record<string, string>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface Page { url: string; category: string; html: string }
export interface CrawlResult { pages: Page[]; skipped: { url: string; reason: string }[]; requests: number }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function crawlSite(startUrl: string, o: CrawlOptions): Promise<CrawlResult> {
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? defaultSleep;
  const now = o.now ?? Date.now;
  const origin = new URL(startUrl).origin;
  const host = bareHost(new URL(startUrl).hostname);
  const skipped: CrawlResult['skipped'] = [];
  let requests = 0;
  let last: number | null = null;
  let delay = o.delayMs;

  const politeGet = async (url: string, accept: string) => {
    const wait = last === null ? 0 : last + delay - now();
    if (wait > 0) await sleep(wait);
    last = now();
    requests++;
    return doFetch(url, {
      headers: { 'User-Agent': o.userAgent, Accept: accept },
      redirect: 'follow',
      signal: AbortSignal.timeout(o.timeoutMs),
    });
  };

  // robots.txt : 4xx = pas de restriction ; 5xx ou injoignable = on ne crawle pas (RFC 9309, 2.3.1).
  let robots: Robots;
  try {
    const res = await politeGet(`${origin}/robots.txt`, 'text/plain');
    if (res.status >= 500) return { pages: [], skipped: [{ url: `${origin}/robots.txt`, reason: `robots_${res.status}` }], requests };
    robots = parseRobots(res.ok ? await res.text() : '', o.userAgent);
  } catch (err) {
    return { pages: [], skipped: [{ url: `${origin}/robots.txt`, reason: `robots_unreachable: ${String(err)}` }], requests };
  }
  if (robots.crawlDelayMs !== null) delay = Math.max(delay, robots.crawlDelayMs);

  const pages: Page[] = [];
  const getPage = async (url: string, category: string) => {
    const path = new URL(url).pathname + new URL(url).search;
    if (!robots.allowed(path)) { skipped.push({ url, reason: 'robots_disallow' }); return null; }
    try {
      const res = await politeGet(url, 'text/html');
      if (bareHost(new URL(res.url || url).hostname) !== host) { skipped.push({ url, reason: 'redirect_other_host' }); return null; }
      if (!res.ok) { skipped.push({ url, reason: `http_${res.status}` }); return null; }
      if (!(res.headers.get('content-type') ?? '').includes('text/html')) { skipped.push({ url, reason: 'not_html' }); return null; }
      const html = await readCapped(res, o.maxBytes);
      const page = { url: res.url || url, category, html };
      pages.push(page);
      return page;
    } catch (err) {
      skipped.push({ url, reason: `fetch_error: ${String(err)}` });
      return null;
    }
  };

  const home = await getPage(startUrl, 'home');
  if (!home) return { pages, skipped, requests };

  // Pages suivantes : uniquement des liens présents sur l'accueil, même site, une par catégorie.
  const links = extractLinks(home.html, home.url).filter((u) => bareHost(u.hostname) === host);
  for (const [category, pattern] of Object.entries(o.pagePatterns)) {
    if (pages.length >= o.maxPages) break;
    const re = new RegExp(pattern, 'i');
    const hit = links.find((u) => re.test(u.pathname) && !pages.some((p) => samePage(p.url, u.href)));
    if (hit) await getPage(hit.href, category);
  }
  return { pages, skipped, requests };
}

export function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

function samePage(a: string, b: string) {
  const n = (s: string) => { const u = new URL(s); return bareHost(u.hostname) + u.pathname.replace(/\/$/, ''); };
  return n(a) === n(b);
}

function extractLinks(html: string, base: string): URL[] {
  const out: URL[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1]!, base);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.push(u);
    } catch { /* lien invalide ignoré */ }
  }
  return out;
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(size, maxBytes));
  let off = 0;
  for (const c of chunks) { const part = c.subarray(0, all.length - off); all.set(part, off); off += part.length; if (off >= all.length) break; }
  return new TextDecoder().decode(all);
}
