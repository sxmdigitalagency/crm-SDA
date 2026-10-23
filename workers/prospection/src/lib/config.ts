// Lecture typée de prospect_config. Une clé absente ou mal formée est une erreur : on ne devine jamais.
import type { Env } from '../env';

export interface ProspectConfig {
  targetLicenseClasses: string[];
  licenseClassTrade: Record<string, 'hvac' | 'plumbing' | 'roofing'>;
  licenseClassCodesVerified: boolean;
  targetState: string;
  targetCounties: string[];
  messageLanguage: string;
  crawlUserAgent: string;
  crawlDelayMs: number;
  crawlMaxPages: number;
  crawlTimeoutMs: number;
  aiAnsweringSignals: string[];
  rubricVersion: string;
  tierReadyMin: number;
  tierReviewMin: number;
  draftMaxWords: number;
  postalAddress: string;
  sendingEnabled: boolean;
  autoSendEnabled: boolean;
  sendDailyStart: number;
  sendDailyStep: number;
  sendDailyCap: number;
  sendDays: string[];
  sendTimezone: string;
  followupDays: number[];
  stopBounceRate: number;
  stopComplaintRate: number;
  testTotalSends: number;
}

export class ConfigError extends Error {}

export async function loadConfig(env: Env): Promise<ProspectConfig> {
  const { results } = await env.DB.prepare('SELECT key, value FROM prospect_config').all<{ key: string; value: string }>();
  const raw = new Map(results.map((r) => [r.key, r.value]));
  const str = (k: string) => {
    const v = raw.get(k);
    if (v === undefined) throw new ConfigError(`prospect_config : clé manquante « ${k} »`);
    return v;
  };
  const num = (k: string) => {
    const n = Number(str(k));
    if (!Number.isFinite(n)) throw new ConfigError(`prospect_config : « ${k} » n'est pas un nombre`);
    return n;
  };
  const bool = (k: string) => str(k) === '1';
  const list = (k: string) => str(k).split(',').map((s) => s.trim()).filter(Boolean);
  const json = <T>(k: string): T => {
    try { return JSON.parse(str(k)) as T; } catch { throw new ConfigError(`prospect_config : « ${k} » n'est pas du JSON valide`); }
  };

  return {
    targetLicenseClasses: list('target_license_classes'),
    licenseClassTrade: json('license_class_trade'),
    licenseClassCodesVerified: bool('license_class_codes_verified'),
    targetState: str('target_state'),
    targetCounties: list('target_counties'),
    messageLanguage: str('message_language'),
    crawlUserAgent: str('crawl_user_agent'),
    crawlDelayMs: num('crawl_delay_ms'),
    crawlMaxPages: num('crawl_max_pages'),
    crawlTimeoutMs: num('crawl_timeout_ms'),
    aiAnsweringSignals: json('ai_answering_signals'),
    rubricVersion: str('rubric_version'),
    tierReadyMin: num('tier_ready_min'),
    tierReviewMin: num('tier_review_min'),
    draftMaxWords: num('draft_max_words'),
    postalAddress: str('postal_address'),
    sendingEnabled: bool('sending_enabled'),
    autoSendEnabled: bool('auto_send_enabled'),
    sendDailyStart: num('send_daily_start'),
    sendDailyStep: num('send_daily_step'),
    sendDailyCap: num('send_daily_cap'),
    sendDays: list('send_days'),
    sendTimezone: str('send_timezone'),
    followupDays: list('followup_days').map(Number),
    stopBounceRate: num('stop_bounce_rate'),
    stopComplaintRate: num('stop_complaint_rate'),
    testTotalSends: num('test_total_sends'),
  };
}
