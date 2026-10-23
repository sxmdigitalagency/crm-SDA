// enrich en local, lancé à la main par lots (phase de test).
// Usage : node scripts/prospection/run-enrich.mjs [--batch 25] [--retry-failed] [--local]
// Écrit dans la base distante (par défaut) avec tes identifiants wrangler. Crawl poli : robots.txt,
// 2 s entre requêtes, 6 pages, 10 s, 1,5 Mo. Aucune adresse email collectée.
import { launch } from './lib/launch.mjs';
await launch('scripts/prospection/enrich-local.ts', 'enrich-local');
