// Mojeek (plan Business choisi par Mathys).
// Paramètres confirmés par Mathys dans la doc officielle (page « Request Parameters ») : chemin /search,
// api_key, q, fmt (json | xml, xml par défaut : on demande toujours json), t (nombre de résultats).
// Non confirmés : l'URL de base (contradiction entre deux pages, valeur en config) et les noms des champs de la
// réponse JSON (lus uniquement depuis prospect_config.search_result_fields, rempli d'après --probe).
//
// Verrous de la recherche : search_provider_terms_read = 1, search_endpoint_verified = 1, search_result_fields
// rempli, clé MOJEEK_API_KEY dans l'environnement. La sonde n'exige que la clé et terms_read.
// La clé et l'URL complète ne sont jamais affichées, journalisées ni stockées.
import type { SearchResultFields } from '../lib/config';
import type { SearchProvider, SearchResult } from './provider';

export class SearchLockedError extends Error {}
export class SearchResponseError extends Error {}

interface Base { apiKey: string | undefined; termsRead: boolean; endpointBase: string; fetch?: typeof fetch }

function requestUrl(base: string, key: string, query: string, count: number): URL {
  const url = new URL(base);
  url.searchParams.set('q', query);
  url.searchParams.set('api_key', key);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('t', String(count));
  return url;
}

async function call(o: Base & { apiKey: string }, query: string, count: number): Promise<{ status: number; contentType: string; body: unknown }> {
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(requestUrl(o.endpointBase, o.apiKey, query, count), { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    // Le message d'origine peut contenir l'URL (donc la clé) : on ne garde que le type d'erreur.
    throw new SearchResponseError(`Mojeek : requête impossible (${(err as Error)?.name ?? 'erreur'})`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) throw new SearchResponseError(`Mojeek : HTTP ${res.status}`);
  const text = await res.text();
  try { return { status: res.status, contentType, body: JSON.parse(text) }; }
  catch { throw new SearchResponseError(`Mojeek : réponse non JSON (type ${contentType || 'inconnu'})`); }
}

function locks(o: Base): asserts o is Base & { apiKey: string } {
  if (!o.termsRead) throw new SearchLockedError('Recherche verrouillée : search_provider_terms_read = 0 (conditions de l’API Mojeek non lues).');
  if (!o.apiKey) throw new SearchLockedError('Recherche verrouillée : aucune clé MOJEEK_API_KEY dans l’environnement.');
}

export function mojeekProvider(o: Base & { endpointVerified: boolean; resultFields: SearchResultFields | null }): SearchProvider {
  locks(o);
  if (!o.endpointVerified) throw new SearchLockedError('Recherche verrouillée : search_endpoint_verified = 0 (lancer --probe, puis le passer à 1 à la main).');
  if (!o.resultFields) throw new SearchLockedError('Recherche verrouillée : search_result_fields vide (le remplir d’après --probe).');
  const f = o.resultFields;
  return {
    name: 'mojeek',
    async search(query: string, limit: number): Promise<SearchResult[]> {
      const { body } = await call(o, query, limit);
      const list = getPath(body, f.results_path);
      if (!Array.isArray(list)) throw new SearchResponseError(`Mojeek : « ${f.results_path} » absent ou n'est pas une liste`);
      return list.slice(0, limit).map((r, i) => {
        const url = (r as Record<string, unknown>)?.[f.url];
        const title = (r as Record<string, unknown>)?.[f.title];
        if (typeof url !== 'string') throw new SearchResponseError(`Mojeek : champ « ${f.url} » absent du résultat ${i + 1}`);
        if (typeof title !== 'string') throw new SearchResponseError(`Mojeek : champ « ${f.title} » absent du résultat ${i + 1}`);
        return { url, title };
      });
    },
  };
}

export interface ProbeReport { status: number; contentType: string; topLevelKeys: string[]; shape: unknown; firstResult: { path: string; fields: string[] } | null }

/** Une requête réelle ; renvoie seulement la forme de la réponse (clés et types), jamais les valeurs. */
export async function mojeekProbe(o: Base, query: string): Promise<ProbeReport> {
  locks(o);
  const { status, contentType, body } = await call(o, query, 3);
  return {
    status, contentType,
    topLevelKeys: isObject(body) ? Object.keys(body) : [],
    shape: shapeOf(body, 4),
    firstResult: firstObjectInArray(body, ''),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function shapeOf(v: unknown, depth: number): unknown {
  if (Array.isArray(v)) return depth <= 0 ? `array(${v.length})` : { [`array(${v.length})`]: v.length ? shapeOf(v[0], depth - 1) : 'vide' };
  if (isObject(v)) return depth <= 0 ? 'object' : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x, depth - 1)]));
  return v === null ? 'null' : typeof v;
}

/** Premier tableau d'objets trouvé (parcours en largeur) : son chemin et les noms des champs de son 1er élément. */
export function firstObjectInArray(v: unknown, path: string): { path: string; fields: string[] } | null {
  const queue: [unknown, string][] = [[v, path]];
  while (queue.length) {
    const [x, p] = queue.shift()!;
    if (Array.isArray(x)) {
      if (isObject(x[0])) return { path: p, fields: Object.keys(x[0]) };
    } else if (isObject(x)) {
      for (const [k, y] of Object.entries(x)) queue.push([y, p ? `${p}.${k}` : k]);
    }
  }
  return null;
}

function getPath(v: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((x, k) => (isObject(x) ? x[k] : undefined), v);
}
