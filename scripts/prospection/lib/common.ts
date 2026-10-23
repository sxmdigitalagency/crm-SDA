// Outils communs aux scripts locaux de prospection.
import { loadConfig } from '../../../workers/prospection/src/lib/config';
import type { Env } from '../../../workers/prospection/src/env';
import { wranglerD1 } from './d1-wrangler';

export function parseArgs(argv: string[]) {
  const opt = (name: string, d?: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : d; };
  const batch = Number(opt('--batch', '25'));
  if (!Number.isInteger(batch) || batch < 1 || batch > 500) throw new Error('--batch doit être un entier entre 1 et 500');
  return { batch, local: argv.includes('--local'), retryFailed: argv.includes('--retry-failed') };
}

export async function openEnv(local: boolean) {
  const env = { DB: wranglerD1('crm-sda', local ? 'local' : 'remote'), LLM_MODEL: '' } as unknown as Env;
  return { env, cfg: await loadConfig(env) };
}

/** Ctrl+C : on termine l'entreprise en cours, puis on s'arrête (le job suivant reste à reprendre). */
export function stopSignal() {
  const state = { stop: false };
  process.on('SIGINT', () => {
    if (state.stop) process.exit(130);
    state.stop = true;
    console.log('\nArrêt demandé : fin de l’entreprise en cours, puis arrêt. (Ctrl+C encore pour couper net.)');
  });
  return state;
}
