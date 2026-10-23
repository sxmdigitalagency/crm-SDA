// enrich en local (phase de test) : mêmes fonctions que le Worker (claimEnrichJobs, runEnrich).
// Ne traite que les entreprises au site « accepted ». Reprend les jobs interrompus.
import { claimEnrichJobs, runEnrich } from '../../workers/prospection/src/enrich/index';
import { openEnv, parseArgs, stopSignal } from './lib/common';

const args = parseArgs(process.argv.slice(2));
const { env, cfg } = await openEnv(args.local);
const stop = stopSignal();
const jobs = await claimEnrichJobs(env, args.batch, { resume: true, retryFailed: args.retryFailed });
console.log(`${jobs.length} entreprise(s) à enrichir (base ${args.local ? 'locale' : 'distante'}, lot de ${args.batch}).`);
let ok = 0, failed = 0;
for (const [i, j] of jobs.entries()) {
  if (stop.stop) break;
  const t = Date.now();
  try {
    await runEnrich(env, j.id, j.company_id, cfg);
    ok++;
    console.log(`  [${i + 1}/${jobs.length}] entreprise ${j.company_id} : faite (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  } catch (err) {
    failed++;
    console.log(`  [${i + 1}/${jobs.length}] entreprise ${j.company_id} : échec — ${String(err).slice(0, 160)}`);
  }
}
console.log(`Terminé : ${ok} faites, ${failed} en échec${stop.stop ? ', arrêt demandé' : ''}. Relancer reprend là où ça s'est arrêté ; --retry-failed rejoue les échecs.`);
