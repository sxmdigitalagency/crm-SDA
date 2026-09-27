import { error, json, readJson, toId } from '../../lib/http';
import { parseService } from '../../lib/services';
import type { Handler } from '../../lib/types';

export const onRequestPut: Handler = async ({ params, request, env }) => {
  const id = toId(params.id);
  const s = parseService(await readJson(request));
  const res = await env.DB.prepare(
    `UPDATE services SET category=?, name=?, description=?, unit=?, unit_price=?, active=?, updated_at=datetime('now') WHERE id=?`,
  ).bind(s.category, s.name, s.description, s.unit, s.unit_price, s.active, id).run();
  if (!res.meta.changes) return error(404, 'Prestation introuvable');
  return json({ id });
};

// Les lignes de devis/factures copient description et prix : supprimer une prestation n'altère aucun document.
export const onRequestDelete: Handler = async ({ params, env }) => {
  await env.DB.prepare('DELETE FROM services WHERE id = ?').bind(toId(params.id)).run();
  return json({ deleted: true });
};
