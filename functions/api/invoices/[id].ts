import { CLIENT_LABEL_SQL, computeTotals, getLines, getSettings, lineStatements, normalizeLines, parseCurrency, parseTaxRate, type Currency } from '../../lib/documents';
import { addDays, error, HttpError, isoDate, json, readJson, str, today, toId } from '../../lib/http';
import type { Handler } from '../../lib/types';

export async function loadInvoice(db: D1Database, id: number) {
  const invoice = await db.prepare(
    `SELECT i.*, ${CLIENT_LABEL_SQL} AS client_label, q.number AS quote_number,
       CASE WHEN i.status = 'issued' AND i.due_date < date('now') THEN 1 ELSE 0 END AS overdue
     FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN quotes q ON q.id = i.quote_id WHERE i.id = ?`,
  ).bind(id).first();
  if (!invoice) return null;
  const [lines, payments] = await Promise.all([
    getLines(db, 'invoice', id),
    db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at, id').bind(id).all(),
  ]);
  return { ...invoice, lines, payments: payments.results };
}

export const onRequestGet: Handler = async ({ params, env }) => {
  const invoice = await loadInvoice(env.DB, toId(params.id));
  return invoice ? json(invoice) : error(404, 'Facture introuvable');
};

/**
 * body.action :
 *  - absent  → mise à jour du contenu (brouillon uniquement)
 *  - 'issue' → émission : attribution du numéro définitif, figement du contenu
 *  - 'cancel'→ annulation d'une facture émise non payée (le numéro reste consommé)
 */
export const onRequestPut: Handler = async ({ params, request, env }) => {
  const id = toId(params.id);
  const db = env.DB;
  const inv = await db.prepare('SELECT status, tax_rate, currency, amount_paid FROM invoices WHERE id = ?').bind(id)
    .first<{ status: string; tax_rate: number; currency: Currency; amount_paid: number }>();
  if (!inv) return error(404, 'Facture introuvable');
  const body = await readJson(request);

  if (body.action === 'issue') {
    if (inv.status !== 'draft') throw new HttpError(409, 'Facture déjà émise');
    const lineCount = await db.prepare(`SELECT COUNT(*) AS n FROM line_items WHERE document_type = 'invoice' AND document_id = ?`).bind(id).first<{ n: number }>();
    if (!lineCount?.n) throw new HttpError(400, 'Impossible d\'émettre une facture sans ligne');
    const settings = await getSettings(db);
    const issue = isoDate(body.issue_date, today());
    const due = isoDate(body.due_date, addDays(issue, settings.payment_terms_days));
    const scope = `invoice:${issue.slice(0, 4)}`;
    // Compteur et numéro dans la même transaction : pas de numéro consommé sans facture.
    await db.batch([
      db.prepare(
        `INSERT INTO counters (scope, value) SELECT ?1, 1 FROM invoices WHERE id = ?2 AND status = 'draft'
         ON CONFLICT(scope) DO UPDATE SET value = value + 1`,
      ).bind(scope, id),
      db.prepare(
        `UPDATE invoices SET status = 'issued', issue_date = ?1, due_date = ?2, updated_at = datetime('now'),
           number = ?3 || '-' || ?4 || '-' || printf('%04d', (SELECT value FROM counters WHERE scope = ?5))
         WHERE id = ?6 AND status = 'draft'`,
      ).bind(issue, due, settings.invoice_prefix, issue.slice(0, 4), scope, id),
    ]);
    return json(await loadInvoice(db, id));
  }

  if (body.action === 'cancel') {
    if (inv.status !== 'issued') throw new HttpError(409, 'Seule une facture émise peut être annulée');
    if (inv.amount_paid > 0) throw new HttpError(409, 'Facture partiellement payée : supprimez d\'abord les paiements');
    await db.prepare(`UPDATE invoices SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).bind(id).run();
    return json(await loadInvoice(db, id));
  }

  if (inv.status !== 'draft') throw new HttpError(409, 'Facture émise : contenu figé');
  const lines = normalizeLines(body.lines);
  const discount = Math.max(0, Math.round(Number(body.discount) || 0));
  const taxRate = parseTaxRate(body.tax_rate, inv.tax_rate);
  const currency = parseCurrency(body.currency, inv.currency);
  const totals = computeTotals(lines, taxRate, discount);
  await db.batch([
    db.prepare(
      `UPDATE invoices SET client_id=?, title=?, tax_rate=?, currency=?, discount=?, subtotal=?, tax_amount=?, total=?, notes=?, updated_at=datetime('now')
       WHERE id=? AND status='draft'`,
    ).bind(toId(body.client_id), str(body.title, 200), taxRate, currency, discount, totals.subtotal, totals.tax_amount, totals.total, str(body.notes, 5000), id),
    ...lineStatements(db, 'invoice', id, lines),
  ]);
  return json(await loadInvoice(db, id));
};

export const onRequestDelete: Handler = async ({ params, env }) => {
  const id = toId(params.id);
  const inv = await env.DB.prepare('SELECT status, quote_id FROM invoices WHERE id = ?').bind(id).first<{ status: string; quote_id: number | null }>();
  if (!inv) return error(404, 'Facture introuvable');
  if (inv.status !== 'draft') throw new HttpError(409, 'Une facture émise ne peut pas être supprimée (annulez-la)');
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM line_items WHERE document_type = 'invoice' AND document_id = ?`).bind(id),
    env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(id),
    // Le devis d'origine redevient convertible.
    env.DB.prepare(`UPDATE quotes SET status = 'accepted', invoice_id = NULL, updated_at = datetime('now') WHERE invoice_id = ?`).bind(id),
  ]);
  return json({ deleted: true });
};
