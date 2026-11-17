import { checkClient, checkQuote, DEAL_SELECT, parseDeal, CLOSED } from '../../lib/deals';
import { json, readJson, toId } from '../../lib/http';
import type { Handler } from '../../lib/types';

export const onRequestGet: Handler = async ({ request, env }) => {
  const client = new URL(request.url).searchParams.get('client');
  const stmt = client
    ? env.DB.prepare(`${DEAL_SELECT} WHERE d.client_id = ? ORDER BY d.closed_at IS NOT NULL, d.updated_at DESC`).bind(toId(client))
    : env.DB.prepare(`${DEAL_SELECT} ORDER BY d.stage, d.position, d.id DESC LIMIT 1000`);
  return json((await stmt.all()).results);
};

// Nouvelle affaire : en haut de sa colonne.
export const onRequestPost: Handler = async ({ request, env }) => {
  const d = parseDeal(await readJson(request));
  await checkClient(env.DB, d.client_id);
  await checkQuote(env.DB, d.quote_id, d.client_id);
  const row = await env.DB.prepare(
    `INSERT INTO deals (client_id, title, stage, amount, currency, expected_close_date, quote_id, lost_reason, notes, position, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MIN(position), 1) - 1 FROM deals WHERE stage = ?), ${CLOSED.includes(d.stage) ? "datetime('now')" : 'NULL'})
     RETURNING id`,
  ).bind(d.client_id, d.title, d.stage, d.amount, d.currency, d.expected_close_date, d.quote_id, d.lost_reason, d.notes, d.stage).first<{ id: number }>();
  return json({ id: row!.id }, { status: 201 });
};
