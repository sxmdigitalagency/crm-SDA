// Vocabulaires fermés : toute valeur écrite dans une colonne de ce type est vérifiée ici avant écriture.
// Une valeur inconnue fait échouer le job (on ne devine jamais).

export const STAGES = ['discovered', 'enriched', 'qualified', 'drafted', 'approved', 'sent', 'replied', 'closed', 'rejected', 'suppressed'] as const;
export const WEBSITE_STATUSES = ['none', 'accepted', 'review'] as const;
export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export const SIGNALS = [
  'phone_present', 'phone_value', 'email_public_present', 'has_contact_form', 'has_online_booking', 'has_chat_widget',
  'mentions_24_7_or_emergency', 'has_ads_tracking', 'has_ai_answering_signal', 'team_size_hint', 'locations_count',
  'other_license', 'license_inactive', 'license_absent_from_file',
] as const;
export const REJECT_REASONS = ['duplicate_domain', 'site_unreadable', 'no_website_found', 'license_inactive'] as const;

export class VocabError extends Error {}

export function assertIn<T extends string>(list: readonly T[], value: string, what: string): T {
  if (!(list as readonly string[]).includes(value)) throw new VocabError(`${what} inconnu : « ${value.slice(0, 60)} »`);
  return value as T;
}

/** Plafonds avant écriture (spec : extraits ≤ 200 caractères). */
export const CAPS = { excerpt: 200, url: 2000, value: 500, reason: 120, text: 500 } as const;

export function cap(s: string | null | undefined, max: number): string | null {
  if (s === null || s === undefined) return null;
  const chars = Array.from(s.replace(/\u0000/g, ''));
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}
