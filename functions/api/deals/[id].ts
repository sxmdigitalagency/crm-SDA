import { checkClient, checkQuote, CLOSED, DEAL_SELECT, parseDeal } from '../../lib/deals';
import { error, json, readJson, toId } from '../../lib/http';
import type { Handler } from '../../lib/types';

export const onRequestGet: Handler = async ({ params, env }) => {
  const deal = await env.DB.prepare(`${DEAL_SELECT} WHERE d.id = ?`).bind(toId(params.id)).first();
  return deal ? json(deal) : error(404, 'Affaire introuvable');
};

export const onRequestPut: Handler = async ({ params, request, env }) => {
  const id = toId(params.id);
  const current = await env.DB.prepare('SELECT stage, client_id FROM deals WHERE id = ?').bind(id).first<{ stage: string; client_id: number }>();
  if (!current) return error(404, 'Affaire introuvable');
  const d = parseDeal(await readJson(request));
  if (d.client_id !== current.client_id) await checkClient(env.DB, d.client_id);
  await checkQuote(env.DB, d.quote_id, d.client_id);
  const stageChanged = d.stage !== current.stage;
  await env.DB.prepare(
    `UPDATE deals SET client_id=?, title=?, stage=?, amount=?, currency=?, expected_close_date=?, quote_id=?, lost_reason=?, notes=?,
       position = CASE WHEN ? THEN (SELECT COALESCE(MIN(position), 1) - 1 FROM deals WHERE stage = ?) ELSE position END,
       closed_at = CASE WHEN ? THEN COALESCE(closed_at, datetime('now')) ELSE NULL END,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(d.client_id, d.title, d.stage, d.amount, d.currency, d.expected_close_date, d.quote_id,
    d.stage === 'lost' ? d.lost_reason : '', d.notes, stageChanged ? 1 : 0, d.stage, CLOSED.includes(d.stage) ? 1 : 0, id).run();
  return json({ id });
};

export const onRequestDelete: Handler = async ({ params, env }) => {
  await env.DB.prepare('DELETE FROM deals WHERE id = ?').bind(toId(params.id)).run();
  return json({ deleted: true });
};
