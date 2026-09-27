export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD_HASH?: string;
}

export type Handler = PagesFunction<Env>;
