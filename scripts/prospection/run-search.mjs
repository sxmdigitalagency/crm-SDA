// Recherche du site web en local (Mojeek). Verrouillée : voir search-local.ts.
// Usage : MOJEEK_API_KEY=… node scripts/prospection/run-search.mjs [--batch 25] [--retry-failed] [--local]
// (la clé reste dans ton terminal ; ne la colle ni dans un fichier du dépôt ni dans une conversation)
import { launch } from './lib/launch.mjs';
await launch('scripts/prospection/search-local.ts', 'search-local');
