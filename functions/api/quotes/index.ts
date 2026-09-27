import { CLIENT_LABEL_SQL, computeTotals, getSettings, lineStatements, nextNumber, normalizeLines } from '../../lib/documents';
import { addDays, HttpError, isoDate, json, readJson, str, today, toId } from '../../lib/http';
import type { Handler } from '../../lib/types';

export const onRequestGet: Handler = async ({ request, env }) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const q = str(url.searchParams.get('q'), 100);
  const where: string[] = [];
  const params: unknown[] = [];
  if (status && ['draft', 'sent', 'accepted', 'declined', 'converted'].includes(status)) { where.push('q.status = ?'); params.push(status); }
  if (q) { where.push(`(q.number LIKE ? OR q.title LIKE ? OR ${CLIENT_LABEL_SQL} LIKE ?)`); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const { results } = await env.DB.prepare(
    `SELECT q.id, q.number, q.title, q.status, q.issue_date, q.valid_until, q.subtotal, q.total, q.client_id, q.invoice_id,
       ${CLIENT_LABEL_SQL} AS client_label,
       CASE WHEN q.status = 'sent' AND q.valid_until < date('now') THEN 1 ELSE 0 END AS expired
     FROM quotes q JOIN clients c ON c.id = q.client_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY q.issue_date DESC, q.id DESC LIMIT 500`,
  ).bind(...params).all();
  return json(results);
};

export const onRequestPost: Handler = async ({ request, env }) => {
  const body = await readJson(request);
  const clientId = toId(body.client_id);
  const client = await env.DB.prepare('SELECT anonymized_at FROM clients WHERE id = ?').bind(clientId).first<{ anonymized_at: string | null }>();
  if (!client) throw new HttpError(400, 'Client introuvable');
  if (client.anonymized_at) throw new HttpError(409, 'Client anonymisé');

  const settings = await getSettings(env.DB);
  const issue = isoDate(body.issue_date, today());
  const validUntil = isoDate(body.valid_until, addDays(issue, settings.quote_validity_days));
  const lines = normalizeLines(body.lines);
  const discount = Math.max(0, Math.round(Number(body.discount) || 0));
  const totals = computeTotals(lines, settings.tax_rate, discount);
  const number = await nextNumber(env.DB, 'quote', settings.quote_prefix, issue);

  const row = await env.DB.prepare(
    `INSERT INTO quotes (number, client_id, title, issue_date, valid_until, tax_rate, discount, subtotal, tax_amount, total, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(number, clientId, str(body.title, 200), issue, validUntil, settings.tax_rate, discount,
    totals.subtotal, totals.tax_amount, totals.total, str(body.notes, 5000)).first<{ id: number }>();

  await env.DB.batch(lineStatements(env.DB, 'quote', row!.id, lines));
  return json({ id: row!.id, number }, { status: 201 });
};
