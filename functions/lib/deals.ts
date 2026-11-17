import { HttpError, isoDate, oneOf, str, toId } from './http';
import { CLIENT_LABEL_SQL } from './documents';

export const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];
export const CLOSED: readonly Stage[] = ['won', 'lost'];

/** Champs modifiables d'une affaire (création et édition complète). */
export function parseDeal(body: Record<string, unknown>) {
  const title = str(body.title, 200);
  if (!title) throw new HttpError(400, 'Intitulé de l’affaire requis');
  const amount = Math.round(Number(body.amount ?? 0));
  if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'Montant invalide');
  const close = str(body.expected_close_date, 10);
  return {
    client_id: toId(body.client_id),
    title,
    stage: oneOf(body.stage, STAGES, 'lead'),
    amount,
    currency: oneOf(body.currency, ['EUR', 'USD'] as const, 'EUR'),
    expected_close_date: close ? isoDate(close) : null,
    quote_id: body.quote_id ? toId(body.quote_id) : null,
    lost_reason: str(body.lost_reason, 300),
    notes: str(body.notes, 5000),
  };
}

export function parseStage(value: unknown): Stage {
  if (!STAGES.includes(value as Stage)) throw new HttpError(400, 'Étape inconnue');
  return value as Stage;
}

/** Liste des affaires avec le client et le devis lié (numéro, statut). */
export const DEAL_SELECT = `
  SELECT d.*, ${CLIENT_LABEL_SQL} AS client_label, q.number AS quote_number, q.status AS quote_status
    FROM deals d JOIN clients c ON c.id = d.client_id LEFT JOIN quotes q ON q.id = d.quote_id`;

/** Le devis lié doit appartenir au même client que l'affaire. */
export async function checkQuote(db: D1Database, quoteId: number | null, clientId: number) {
  if (!quoteId) return;
  const q = await db.prepare('SELECT client_id FROM quotes WHERE id = ?').bind(quoteId).first<{ client_id: number }>();
  if (!q) throw new HttpError(400, 'Devis lié introuvable');
  if (q.client_id !== clientId) throw new HttpError(400, 'Le devis lié appartient à un autre client');
}

export async function checkClient(db: D1Database, clientId: number) {
  const c = await db.prepare('SELECT anonymized_at FROM clients WHERE id = ?').bind(clientId).first<{ anonymized_at: string | null }>();
  if (!c) throw new HttpError(400, 'Client introuvable');
  if (c.anonymized_at) throw new HttpError(400, 'Ce client a été anonymisé');
}
