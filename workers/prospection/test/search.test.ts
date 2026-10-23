// Tests du choix du site web avec un faux moteur et de faux sites (aucun appel réel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseWebsite, isExcluded, nameSignal } from '../src/search/select';
import { mojeekProbe, mojeekProvider, SearchLockedError } from '../src/search/mojeek';
import type { SearchProvider, SearchResult } from '../src/search/provider';

const UA = 'SDA-Research-Bot/1.0 (+https://sxmdigitalagency.com)';
const EXCLUDED = ['yelp.com', 'facebook.com', 'bbb.org', 'x.com', 'google.com'];

function fakeWeb(sites: Record<string, string>) {
  const fetched: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    fetched.push(url.href);
    if (url.pathname === '/robots.txt') return new Response('', { status: 404 });
    const body = sites[url.origin + url.pathname];
    const res = new Response(body ?? 'not found', { status: body ? 200 : 404, headers: { 'content-type': 'text/html' } });
    Object.defineProperty(res, 'url', { value: url.href });
    return res;
  }) as typeof globalThis.fetch;
  return { fetch, fetched };
}
const provider = (results: SearchResult[]): SearchProvider => ({ name: 'fake', search: async () => results });
const company = { legal_name: 'COOL AIR PRO LLC', dba_name: null, city: 'Tampa', license_number: 'CAC1812345' };
const opts = (fetch: typeof globalThis.fetch) => ({ excluded: EXCLUDED, maxCandidates: 5, maxChecked: 3,
  crawl: { userAgent: UA, delayMs: 0, timeoutMs: 1000, maxBytes: 1_000_000, fetch, sleep: async () => {} } });

test('exclusion : suffixe de domaine exact (x.com exclu, fedex.com non)', () => {
  assert.equal(isExcluded('www.yelp.com', EXCLUDED), true);
  assert.equal(isExcluded('m.facebook.com', EXCLUDED), true);
  assert.equal(isExcluded('x.com', EXCLUDED), true);
  assert.equal(isExcluded('fedex.com', EXCLUDED), false);
});

test('nom normalisé : forme juridique retirée, nom collé dans le domaine', () => {
  assert.match(nameSignal('COOL AIR PRO LLC', 'https://www.coolairpro.com/', '')!, /coolairpro/);
  assert.equal(nameSignal('COOL AIR PRO LLC', 'https://www.bestac.com/', 'Best AC in Tampa'), null);
});

test('annuaire : jamais retenu ni crawlé, on passe au vrai site', async () => {
  const web = fakeWeb({ 'https://coolairpro.com/': '<p>Cool Air Pro, Tampa FL</p>' });
  const r = await chooseWebsite(company, provider([
    { url: 'https://www.yelp.com/biz/cool-air-pro-tampa', title: 'Cool Air Pro - Yelp' },
    { url: 'https://coolairpro.com/', title: 'Cool Air Pro' },
  ]), opts(web.fetch));
  assert.equal(r.status, 'accepted');
  assert.equal(r.url, 'https://coolairpro.com/');
  assert.match(r.reason!, /domaine.*\+.*ville « Tampa »/);
  assert.ok(!web.fetched.some((u) => u.includes('yelp.com')), 'annuaire jamais crawlé');
});

test('homonyme dans une autre ville : un seul signal → review', async () => {
  const web = fakeWeb({ 'https://coolairpro.net/': '<p>Cool Air Pro — serving Denver, Colorado</p>' });
  const r = await chooseWebsite(company, provider([{ url: 'https://coolairpro.net/', title: 'Cool Air Pro Denver' }]), opts(web.fetch));
  assert.equal(r.status, 'review');
  assert.match(r.reason!, /un seul signal : nom/);
});

test('vrai site avec une seule correspondance (ville, nom absent du domaine) → review', async () => {
  const web = fakeWeb({ 'https://tampahvacexperts.com/': '<p>HVAC experts in Tampa</p>' });
  const r = await chooseWebsite(company, provider([{ url: 'https://tampahvacexperts.com/', title: 'HVAC Experts' }]), opts(web.fetch));
  assert.equal(r.status, 'review');
  assert.match(r.reason!, /un seul signal : ville/);
});

test('numéro de licence sur la page de contact = signal B', async () => {
  const web = fakeWeb({
    'https://coolairpro.com/': '<a href="/contact">Contact</a><p>Welcome</p>',
    'https://coolairpro.com/contact': '<p>State license # CAC 1812345</p>',
  });
  const r = await chooseWebsite({ ...company, city: null }, provider([{ url: 'https://coolairpro.com/', title: '' }]), opts(web.fetch));
  assert.equal(r.status, 'accepted');
  assert.match(r.reason!, /licence CAC1812345 sur \/contact/);
});

test('aucun candidat utilisable → none', async () => {
  const web = fakeWeb({});
  const r = await chooseWebsite(company, provider([{ url: 'https://facebook.com/coolairpro', title: 'Cool Air Pro' }]), opts(web.fetch));
  assert.equal(r.status, 'none');
  assert.equal(web.fetched.length, 0);
});

const KEY = 'sk-test-SECRET-123';
const FIELDS = { results_path: 'response.results', url: 'url', title: 'title' };
function fakeApi(body: unknown, status = 200) {
  const calls: URL[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    calls.push(new URL(String(input)));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
const base = (fetch: typeof globalThis.fetch) => ({ apiKey: KEY, termsRead: true, endpointBase: 'https://api.mojeek.com/search', fetch });
const ok = (fetch: typeof globalThis.fetch) => ({ ...base(fetch), endpointVerified: true, resultFields: FIELDS });

test('Mojeek verrouillé : conditions non lues, URL non vérifiée, champs non remplis ou clé absente', () => {
  const { fetch } = fakeApi({});
  assert.throws(() => mojeekProvider({ ...ok(fetch), termsRead: false }), SearchLockedError);
  assert.throws(() => mojeekProvider({ ...ok(fetch), endpointVerified: false }), SearchLockedError);
  assert.throws(() => mojeekProvider({ ...ok(fetch), resultFields: null }), SearchLockedError);
  assert.throws(() => mojeekProvider({ ...ok(fetch), apiKey: undefined }), SearchLockedError);
});

test('Mojeek : URL = base de la config + q, api_key, fmt=json, t (paramètres confirmés seulement)', async () => {
  const api = fakeApi({ response: { results: [] } });
  await mojeekProvider({ ...ok(api.fetch), endpointBase: 'https://www.mojeek.com/search' }).search('"Cool Air Pro" Tampa FL', 5);
  const u = api.calls[0]!;
  assert.equal(u.origin + u.pathname, 'https://www.mojeek.com/search');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['api_key', 'fmt', 'q', 't']);
  assert.equal(u.searchParams.get('fmt'), 'json');
  assert.equal(u.searchParams.get('t'), '5');
  assert.equal(u.searchParams.get('q'), '"Cool Air Pro" Tampa FL');
});

test('Mojeek : lit uniquement les champs configurés ; champ manquant → erreur, pas d’autre nom essayé', async () => {
  const good = fakeApi({ response: { results: [{ url: 'https://a.com/', title: 'A', extra: 1 }] } });
  assert.deepEqual(await mojeekProvider(ok(good.fetch)).search('q', 5), [{ url: 'https://a.com/', title: 'A' }]);
  const other = fakeApi({ response: { results: [{ link: 'https://a.com/', title: 'A' }] } });
  await assert.rejects(mojeekProvider(ok(other.fetch)).search('q', 5), /champ « url » absent du résultat 1/);
  const noList = fakeApi({ data: [] });
  await assert.rejects(mojeekProvider(ok(noList.fetch)).search('q', 5), /« response\.results » absent/);
});

test('Mojeek : la clé n’apparaît dans aucun message d’erreur', async () => {
  const errors: string[] = [];
  for (const api of [fakeApi({}, 403), fakeApi('<xml/>'), { fetch: (async () => { throw new TypeError(`fetch failed for https://api.mojeek.com/search?api_key=${KEY}`); }) as typeof globalThis.fetch }]) {
    try { await mojeekProvider(ok(api.fetch)).search('q', 5); } catch (e) { errors.push(String(e)); }
    try { await mojeekProbe(base(api.fetch), 'q'); } catch (e) { errors.push(String(e)); }
  }
  assert.equal(errors.length, 6);
  for (const e of errors) assert.ok(!e.includes(KEY), e);
});

test('sonde : forme sans valeurs, champs du premier résultat, refus si conditions non lues', async () => {
  const api = fakeApi({ response: { status: 'OK', head: { query: 'secret query' }, results: [{ url: 'https://a.com/', title: 'Titre visible', desc: 'x' }] } });
  const r = await mojeekProbe(base(api.fetch), 'q');
  assert.deepEqual(r.topLevelKeys, ['response']);
  assert.deepEqual(r.firstResult, { path: 'response.results', fields: ['url', 'title', 'desc'] });
  const printed = JSON.stringify(r);
  assert.ok(!printed.includes('Titre visible') && !printed.includes('secret query') && !printed.includes('a.com'), 'aucune valeur dans la sonde');
  await assert.rejects(mojeekProbe({ ...base(api.fetch), termsRead: false }, 'q'), SearchLockedError);
});
