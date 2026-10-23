export interface Env {
  DB: D1Database;
  ENRICH_QUEUE: Queue<EnrichMessage>;
  LLM_MODEL: string;
}

export type Worker = 'discover' | 'enrich' | 'qualify' | 'draft' | 'send' | 'inbox' | 'supervisor';

/** Un message de file = une entreprise à enrichir (le job porte l'idempotence). */
export interface EnrichMessage {
  jobId: number;
  companyId: number;
}
