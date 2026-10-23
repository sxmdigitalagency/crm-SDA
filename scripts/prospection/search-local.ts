// Recherche du site web en local. VERROUILLÉE tant que search_provider_terms_read = 0,
// search_endpoint_verified = 0, ou qu'aucune clé MOJEEK_API_KEY n'est dans l'environnement.
import { mojeekProvider } from '../../workers/prospection/src/search/mojeek';
import { claimSearchJobs, runSearch } from '../../workers/prospection/src/search/run';
import { openEnv, parseArgs, stopSignal } from './lib/common';

const args = parseArgs(process.argv.slice(2));
const { env, cfg } = await openEnv(args.local);
if (cfg.searchProvider !== 'mojeek') throw new Error(`Fournisseur inconnu : ${cfg.searchProvider}`);
const provider = mojeekProvider({ apiKey: process.env.MOJEEK_API_KEY, termsRead: cfg.searchProviderTermsRead, endpointVerified: cfg.searchEndpointVerified });
const stop = stopSignal();
const jobs = await claimSearchJobs(env, args.batch, { retryFailed: args.retryFailed });
console.log(`${jobs.length} entreprise(s) à rechercher.`);
const tally: Record<string, number> = {};
for (const [i, j] of jobs.entries()) {
  if (stop.stop) break;
  try {
    const s = await runSearch(env, j.id, j.company_id, provider, cfg);
    tally[s] = (tally[s] ?? 0) + 1;
    console.log(`  [${i + 1}/${jobs.length}] entreprise ${j.company_id} : ${s}`);
  } catch (err) {
    tally.failed = (tally.failed ?? 0) + 1;
    console.log(`  [${i + 1}/${jobs.length}] entreprise ${j.company_id} : échec — ${String(err).slice(0, 160)}`);
  }
}
console.log('Résultat :', tally);
