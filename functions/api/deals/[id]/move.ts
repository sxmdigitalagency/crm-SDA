import { CLOSED, parseStage } from '../../../lib/deals';
import { error, HttpError, json, readJson, toId } from '../../../lib/http';
import type { Handler } from '../../../lib/types';

/**
 * Glisser-déposer : { stage, order: [ids de la colonne cible, dans l'ordre, affaire déplacée comprise] }.
 * Change l'étape de l'affaire et renumérote la colonne cible en un seul lot.
 */
export const onRequestPost: Handler = async ({ params, request, env }) => {
  const id = toId(params.id);
  const body = await readJson(request);
  const stage = parseStage(body.stage);
  if (!Array.isArray(body.order) || body.order.length > 1000) throw new HttpError(400, 'Ordre invalide');
  const order = body.order.map(toId);
  if (!order.includes(id) || new Set(order).size !== order.length) throw new HttpError(400, 'Ordre invalide');

  const current = await env.DB.prepare('SELECT stage FROM deals WHERE id = ?').bind(id).first<{ stage: string }>();
  if (!current) return error(404, 'Affaire introuvable');
  const closed = CLOSED.includes(stage) ? 1 : 0;
  await env.DB.batch([
    env.DB.prepare(`UPDATE deals SET stage = ?, updated_at = datetime('now'),
        closed_at = CASE WHEN ? THEN COALESCE(closed_at, datetime('now')) ELSE NULL END,
        lost_reason = CASE WHEN ? = 'lost' THEN lost_reason ELSE '' END
      WHERE id = ?`).bind(stage, closed, stage, id),
    // Seules les affaires déjà dans la colonne cible sont renumérotées ; un id étranger est ignoré.
    ...order.map((dealId, i) => env.DB.prepare('UPDATE deals SET position = ? WHERE id = ? AND stage = ?').bind(i, dealId, stage)),
  ]);
  return json({ id, stage });
};
