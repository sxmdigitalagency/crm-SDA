// Mojeek (plan Business choisi par Mathys). AUCUN appel tant que :
//   - prospect_config.search_provider_terms_read = 1 (Mathys a lu les conditions de l'API), et
//   - une clé est fournie par l'environnement (secret wrangler MOJEEK_API_KEY / variable du script local).
// La clé n'apparaît jamais dans le code, les journaux ni la base.
//
// À CONFIRMER dans la documentation de l'API Mojeek à l'ouverture du compte (non lue : site injoignable
// depuis l'environnement de Claude) : URL, nom des paramètres, format de la réponse. Les valeurs ci-dessous
// sont reprises de mémoire et ne doivent pas être utilisées avant cette vérification.
import type { SearchProvider, SearchResult } from './provider';

export const MOJEEK_UNVERIFIED = {
  endpoint: 'https://api.mojeek.com/search', // à confirmer
  params: { query: 'q', key: 'api_key', format: 'fmt', count: 't' }, // à confirmer
} as const;

export class SearchLockedError extends Error {}

export function mojeekProvider(o: { apiKey: string | undefined; termsRead: boolean; endpointVerified: boolean; fetch?: typeof fetch }): SearchProvider {
  if (!o.termsRead) throw new SearchLockedError('Recherche verrouillée : search_provider_terms_read = 0 (conditions de l’API Mojeek non lues).');
  if (!o.endpointVerified) throw new SearchLockedError('Recherche verrouillée : URL et paramètres de l’API Mojeek non vérifiés dans leur documentation.');
  if (!o.apiKey) throw new SearchLockedError('Recherche verrouillée : aucune clé MOJEEK_API_KEY dans l’environnement.');
  const doFetch = o.fetch ?? fetch;
  const key = o.apiKey;
  return {
    name: 'mojeek',
    async search(query: string, limit: number): Promise<SearchResult[]> {
      const p = MOJEEK_UNVERIFIED.params;
      const url = new URL(MOJEEK_UNVERIFIED.endpoint);
      url.searchParams.set(p.query, query);
      url.searchParams.set(p.format, 'json');
      url.searchParams.set(p.count, String(limit));
      url.searchParams.set(p.key, key);
      const res = await doFetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Mojeek HTTP ${res.status}`); // l'URL (avec la clé) n'est jamais journalisée
      const body = (await res.json()) as { response?: { results?: { url?: unknown; title?: unknown }[] } };
      return (body.response?.results ?? [])
        .filter((r) => typeof r.url === 'string')
        .slice(0, limit)
        .map((r) => ({ url: r.url as string, title: typeof r.title === 'string' ? r.title : '' }));
    },
  };
}
