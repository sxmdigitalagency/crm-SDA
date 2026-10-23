// Choix du site web d'une entreprise (spec 4.2.1, règle durcie par Mathys) :
//   - domaines exclus (annuaires, réseaux sociaux, plateformes) : jamais retenus, jamais crawlés ;
//   - signal A : le domaine ou le titre correspond au nom normalisé de l'entreprise ;
//   - signal B : une page du site (lue avec le crawl poli) cite la ville ou le numéro de licence ;
//   - A et B → accepted ; un seul → review (contrôle humain, n'avance pas) ; aucun candidat → none.
// Seuls l'URL retenue et la raison (les deux signaux) sortent de ce module.
import { bareHost, crawlSite, type CrawlOptions } from '../enrich/crawl';
import { visibleText } from '../enrich/extract';
import type { SearchProvider } from './provider';

export interface CompanyForSearch { legal_name: string | null; dba_name: string | null; city: string | null; license_number: string }
export interface SiteChoice { status: 'accepted' | 'review' | 'none'; url: string | null; domain: string | null; reason: string | null; checked: number }

const LEGAL_SUFFIXES = /\b(l\.?l\.?c|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|pa|llp|lp|dba|the|and|of)\b/g;

/** Mots significatifs du nom : minuscules, sans ponctuation ni forme juridique. */
export function nameWords(name: string): string[] {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ').replace(LEGAL_SUFFIXES, ' ')
    .split(/\s+/).filter((w) => w.length >= 2);
}

export function isExcluded(host: string, excluded: string[]): boolean {
  const h = bareHost(host);
  return excluded.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Signal A : nom (collé) dans le libellé du domaine, ou tous les mots significatifs dans le titre. */
export function nameSignal(name: string, url: string, title: string): string | null {
  const words = nameWords(name);
  if (!words.length) return null;
  const compact = words.join('');
  const label = bareHost(new URL(url).hostname).split('.').slice(0, -1).join('').replace(/[^a-z0-9]/g, '');
  if (compact.length >= 5 && label.includes(compact)) return `nom « ${compact} » dans le domaine`;
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  if (words.length >= 2 && words.every((w) => t.includes(` ${w} `))) return `nom « ${words.join(' ')} » dans le titre`;
  return null;
}

/** Signal B : ville (mot entier) ou numéro de licence (avec ou sans espace / #) dans le texte d'une page. */
export function placeSignal(texts: { url: string; text: string }[], city: string | null, license: string): string | null {
  const m = license.match(/^([A-Za-z]+)\s*(\d+)$/);
  const licRe = m ? new RegExp(`\\b${m[1]}\\s*#?\\s*${m[2]}\\b`, 'i') : new RegExp(`\\b${license.replace(/[^A-Za-z0-9]/g, '')}\\b`, 'i');
  const cityRe = city && city.trim().length >= 3 ? new RegExp(`\\b${city.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i') : null;
  for (const t of texts) {
    const path = new URL(t.url).pathname || '/';
    if (licRe.test(t.text)) return `licence ${license} sur ${path}`;
    if (cityRe?.test(t.text)) return `ville « ${city!.trim()} » sur ${path}`;
  }
  return null;
}

export async function chooseWebsite(
  company: CompanyForSearch,
  provider: SearchProvider,
  o: { excluded: string[]; maxCandidates: number; maxChecked: number; crawl: Omit<CrawlOptions, 'maxPages' | 'pagePatterns'> },
): Promise<SiteChoice> {
  const name = company.dba_name || company.legal_name || '';
  if (!name) return { status: 'none', url: null, domain: null, reason: null, checked: 0 };
  const query = `"${name}" ${company.city ?? ''} FL`.replace(/\s+/g, ' ').trim();
  const results = await provider.search(query, o.maxCandidates);

  // Un candidat par domaine, domaines exclus retirés avant tout crawl.
  const seen = new Set<string>();
  const candidates = results.filter((r) => {
    try {
      const u = new URL(r.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
      const d = bareHost(u.hostname);
      if (isExcluded(d, o.excluded) || seen.has(d)) return false;
      seen.add(d);
      return true;
    } catch { return false; }
  });

  let review: SiteChoice | null = null;
  let checked = 0;
  for (const c of candidates.slice(0, o.maxChecked)) {
    checked++;
    const origin = `${new URL(c.url).origin}/`;
    const a = nameSignal(name, c.url, c.title);
    const crawl = await crawlSite(origin, { ...o.crawl, maxPages: 3, pagePatterns: { contact: '^/contact', about: '^/about' } });
    const b = placeSignal(crawl.pages.map((p) => ({ url: p.url, text: visibleText(p.html) })), company.city, company.license_number);
    const domain = bareHost(new URL(origin).hostname);
    if (a && b) return { status: 'accepted', url: origin, domain, reason: `${a} + ${b}`.slice(0, 120), checked };
    if ((a || b) && !review) review = { status: 'review', url: origin, domain, reason: `un seul signal : ${a ?? b}`.slice(0, 120), checked };
  }
  return review ? { ...review, checked } : { status: 'none', url: null, domain: null, reason: null, checked };
}
