import { CLIENT_LABEL_SQL, computeTotals, documentDefaults, lineStatements, normalizeLines } from '../../lib/documents';
import { json, readJson, str, toId } from '../../lib/http';
import type { Handler } from '../../lib/types';

export const onRequestGet: Handler = async ({ request, env }) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const q = str(url.searchParams.get('q'), 100);
  const where: string[] = [];
  const params: unknown[] = [];
  if (status === 'overdue') where.push(`i.status = 'issued' AND i.due_date < date('now')`);
  else if (status && ['draft', 'issued', 'paid', 'cancelled'].includes(status)) { where.push('i.status = ?'); params.push(status); }
  if (q) { where.push(`(i.number LIKE ? OR i.title LIKE ? OR ${CLIENT_LABEL_SQL} LIKE ?)`); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }

  const { results } = await env.DB.prepare(
    `SELECT i.id, i.number, i.title, i.status, i.issue_date, i.due_date, i.total, i.amount_paid, i.currency, i.client_id, i.quote_id,
       ${CLIENT_LABEL_SQL} AS client_label,
       CASE WHEN i.status = 'issued' AND i.due_date < date('now') THEN 1 ELSE 0 END AS overdue
     FROM invoices i JOIN clients c ON c.id = i.client_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE i.status WHEN 'draft' THEN 0 ELSE 1 END, COALESCE(i.issue_date, i.created_at) DESC, i.id DESC LIMIT 500`,
  ).bind(...params).all();
  return json(results);
};

export const onRequestPost: Handler = async ({ request, env }) => {
  const body = await readJson(request);
  const clientId = toId(body.client_id);
  const { currency, tax_rate } = await documentDefaults(env.DB, clientId, body);
  const lines = normalizeLines(body.lines);
  const discount = Math.max(0, Math.round(Number(body.discount) || 0));
  const totals = computeTotals(lines, tax_rate, discount);

  const row = await env.DB.prepare(
    `INSERT INTO invoices (client_id, title, tax_rate, currency, discount, subtotal, tax_amount, total, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(clientId, str(body.title, 200), tax_rate, currency, discount, totals.subtotal, totals.tax_amount, totals.total,
    str(body.notes, 5000)).first<{ id: number }>();
  await env.DB.batch(lineStatements(env.DB, 'invoice', row!.id, lines));
  return json({ id: row!.id }, { status: 201 });
};
