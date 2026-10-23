// Recherche du site web en local. VERROUILLÉE tant que search_provider_terms_read = 0,
// search_endpoint_verified = 0, search_result_fields vide, ou sans clé MOJEEK_API_KEY dans l'environnement.
// --probe "<requête>" : une seule requête réelle, affiche la forme de la réponse, n'écrit rien en base.
import { mojeekProbe, mojeekProvider } from '../../workers/prospection/src/search/mojeek';
import { claimSearchJobs, runSearch } from '../../workers/prospection/src/search/run';
import { openEnv, parseArgs, stopSignal } from './lib/common';

const argv = process.argv.slice(2);
const probeAt = argv.indexOf('--probe');
const args = parseArgs(argv);
const { env, cfg } = await openEnv(args.local);
if (cfg.searchProvider !== 'mojeek') throw new Error(`Fournisseur inconnu : ${cfg.searchProvider}`);
const base = { apiKey: process.env.MOJEEK_API_KEY, termsRead: cfg.searchProviderTermsRead, endpointBase: cfg.searchEndpointBase };

if (probeAt >= 0) {
  const query = argv[probeAt + 1];
  if (!query || query.startsWith('--')) throw new Error('Usage : --probe "<requête>"');
  const r = await mojeekProbe(base, query);
  console.log(`Sonde Mojeek (${cfg.searchEndpointBase}) — rien n'est enregistré.`);
  console.log(`HTTP ${r.status}, type ${r.contentType}`);
  console.log(`Clés de premier niveau : ${r.topLevelKeys.join(', ') || '(aucune)'}`);
  console.log('Forme (clés et types, sans valeurs) :');
  console.log(JSON.stringify(r.shape, null, 2));
  if (r.firstResult) {
    console.log(`\nPremière liste d'objets : « ${r.firstResult.path} »`);
    console.log(`Champs du premier élément : ${r.firstResult.fields.join(', ')}`);
  } else console.log('\nAucune liste d’objets trouvée dans la réponse.');
  console.log(`\nÉtapes suivantes (à faire par toi) :
  1. remplir search_result_fields, ex. {"results_path":"<chemin de la liste>","url":"<champ URL>","title":"<champ titre>"}
  2. passer search_endpoint_verified à 1.`);
  process.exit(0);
}

const provider = mojeekProvider({ ...base, endpointVerified: cfg.searchEndpointVerified, resultFields: cfg.searchResultFields });
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
