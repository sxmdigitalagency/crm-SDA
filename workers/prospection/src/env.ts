export interface Env {
  DB: D1Database;
  LLM_MODEL: string;
}

export type Worker = 'discover' | 'enrich' | 'qualify' | 'draft' | 'send' | 'inbox' | 'supervisor';
