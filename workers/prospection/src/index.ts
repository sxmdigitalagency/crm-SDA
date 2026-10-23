// Worker de prospection — phase 0 : point d'entrée vide.
// Les étapes (discover, enrich, qualify, draft, send, inbox, supervisor) arrivent une phase à la fois,
// chacune dans src/<étape>.ts, après validation de Mathys.
import type { Env } from './env';

export default {
  async fetch(): Promise<Response> {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(): Promise<void> {
    // Aucun cron n'est déclaré en phase 0.
  },
} satisfies ExportedHandler<Env>;
