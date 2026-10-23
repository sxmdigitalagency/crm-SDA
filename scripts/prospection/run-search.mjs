// Recherche du site web en local (Mojeek). Verrouillée : voir search-local.ts.
// Usage : node scripts/prospection/run-search.mjs [--batch 25] [--retry-failed] [--local]
//         node scripts/prospection/run-search.mjs --probe "cool air pro tampa fl"   (sonde, rien en base)
// Clé : `read -rs MOJEEK_API_KEY && export MOJEEK_API_KEY` (rien dans l'historique du terminal). Ne la colle ni dans
// un fichier du dépôt ni dans une conversation.
import { launch } from './lib/launch.mjs';
await launch('scripts/prospection/search-local.ts', 'search-local');
