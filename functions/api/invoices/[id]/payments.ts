import { error, HttpError, isoDate, json, oneOf, readJson, str, today, toId } from '../../../lib/http';
import type { Handler } from '../../../lib/types';

function recompute(db: D1Database, id: number) {
  return db.prepare(
    `UPDATE invoices SET
       amount_paid = COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = ?1), 0),
       status = CASE WHEN COALESCE((SELECT SUM(amount) FROM payments WHERE invoice_id = ?1), 0) >= total THEN 'paid' ELSE 'issued' END,
       updated_at = datetime('now')
     WHERE id = ?1`,
  ).bind(id);
}

export const onRequestPost: Handler = async ({ params, request, env }) => {
  const id = toId(params.id);
  const inv = await env.DB.prepare('SELECT status, total, amount_paid FROM invoices WHERE id = ?').bind(id)
    .first<{ status: string; total: number; amount_paid: number }>();
  if (!inv) return error(404, 'Facture introuvable');
  if (inv.status !== 'issued') throw new HttpError(409, 'Paiement possible uniquement sur une facture émise non soldée');

  const body = await readJson(request);
  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'Montant invalide');
  if (amount > inv.total - inv.amount_paid) throw new HttpError(400, 'Montant supérieur au reste à payer');

  await env.DB.batch([
    env.DB.prepare('INSERT INTO payments (invoice_id, amount, paid_at, method, reference) VALUES (?, ?, ?, ?, ?)')
      .bind(id, amount, isoDate(body.paid_at, today()),
        oneOf(body.method, ['virement', 'carte', 'especes', 'cheque', 'autre'] as const, 'virement'), str(body.reference, 200)),
    recompute(env.DB, id),
  ]);
  return json({ ok: true }, { status: 201 });
};

export const onRequestDelete: Handler = async ({ params, request, env }) => {
  const id = toId(params.id);
  const paymentId = toId(new URL(request.url).searchParams.get('payment'));
  const inv = await env.DB.prepare('SELECT status FROM invoices WHERE id = ?').bind(id).first<{ status: string }>();
  if (!inv) return error(404, 'Facture introuvable');
  if (inv.status === 'cancelled') throw new HttpError(409, 'Facture annulée');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM payments WHERE id = ? AND invoice_id = ?').bind(paymentId, id),
    recompute(env.DB, id),
  ]);
  return json({ ok: true });
};
