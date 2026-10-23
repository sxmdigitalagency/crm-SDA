// Worker de prospection. Une étape = un dossier dans src/ ; elles arrivent une phase à la fois.
// Phase 1 : enrich (crawl + extraction), désactivé tant que prospect_config.enrich_enabled = 0.
import type { EnrichMessage, Env } from './env';
import { enqueueEnrich, runEnrich } from './enrich';
import { loadConfig } from './lib/config';

export default {
  async fetch(): Promise<Response> {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_event, env): Promise<void> {
    await enqueueEnrich(env);
  },
  async queue(batch: MessageBatch<EnrichMessage>, env): Promise<void> {
    const cfg = await loadConfig(env);
    for (const msg of batch.messages) {
      try {
        await runEnrich(env, msg.body.jobId, msg.body.companyId, cfg);
        msg.ack();
      } catch {
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, EnrichMessage>;
