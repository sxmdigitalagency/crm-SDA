// Tests du crawl et de l'extraction, sur des pages fabriquées (aucun site réel).
// Lancement : npm run prospect:test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots } from '../src/enrich/robots';
import { crawlSite } from '../src/enrich/crawl';
import { extractSignals } from '../src/enrich/extract';

const UA = 'SDA-Research-Bot/1.0 (+https://sxmdigitalagency.com)';
const RULES = {
  bookingWidgetHosts: ['calendly.com', 'housecallpro.com'],
  bookingTextPatterns: ['book online', 'schedule service'],
  chatWidgetHosts: ['tawk.to', 'podium.com'],
  aiAnsweringSignals: [] as string[],
};

test('robots : groupe spécifique, motif le plus long, * et $', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /\n\nUser-agent: SDA-Research-Bot\nDisallow: /private\nAllow: /private/ok$\nCrawl-delay: 5`, UA);
  assert.equal(r.allowed('/contact'), true);
  assert.equal(r.allowed('/private/x'), false);
  assert.equal(r.allowed('/private/ok'), true);
  assert.equal(r.allowed('/private/ok/more'), false);
  assert.equal(r.crawlDelayMs, 5000);
  const star = parseRobots(`User-agent: *\nDisallow: /*.pdf$\nDisallow:`, UA);
  assert.equal(star.allowed('/a.pdf'), false);
  assert.equal(star.allowed('/a.pdf?x'), true);
  assert.equal(parseRobots('', UA).allowed('/anything'), true);
});

function fakeSite(pages: Record<string, { status?: number; body: string; type?: string }>) {
  const calls: { url: string; at: number; ua: string | null }[] = [];
  let clock = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, at: clock, ua: new Headers(init?.headers).get('User-Agent') });
    const p = pages[new URL(url).pathname];
    const res = new Response(p?.body ?? 'not found', { status: p?.status ?? (p ? 200 : 404), headers: { 'content-type': p?.type ?? 'text/html' } });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }) as typeof globalThis.fetch;
  const sleep = async (ms: number) => { clock += ms; };
  return { fetch, sleep, calls, now: () => clock };
}

const OPTS = { userAgent: UA, delayMs: 2000, maxPages: 6, timeoutMs: 10000, maxBytes: 1_500_000,
  pagePatterns: { contact: '^/contact', about: '^/about', services: '^/services', schedule: '^/schedule', book: '^/book' } };

test('crawl : robots respecté, liens de l’accueil seulement, 6 pages max, User-Agent envoyé', async () => {
  const home = `<a href="/contact-us">Contact</a><a href="/about">About</a><a href="/services/ac">AC</a>
    <a href="/schedule">Schedule</a><a href="/book-now">Book</a><a href="https://other.com/contact">x</a><a href="/blog">b</a>`;
  const site = fakeSite({
    '/robots.txt': { body: 'User-agent: *\nDisallow: /about', type: 'text/plain' },
    '/': { body: home }, '/contact-us': { body: 'c' }, '/services/ac': { body: 's' }, '/schedule': { body: 'sc' }, '/book-now': { body: 'b' },
  });
  const r = await crawlSite('https://www.acme-ac.com/', { ...OPTS, fetch: site.fetch, sleep: site.sleep, now: site.now });
  assert.deepEqual(r.pages.map((p) => p.category), ['home', 'contact', 'services', 'schedule', 'book']);
  assert.ok(r.skipped.some((s) => s.reason === 'robots_disallow' && s.url.endsWith('/about')));
  assert.ok(!site.calls.some((c) => c.url.includes('other.com') || c.url.includes('/blog') || c.url.endsWith('/about')));
  assert.ok(site.calls.every((c) => c.ua === UA));
  assert.ok(r.pages.length <= 6);
  // 6 requêtes (robots + 5 pages) → 5 attentes d'environ 2 s.
  assert.equal(r.requests, 6);
  assert.equal(site.now(), 5 * 2000);
  // Chaque requête part au moins 2 s après la précédente.
  site.calls.slice(1).forEach((c, i) => assert.ok(c.at - site.calls[i]!.at >= 2000));
});

test('crawl : robots en 5xx → aucune page lue', async () => {
  const site = fakeSite({ '/robots.txt': { status: 503, body: '' }, '/': { body: 'home' } });
  const r = await crawlSite('https://acme.com/', { ...OPTS, fetch: site.fetch, sleep: site.sleep, now: site.now });
  assert.equal(r.pages.length, 0);
  assert.equal(site.calls.length, 1);
});

test('crawl : Crawl-delay plus long que 2 s respecté', async () => {
  const site = fakeSite({ '/robots.txt': { body: 'User-agent: *\nCrawl-delay: 10', type: 'text/plain' }, '/': { body: '<a href="/contact">c</a>' }, '/contact': { body: 'c' } });
  await crawlSite('https://acme.com/', { ...OPTS, fetch: site.fetch, sleep: site.sleep, now: site.now });
  assert.equal(site.now(), 2 * 10000);
});

const page = (category: string, path: string, html: string) => ({ category, url: `https://acme-ac.com${path}`, html });

test('extraction : site « téléphone seulement », pub Google Ads, 12 techniciens', () => {
  const ev = extractSignals([
    page('home', '/', `<script async src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script>
      <h1>Acme AC — Tampa</h1><p>Call <a href="tel:+18135551234">(813) 555-1234</a></p>
      <p>Our 12 certified technicians serve Tampa, Brandon and Riverview.</p>`),
    page('contact', '/contact', `<p>Call us during business hours.</p><form role="search"><input name="q"></form>`),
  ], RULES);
  const get = (s: string) => ev.find((e) => e.signal === s);
  assert.equal(get('phone_present')?.value, 'yes');
  assert.equal(get('phone_value')?.value, '(813) 555-1234');
  assert.equal(get('has_contact_form')?.value, 'no');
  assert.equal(get('has_online_booking')?.value, 'no');
  assert.equal(get('has_chat_widget')?.value, 'no');
  assert.equal(get('mentions_24_7_or_emergency')?.value, 'no');
  assert.equal(get('has_ads_tracking')?.value, 'google_ads');
  assert.equal(get('team_size_hint')?.value, '12 technicians');
  assert.equal(get('email_public_present')?.value, 'no');
  assert.equal(get('has_ai_answering_signal'), undefined, 'liste vide → pas de signal');
  assert.equal(get('locations_count'), undefined);
  for (const e of ev) assert.ok(!e.excerpt || e.excerpt.length <= 200);
});

test('extraction : formulaire, widget de réservation et chat, 24/7, email présent mais jamais stocké', () => {
  const ev = extractSignals([
    page('home', '/', `<p>24/7 emergency AC repair</p><script src="https://widget.podium.com/x.js"></script>
      <p>Write to service@acme-ac.com</p><p>3 locations across Central Florida</p>`),
    page('contact', '/contact', `<form action="/send"><input type="email" name="e"><textarea></textarea></form>`),
    page('book', '/book', `<iframe src="https://calendly.com/acme/visit"></iframe>`),
  ], RULES);
  const get = (s: string) => ev.find((e) => e.signal === s);
  assert.equal(get('has_contact_form')?.value, 'yes');
  assert.equal(get('has_contact_form')?.source_url, 'https://acme-ac.com/contact');
  assert.equal(get('has_online_booking')?.value, 'widget:calendly.com');
  assert.equal(get('has_online_booking')?.source_url, 'https://acme-ac.com/book');
  assert.equal(get('has_chat_widget')?.value, 'widget.podium.com');
  assert.equal(get('mentions_24_7_or_emergency')?.value, 'yes');
  assert.equal(get('locations_count')?.value, '3');
  assert.equal(get('email_public_present')?.value, 'yes');
  assert.ok(!JSON.stringify(ev).includes('service@acme-ac.com'), 'aucune adresse email dans les preuves');
});

test('extraction : texte « Book online » seul = signal faible text_only', () => {
  const ev = extractSignals([page('home', '/', '<p>Book online today!</p>')], RULES);
  assert.equal(ev.find((e) => e.signal === 'has_online_booking')?.value, 'text_only');
});
