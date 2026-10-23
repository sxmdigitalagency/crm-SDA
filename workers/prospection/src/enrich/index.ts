// Étape enrich (spec 4.2) : une entreprise par job.
// Utilisée par le Worker (cron + file, désactivé tant que enrich_enabled = 0) et par le script local
// scripts/prospection/run-enrich.mjs, qui appelle exactement ces fonctions.
// Idempotent sans dépendre d'une transaction : preuves supprimées puis réécrites, stage mis à jour,
// job marqué « done » en dernier. Une interruption laisse le job non terminé : il est rejoué.
// Aucune écriture dans les tables du CRM.
import type { Env } from '../env';
import { loadConfig, type ProspectConfig } from '../lib/config';
import { logger } from '../lib/log';
import { assertIn, cap, CAPS, SIGNALS } from '../lib/vocab';
import { bareHost, crawlSite } from './crawl';
import { extractSignals } from './extract';

export const CRAWL_SIGNALS = [
  'phone_present', 'phone_value', 'email_public_present', 'has_contact_form', 'has_online_booking', 'has_chat_widget',
  'mentions_24_7_or_emergency', 'has_ads_tracking', 'has_ai_answering_signal', 'team_size_hint', 'locations_count',
] as const;

/** Entreprise prête pour enrich : site accepté (deux signaux), pas doublon, encore au stade « discovered ». */
const ELIGIBLE = `c.stage = 'discovered' AND c.website_url IS NOT NULL AND c.website_status = 'accepted' AND c.duplicate_of IS NULL`;

export interface ClaimedJob { id: number; company_id: number }

/**
 * Réserve jusqu'à `limit` jobs enrich.
 * resume = true (script local) : reprend d'abord les jobs interrompus (queued / running, et failed si retryFailed).
 * resume = false (cron) : seulement de nouveaux jobs, pour ne pas remettre en file un message déjà en file.
 */
export async function claimEnrichJobs(env: Env, limit: number, o: { resume: boolean; retryFailed?: boolean }): Promise<ClaimedJob[]> {
  const jobs: ClaimedJob[] = [];
  if (o.resume) {
    const statuses = o.retryFailed ? `('queued', 'running', 'failed')` : `('queued', 'running')`;
    const { results } = await env.DB.prepare(
      `SELECT j.id, j.company_id FROM prospect_jobs j JOIN prospect_companies c ON c.id = j.company_id
        WHERE j.worker = 'enrich' AND j.idem_key LIKE 'company:%' AND j.status IN ${statuses} AND ${ELIGIBLE}
        ORDER BY j.id LIMIT ?`).bind(limit).all<ClaimedJob>();
    jobs.push(...results);
  }
  const remaining = limit - jobs.length;
  if (remaining <= 0) return jobs;
  const { results } = await env.DB.prepare(
    `SELECT c.id FROM prospect_companies c
      WHERE ${ELIGIBLE}
        AND NOT EXISTS (SELECT 1 FROM prospect_jobs j WHERE j.worker = 'enrich' AND j.idem_key = 'company:' || c.id)
      ORDER BY c.id LIMIT ?`).bind(remaining).all<{ id: number }>();
  if (!results.length) return jobs;
  const inserted = await env.DB.batch(results.map((r) =>
    env.DB.prepare(`INSERT INTO prospect_jobs (worker, idem_key, company_id) VALUES ('enrich', ?, ?)
                    ON CONFLICT (worker, idem_key) DO NOTHING RETURNING id, company_id`).bind(`company:${r.id}`, r.id)));
  jobs.push(...inserted.flatMap((r) => r.results as ClaimedJob[]));
  return jobs;
}

/** Cron : met en file les entreprises prêtes, si enrich_enabled = 1. */
export async function enqueueEnrich(env: Env): Promise<number> {
  const cfg = await loadConfig(env);
  if (!cfg.enrichEnabled) return 0;
  const jobs = await claimEnrichJobs(env, cfg.enrichBatchSize, { resume: false });
  if (jobs.length) await env.ENRICH_QUEUE.sendBatch(jobs.map((j) => ({ body: { jobId: j.id, companyId: j.company_id } })));
  await logger(env, 'enrich').info('mise en file', { count: jobs.length });
  return jobs.length;
}

interface CompanyRow { id: number; license_number: string; website_url: string | null; website_status: string; stage: string }

/** Traite une entreprise. Lève une erreur en cas d'échec (la file ou le script décide de réessayer). */
export async function runEnrich(env: Env, jobId: number, companyId: number, cfg?: ProspectConfig): Promise<'done' | 'skipped'> {
  const log = logger(env, 'enrich', jobId);
  const job = await env.DB.prepare(`SELECT status FROM prospect_jobs WHERE id = ?`).bind(jobId).first<{ status: string }>();
  if (!job || job.status === 'done') return 'skipped';
  await env.DB.prepare(`UPDATE prospect_jobs SET status = 'running', attempts = attempts + 1, started_at = datetime('now') WHERE id = ?`).bind(jobId).run();

  try {
    cfg ??= await loadConfig(env);
    const company = await env.DB.prepare(`SELECT id, license_number, website_url, website_status, stage FROM prospect_companies WHERE id = ?`)
      .bind(companyId).first<CompanyRow>();
    if (!company?.website_url) throw new Error('entreprise introuvable ou sans site web');
    if (company.website_status !== 'accepted') throw new Error(`site non accepté (${company.website_status})`);
    const websiteUrl = cap(company.website_url, CAPS.url)!;

    // Dédoublonnage par domaine (4.1.2) : la licence importée en premier garde le contact.
    const domain = bareHost(new URL(websiteUrl).hostname);
    const keeper = await env.DB.prepare(
      `SELECT id FROM prospect_companies WHERE website_domain = ? AND id < ? AND duplicate_of IS NULL ORDER BY id LIMIT 1`)
      .bind(domain, company.id).first<{ id: number }>();
    if (keeper) {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO prospect_evidence (company_id, signal, value, source_url) VALUES (?, 'other_license', ?, ?)
                        ON CONFLICT (company_id, signal, source_url) DO NOTHING`).bind(keeper.id, company.license_number, `dbpr:${company.license_number}`),
        env.DB.prepare(`UPDATE prospect_companies SET website_domain = ?, duplicate_of = ?, stage = 'rejected', rejected_reason = 'duplicate_domain', updated_at = datetime('now') WHERE id = ?`)
          .bind(domain, keeper.id, company.id),
        doneJob(env, jobId),
      ]);
      await log.info('doublon de domaine', { companyId, keeper: keeper.id, domain });
      return 'done';
    }

    const crawl = await crawlSite(websiteUrl, {
      userAgent: cfg.crawlUserAgent, delayMs: cfg.crawlDelayMs, maxPages: cfg.crawlMaxPages,
      timeoutMs: cfg.crawlTimeoutMs, maxBytes: cfg.crawlMaxBytes, pagePatterns: cfg.crawlPagePatterns,
    });
    if (!crawl.pages.length) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE prospect_companies SET website_domain = ?, website_checked_at = datetime('now'), stage = 'rejected', rejected_reason = 'site_unreadable', updated_at = datetime('now') WHERE id = ?`).bind(domain, company.id),
        doneJob(env, jobId),
      ]);
      await log.warn('site illisible', { companyId, skipped: crawl.skipped.slice(0, 6) });
      return 'done';
    }

    // Valeurs venues du site : vocabulaire vérifié et plafonds appliqués avant toute écriture.
    const evidence = extractSignals(crawl.pages, cfg).map((e) => ({
      signal: assertIn(SIGNALS, e.signal, 'signal'),
      value: cap(e.value, CAPS.value),
      source_url: cap(e.source_url, CAPS.url)!,
      excerpt: cap(e.excerpt, CAPS.excerpt),
    }));
    const placeholders = CRAWL_SIGNALS.map(() => '?').join(', ');
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM prospect_evidence WHERE company_id = ? AND signal IN (${placeholders})`).bind(company.id, ...CRAWL_SIGNALS),
      ...evidence.map((e) => env.DB.prepare(`INSERT INTO prospect_evidence (company_id, signal, value, source_url, excerpt) VALUES (?, ?, ?, ?, ?)`)
        .bind(company.id, e.signal, e.value, e.source_url, e.excerpt)),
      env.DB.prepare(`UPDATE prospect_companies SET website_domain = ?, website_checked_at = datetime('now'), stage = 'enriched', updated_at = datetime('now') WHERE id = ? AND stage = 'discovered'`).bind(domain, company.id),
      doneJob(env, jobId),
    ]);
    await log.info('enrichie', { companyId, pages: crawl.pages.length, requests: crawl.requests, evidence: evidence.length, skipped: crawl.skipped.slice(0, 6) });
    return 'done';
  } catch (err) {
    await env.DB.prepare(`UPDATE prospect_jobs SET status = 'failed', error = ? WHERE id = ?`).bind(cap(String(err), CAPS.text), jobId).run();
    await log.error('échec', { companyId, error: cap(String(err), CAPS.text) });
    throw err;
  }
}

const doneJob = (env: Env, jobId: number) =>
  env.DB.prepare(`UPDATE prospect_jobs SET status = 'done', error = NULL, finished_at = datetime('now') WHERE id = ?`).bind(jobId);
