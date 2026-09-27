import { CLIENT_LABEL_SQL, computeTotals, getLines, lineStatements, normalizeLines, parseCurrency, parseTaxRate, type Currency } from '../../lib/documents';
import { error, HttpError, isoDate, json, oneOf, readJson, str, toId } from '../../lib/http';
import type { Handler } from '../../lib/types';

interface QuoteRow { id: number; status: string; tax_rate: number; currency: Currency; issue_date: string; valid_until: string }

export async function loadQuote(db: D1Database, id: number) {
  const quote = await db.prepare(
    `SELECT q.*, ${CLIENT_LABEL_SQL} AS client_label FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.id = ?`,
  ).bind(id).first();
  if (!quote) return null;
  return { ...quote, lines: await getLines(db, 'quote', id) };
}

export const onRequestGet: Handler = async ({ params, env }) => {
  const quote = await loadQuote(env.DB, toId(params.id));
  return quote ? json(quote) : error(404, 'Devis introuvable');
};

export const onRequestPut: Handler = async ({ params, request, env }) => {
  const id = toId(params.id);
  const existing = await env.DB.prepare('SELECT id, status, tax_rate, currency, issue_date, valid_until FROM quotes WHERE id = ?').bind(id).first<QuoteRow>();
  if (!existing) return error(404, 'Devis introuvable');
  if (existing.status === 'converted') throw new HttpError(409, 'Devis converti en facture : non modifiable');

  const body = await readJson(request);
  // Changement de statut seul (envoyé / accepté / refusé) sans toucher au contenu.
  if (body.status && !body.lines) {
    const status = oneOf(body.status, ['draft', 'sent', 'accepted', 'declined'] as const, existing.status as 'draft');
    await env.DB.prepare(`UPDATE quotes SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id).run();
    return json({ id, status });
  }

  const lines = normalizeLines(body.lines);
  const discount = Math.max(0, Math.round(Number(body.discount) || 0));
  const taxRate = parseTaxRate(body.tax_rate, existing.tax_rate);
  const currency = parseCurrency(body.currency, existing.currency);
  const totals = computeTotals(lines, taxRate, discount);
  const status = oneOf(body.status, ['draft', 'sent', 'accepted', 'declined'] as const, existing.status as 'draft');
  const clientId = toId(body.client_id);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE quotes SET client_id=?, title=?, status=?, issue_date=?, valid_until=?, tax_rate=?, currency=?, discount=?, subtotal=?, tax_amount=?, total=?, notes=?,
         updated_at=datetime('now') WHERE id=?`,
    ).bind(clientId, str(body.title, 300), status, isoDate(body.issue_date, existing.issue_date),
      isoDate(body.valid_until, existing.valid_until), taxRate, currency, discount, totals.subtotal, totals.tax_amount, totals.total,
      str(body.notes, 5000), id),
    ...lineStatements(env.DB, 'quote', id, lines),
  ]);
  return json({ id });
};

export const onRequestDelete: Handler = async ({ params, env }) => {
  const id = toId(params.id);
  const q = await env.DB.prepare('SELECT status FROM quotes WHERE id = ?').bind(id).first<{ status: string }>();
  if (!q) return error(404, 'Devis introuvable');
  if (q.status === 'converted') throw new HttpError(409, 'Devis converti en facture : suppression impossible');
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM line_items WHERE document_type = 'quote' AND document_id = ?`).bind(id),
    env.DB.prepare('DELETE FROM quotes WHERE id = ?').bind(id),
  ]);
  return json({ deleted: true });
};
