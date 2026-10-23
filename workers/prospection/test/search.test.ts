// Tests du choix du site web avec un faux moteur et de faux sites (aucun appel réel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseWebsite, isExcluded, nameSignal } from '../src/search/select';
import { mojeekProvider, SearchLockedError } from '../src/search/mojeek';
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

test('Mojeek verrouillé : conditions non lues, URL non vérifiée ou clé absente', () => {
  assert.throws(() => mojeekProvider({ apiKey: 'k', termsRead: false, endpointVerified: true }), SearchLockedError);
  assert.throws(() => mojeekProvider({ apiKey: 'k', termsRead: true, endpointVerified: false }), SearchLockedError);
  assert.throws(() => mojeekProvider({ apiKey: undefined, termsRead: true, endpointVerified: true }), SearchLockedError);
});
