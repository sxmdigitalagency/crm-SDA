import { error, HttpError, json, toId } from '../../../lib/http';
import type { Handler } from '../../../lib/types';

/**
 * Crée une facture BROUILLON à partir du devis (le numéro de facture est attribué à l'émission).
 * Un seul batch D1 = une transaction : la garde sur le statut empêche toute double conversion.
 */
export const onRequestPost: Handler = async ({ params, env }) => {
  const id = toId(params.id);
  const q = await env.DB.prepare('SELECT status FROM quotes WHERE id = ?').bind(id).first<{ status: string }>();
  if (!q) return error(404, 'Devis introuvable');
  if (q.status === 'converted') throw new HttpError(409, 'Devis déjà converti');
  if (q.status === 'declined') throw new HttpError(409, 'Devis refusé : conversion impossible');

  const db = env.DB;
  await db.batch([
    db.prepare(
      `INSERT INTO invoices (client_id, quote_id, title, tax_rate, currency, discount, subtotal, tax_amount, total, notes)
       SELECT client_id, id, title, tax_rate, currency, discount, subtotal, tax_amount, total,
              CASE WHEN notes <> '' THEN notes ELSE 'Selon devis ' || number END
       FROM quotes WHERE id = ?1 AND status NOT IN ('converted', 'declined')`,
    ).bind(id),
    db.prepare(
      `UPDATE quotes SET status = 'converted', updated_at = datetime('now'),
         invoice_id = (SELECT MAX(id) FROM invoices WHERE quote_id = ?1)
       WHERE id = ?1 AND status NOT IN ('converted', 'declined')`,
    ).bind(id),
    db.prepare(
      `INSERT INTO line_items (document_type, document_id, position, service_id, description, details, quantity, unit, unit_price, amount)
       SELECT 'invoice', (SELECT invoice_id FROM quotes WHERE id = ?1), position, service_id, description, details, quantity, unit, unit_price, amount
       FROM line_items
       WHERE document_type = 'quote' AND document_id = ?1
         AND NOT EXISTS (SELECT 1 FROM line_items WHERE document_type = 'invoice' AND document_id = (SELECT invoice_id FROM quotes WHERE id = ?1))`,
    ).bind(id),
  ]);

  const row = await db.prepare('SELECT invoice_id FROM quotes WHERE id = ?').bind(id).first<{ invoice_id: number }>();
  return json({ invoice_id: row!.invoice_id }, { status: 201 });
};
