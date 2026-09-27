import { CLIENT_FIELDS, parseClient } from '../../lib/clients';
import { error, json, readJson, toId } from '../../lib/http';
import type { Handler } from '../../lib/types';

export const onRequestGet: Handler = async ({ params, env }) => {
  const id = toId(params.id);
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first();
  if (!client) return error(404, 'Client introuvable');
  const [quotes, invoices] = await Promise.all([
    env.DB.prepare('SELECT id, number, title, status, issue_date, valid_until, total FROM quotes WHERE client_id = ? ORDER BY issue_date DESC, id DESC').bind(id).all(),
    env.DB.prepare('SELECT id, number, title, status, issue_date, due_date, total, amount_paid FROM invoices WHERE client_id = ? ORDER BY COALESCE(issue_date, created_at) DESC, id DESC').bind(id).all(),
  ]);
  return json({ ...client, quotes: quotes.results, invoices: invoices.results });
};

export const onRequestPut: Handler = async ({ params, request, env }) => {
  const id = toId(params.id);
  const existing = await env.DB.prepare('SELECT anonymized_at FROM clients WHERE id = ?').bind(id).first<{ anonymized_at: string | null }>();
  if (!existing) return error(404, 'Client introuvable');
  if (existing.anonymized_at) return error(409, 'Client anonymisé : modification impossible');
  const c = parseClient(await readJson(request));
  const cols = ['type', 'status', ...CLIENT_FIELDS];
  await env.DB.prepare(
    `UPDATE clients SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
  ).bind(...cols.map((k) => c[k as keyof typeof c]), id).run();
  return json({ id });
};

/**
 * Sans document lié : suppression définitive.
 * Avec devis/factures : anonymisation (RGPD) — les pièces comptables doivent être conservées,
 * seules les données personnelles du contact sont effacées.
 */
export const onRequestDelete: Handler = async ({ params, env }) => {
  const id = toId(params.id);
  const refs = await env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM quotes WHERE client_id = ?1) + (SELECT COUNT(*) FROM invoices WHERE client_id = ?1) AS n',
  ).bind(id).first<{ n: number }>();

  if (!refs?.n) {
    await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(id).run();
    return json({ deleted: true });
  }
  await env.DB.prepare(
    `UPDATE clients SET first_name = '', last_name = 'Client anonymisé', email = '', phone = '', address = '',
       postal_code = '', notes = '', status = 'inactive', anonymized_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(id).run();
  return json({ anonymized: true });
};
