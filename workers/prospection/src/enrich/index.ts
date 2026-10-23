// Étape enrich (spec 4.2) : une entreprise par message de file.
// Idempotent : les preuves issues du crawl sont remplacées en une seule transaction (batch D1),
// un job déjà terminé n'est pas rejoué. Aucune écriture dans les tables du CRM.
// La recherche du site web (4.2.1) attend le choix du moteur : seules les entreprises dont
// website_url est déjà renseigné sont traitées.
import type { Env } from '../env';
import { loadConfig, type ProspectConfig } from '../lib/config';
import { logger } from '../lib/log';
import { bareHost, crawlSite } from './crawl';
import { extractSignals } from './extract';

export const CRAWL_SIGNALS = [
  'phone_present', 'phone_value', 'email_public_present', 'has_contact_form', 'has_online_booking', 'has_chat_widget',
  'mentions_24_7_or_emergency', 'has_ads_tracking', 'has_ai_answering_signal', 'team_size_hint', 'locations_count',
] as const;

interface CompanyRow { id: number; license_number: string; website_url: string | null; stage: string; duplicate_of: number | null }

/** Cron : met en file les entreprises prêtes, si enrich_enabled = 1. Renvoie le nombre mis en file. */
export async function enqueueEnrich(env: Env): Promise<number> {
  const cfg = await loadConfig(env);
  if (!cfg.enrichEnabled) return 0;
  const { results } = await env.DB.prepare(
    `SELECT c.id FROM prospect_companies c
      WHERE c.stage = 'discovered' AND c.website_url IS NOT NULL AND c.duplicate_of IS NULL
        AND NOT EXISTS (SELECT 1 FROM prospect_jobs j WHERE j.worker = 'enrich' AND j.idem_key = 'company:' || c.id)
      ORDER BY c.id LIMIT ?`).bind(cfg.enrichBatchSize).all<{ id: number }>();
  if (!results.length) return 0;
  const inserted = await env.DB.batch(results.map((r) =>
    env.DB.prepare(`INSERT INTO prospect_jobs (worker, idem_key, company_id) VALUES ('enrich', ?, ?)
                    ON CONFLICT (worker, idem_key) DO NOTHING RETURNING id, company_id`).bind(`company:${r.id}`, r.id)));
  const jobs = inserted.flatMap((r) => (r.results as { id: number; company_id: number }[]));
  if (jobs.length) await env.ENRICH_QUEUE.sendBatch(jobs.map((j) => ({ body: { jobId: j.id, companyId: j.company_id } })));
  await logger(env, 'enrich').info('mise en file', { count: jobs.length });
  return jobs.length;
}

/** Consommateur de file : traite une entreprise. Lève une erreur pour que la file réessaie. */
export async function runEnrich(env: Env, jobId: number, companyId: number, cfg?: ProspectConfig): Promise<void> {
  const log = logger(env, 'enrich', jobId);
  const job = await env.DB.prepare(`SELECT status, attempts FROM prospect_jobs WHERE id = ?`).bind(jobId).first<{ status: string; attempts: number }>();
  if (!job || job.status === 'done') return;
  await env.DB.prepare(`UPDATE prospect_jobs SET status = 'running', attempts = attempts + 1, started_at = datetime('now') WHERE id = ?`).bind(jobId).run();

  try {
    cfg ??= await loadConfig(env);
    const company = await env.DB.prepare(`SELECT id, license_number, website_url, stage, duplicate_of FROM prospect_companies WHERE id = ?`)
      .bind(companyId).first<CompanyRow>();
    if (!company?.website_url) throw new Error('entreprise introuvable ou sans site web');

    // Dédoublonnage par domaine (4.1.2) : la licence importée en premier garde le contact.
    const domain = bareHost(new URL(company.website_url).hostname);
    const keeper = await env.DB.prepare(
      `SELECT id FROM prospect_companies WHERE website_domain = ? AND id <> ? AND duplicate_of IS NULL ORDER BY id LIMIT 1`)
      .bind(domain, company.id).first<{ id: number }>();
    if (keeper && keeper.id < company.id) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE prospect_companies SET website_domain = ?, duplicate_of = ?, stage = 'rejected', rejected_reason = 'duplicate_domain', updated_at = datetime('now') WHERE id = ?`)
          .bind(domain, keeper.id, company.id),
        env.DB.prepare(`INSERT INTO prospect_evidence (company_id, signal, value, source_url) VALUES (?, 'other_license', ?, ?)
                        ON CONFLICT (company_id, signal, source_url) DO NOTHING`).bind(keeper.id, company.license_number, `dbpr:${company.license_number}`),
        doneJob(env, jobId),
      ]);
      await log.info('doublon de domaine', { companyId, keeper: keeper.id, domain });
      return;
    }

    const crawl = await crawlSite(company.website_url, {
      userAgent: cfg.crawlUserAgent, delayMs: cfg.crawlDelayMs, maxPages: cfg.crawlMaxPages,
      timeoutMs: cfg.crawlTimeoutMs, maxBytes: cfg.crawlMaxBytes, pagePatterns: cfg.crawlPagePatterns,
    });
    if (!crawl.pages.length) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE prospect_companies SET website_domain = ?, website_checked_at = datetime('now'), stage = 'rejected', rejected_reason = 'site_unreadable', updated_at = datetime('now') WHERE id = ?`).bind(domain, company.id),
        doneJob(env, jobId),
      ]);
      await log.warn('site illisible', { companyId, skipped: crawl.skipped });
      return;
    }

    const evidence = extractSignals(crawl.pages, cfg);
    const placeholders = CRAWL_SIGNALS.map(() => '?').join(', ');
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM prospect_evidence WHERE company_id = ? AND signal IN (${placeholders})`).bind(company.id, ...CRAWL_SIGNALS),
      ...evidence.map((e) => env.DB.prepare(`INSERT INTO prospect_evidence (company_id, signal, value, source_url, excerpt) VALUES (?, ?, ?, ?, ?)`)
        .bind(company.id, e.signal, e.value, e.source_url, e.excerpt)),
      env.DB.prepare(`UPDATE prospect_companies SET website_domain = ?, website_checked_at = datetime('now'), stage = 'enriched', updated_at = datetime('now') WHERE id = ? AND stage = 'discovered'`).bind(domain, company.id),
      doneJob(env, jobId),
    ]);
    await log.info('enrichie', { companyId, pages: crawl.pages.length, requests: crawl.requests, evidence: evidence.length, skipped: crawl.skipped });
  } catch (err) {
    await env.DB.prepare(`UPDATE prospect_jobs SET status = 'failed', error = ? WHERE id = ?`).bind(String(err).slice(0, 500), jobId).run();
    await log.error('échec', { companyId, error: String(err) });
    throw err;
  }
}

const doneJob = (env: Env, jobId: number) =>
  env.DB.prepare(`UPDATE prospect_jobs SET status = 'done', error = NULL, finished_at = datetime('now') WHERE id = ?`).bind(jobId);
