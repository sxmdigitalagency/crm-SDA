// Journalisation : console (visible dans `wrangler tail`) + table prospect_log (lisible depuis le CRM).
// Un échec d'écriture du journal ne doit jamais faire échouer le job qui journalise.
import type { Env, Worker } from '../env';
import { cap, CAPS } from './vocab';

type Level = 'debug' | 'info' | 'warn' | 'error';

export function logger(env: Env, worker: Worker, jobId?: number) {
  const write = async (level: Level, message: string, context?: Record<string, unknown>) => {
    const full = context ? JSON.stringify(context) : null;
    // JSON toujours valide : trop long, il est remplacé par un aperçu marqué comme tronqué.
    const ctx = full && full.length > CAPS.url ? JSON.stringify({ truncated: true, preview: cap(full, 900) }) : full;
    message = cap(message, CAPS.text)!;
    console[level === 'debug' ? 'log' : level](JSON.stringify({ level, worker, jobId, message, context }));
    try {
      await env.DB.prepare('INSERT INTO prospect_log (level, worker, job_id, message, context_json) VALUES (?, ?, ?, ?, ?)')
        .bind(level, worker, jobId ?? null, message, ctx).run();
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', worker, message: 'prospect_log inaccessible', error: String(err) }));
    }
  };
  return {
    debug: (m: string, c?: Record<string, unknown>) => write('debug', m, c),
    info: (m: string, c?: Record<string, unknown>) => write('info', m, c),
    warn: (m: string, c?: Record<string, unknown>) => write('warn', m, c),
    error: (m: string, c?: Record<string, unknown>) => write('error', m, c),
  };
}
