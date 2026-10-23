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
  enrichEnabled: boolean;
  enrichBatchSize: number;
  crawlPagePatterns: Record<string, string>;
  crawlMaxBytes: number;
  bookingWidgetHosts: string[];
  bookingTextPatterns: string[];
  chatWidgetHosts: string[];
  searchProvider: string;
  searchProviderTermsRead: boolean;
  searchEndpointVerified: boolean;
  searchEnabled: boolean;
  searchMaxCandidates: number;
  searchMaxChecked: number;
  searchExcludedDomains: string[];
  rubricWeights: Record<string, number>;
  rubricScoreMax: number;
  bookingTextOnlyCountsAsWidget: boolean;
  searchEndpointBase: string;
  /** null tant que Mathys ne l'a pas rempli d'après --probe : la recherche reste alors verrouillée. */
  searchResultFields: SearchResultFields | null;
}

export interface SearchResultFields { results_path: string; url: string; title: string }

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
    enrichEnabled: bool('enrich_enabled'),
    enrichBatchSize: num('enrich_batch_size'),
    crawlPagePatterns: json('crawl_page_patterns'),
    crawlMaxBytes: num('crawl_max_bytes'),
    bookingWidgetHosts: json('booking_widget_hosts'),
    bookingTextPatterns: json('booking_text_patterns'),
    chatWidgetHosts: json('chat_widget_hosts'),
    searchProvider: str('search_provider'),
    searchProviderTermsRead: bool('search_provider_terms_read'),
    searchEndpointVerified: bool('search_endpoint_verified'),
    searchEnabled: bool('search_enabled'),
    searchMaxCandidates: num('search_max_candidates'),
    searchMaxChecked: num('search_max_checked'),
    searchExcludedDomains: json('search_excluded_domains'),
    rubricWeights: json('rubric_weights'),
    rubricScoreMax: num('rubric_score_max'),
    bookingTextOnlyCountsAsWidget: bool('booking_text_only_counts_as_widget'),
    searchEndpointBase: str('search_endpoint_base'),
    searchResultFields: resultFields(str('search_result_fields')),
  };
}

/** Vide → null (non rempli). Rempli mais mal formé → erreur claire (jamais de valeur devinée). */
function resultFields(raw: string): SearchResultFields | null {
  if (raw.trim() === '') return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new ConfigError('prospect_config : « search_result_fields » n\'est pas du JSON valide'); }
  const o = v as Record<string, unknown>;
  for (const k of ['results_path', 'url', 'title'] as const) {
    if (typeof o?.[k] !== 'string' || !(o[k] as string).trim()) throw new ConfigError(`prospect_config : « search_result_fields.${k} » manquant ou vide`);
  }
  return { results_path: o.results_path as string, url: o.url as string, title: o.title as string };
}
