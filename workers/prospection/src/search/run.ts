// Recherche du site web (spec 4.2.1) pour une entreprise, en job idempotent (worker 'enrich', clé search:<id>).
// Écrit seulement : website_url, website_domain, website_status, website_match_reason, website_checked_at.
import type { Env } from '../env';
import type { ProspectConfig } from '../lib/config';
import { logger } from '../lib/log';
import { assertIn, cap, CAPS, WEBSITE_STATUSES } from '../lib/vocab';
import type { SearchProvider } from './provider';
import { chooseWebsite, type CompanyForSearch } from './select';

export interface ClaimedJob { id: number; company_id: number }

const ELIGIBLE = `c.stage = 'discovered' AND c.website_url IS NULL AND c.website_status = 'none' AND c.duplicate_of IS NULL`;

export async function claimSearchJobs(env: Env, limit: number, o: { retryFailed?: boolean } = {}): Promise<ClaimedJob[]> {
  const statuses = o.retryFailed ? `('queued', 'running', 'failed')` : `('queued', 'running')`;
  const resumed = (await env.DB.prepare(
    `SELECT j.id, j.company_id FROM prospect_jobs j JOIN prospect_companies c ON c.id = j.company_id
      WHERE j.worker = 'enrich' AND j.idem_key LIKE 'search:%' AND j.status IN ${statuses} AND ${ELIGIBLE}
      ORDER BY j.id LIMIT ?`).bind(limit).all<ClaimedJob>()).results;
  const remaining = limit - resumed.length;
  if (remaining <= 0) return resumed;
  const { results } = await env.DB.prepare(
    `SELECT c.id FROM prospect_companies c WHERE ${ELIGIBLE}
        AND NOT EXISTS (SELECT 1 FROM prospect_jobs j WHERE j.worker = 'enrich' AND j.idem_key = 'search:' || c.id)
      ORDER BY c.id LIMIT ?`).bind(remaining).all<{ id: number }>();
  if (!results.length) return resumed;
  const inserted = await env.DB.batch(results.map((r) =>
    env.DB.prepare(`INSERT INTO prospect_jobs (worker, idem_key, company_id) VALUES ('enrich', ?, ?)
                    ON CONFLICT (worker, idem_key) DO NOTHING RETURNING id, company_id`).bind(`search:${r.id}`, r.id)));
  return [...resumed, ...inserted.flatMap((r) => r.results as ClaimedJob[])];
}

export async function runSearch(env: Env, jobId: number, companyId: number, provider: SearchProvider, cfg: ProspectConfig): Promise<string> {
  const log = logger(env, 'enrich', jobId);
  const job = await env.DB.prepare(`SELECT status FROM prospect_jobs WHERE id = ?`).bind(jobId).first<{ status: string }>();
  if (!job || job.status === 'done') return 'skipped';
  await env.DB.prepare(`UPDATE prospect_jobs SET status = 'running', attempts = attempts + 1, started_at = datetime('now') WHERE id = ?`).bind(jobId).run();
  try {
    const company = await env.DB.prepare(`SELECT legal_name, dba_name, city, license_number FROM prospect_companies WHERE id = ?`)
      .bind(companyId).first<CompanyForSearch>();
    if (!company) throw new Error('entreprise introuvable');
    const choice = await chooseWebsite(company, provider, {
      excluded: cfg.searchExcludedDomains, maxCandidates: cfg.searchMaxCandidates, maxChecked: cfg.searchMaxChecked,
      crawl: { userAgent: cfg.crawlUserAgent, delayMs: cfg.crawlDelayMs, timeoutMs: cfg.crawlTimeoutMs, maxBytes: cfg.crawlMaxBytes },
    });
    const status = assertIn(WEBSITE_STATUSES, choice.status, 'website_status');
    const done = env.DB.prepare(`UPDATE prospect_jobs SET status = 'done', error = NULL, finished_at = datetime('now') WHERE id = ?`).bind(jobId);
    if (status === 'none') {
      await env.DB.batch([
        env.DB.prepare(`UPDATE prospect_companies SET website_checked_at = datetime('now'), stage = 'rejected', rejected_reason = 'no_website_found', updated_at = datetime('now') WHERE id = ? AND stage = 'discovered'`).bind(companyId),
        done,
      ]);
    } else {
      await env.DB.batch([
        env.DB.prepare(`UPDATE prospect_companies SET website_url = ?, website_domain = ?, website_status = ?, website_match_reason = ?, website_checked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
          .bind(cap(choice.url, CAPS.url), cap(choice.domain, CAPS.url), status, cap(choice.reason, CAPS.reason), companyId),
        done,
      ]);
    }
    await log.info('recherche du site', { companyId, status, checked: choice.checked });
    return status;
  } catch (err) {
    await env.DB.prepare(`UPDATE prospect_jobs SET status = 'failed', error = ? WHERE id = ?`).bind(cap(String(err), CAPS.text), jobId).run();
    await log.error('échec recherche', { companyId, error: cap(String(err), CAPS.text) });
    throw err;
  }
}
