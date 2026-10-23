// Interface unique des moteurs de recherche. Les résultats bruts ne quittent jamais la mémoire :
// seule l'URL retenue et la raison du choix sont enregistrées (consigne de Mathys).
export interface SearchResult { url: string; title: string }

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchResult[]>;
}
