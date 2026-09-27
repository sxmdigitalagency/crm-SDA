import type { PdfDocumentData, PdfLine } from '../../shared/pdf/render';
import { getSettings } from './documents';
import { HttpError } from './http';

/** Données nécessaires au rendu PDF (effectué dans le navigateur). */
export async function pdfData(db: D1Database, kind: 'quote' | 'invoice', id: number) {
  const doc = kind === 'quote'
    ? await db.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<Record<string, any>>()
    : await db.prepare('SELECT i.*, q.number AS quote_number FROM invoices i LEFT JOIN quotes q ON q.id = i.quote_id WHERE i.id = ?').bind(id).first<Record<string, any>>();
  if (!doc) throw new HttpError(404, kind === 'quote' ? 'Devis introuvable' : 'Facture introuvable');
  const [client, lines, settings] = await Promise.all([
    db.prepare('SELECT * FROM clients WHERE id = ?').bind(doc.client_id).first<Record<string, string>>(),
    db.prepare('SELECT description, details, quantity, unit, unit_price, amount FROM line_items WHERE document_type = ? AND document_id = ? ORDER BY position')
      .bind(kind, id).all<PdfLine>(),
    getSettings(db),
  ]);
  // Un brouillon de facture n'a pas encore de numéro légal : le PDF est marqué comme tel.
  const number = doc.number ?? 'BROUILLON';
  const document: PdfDocumentData = {
    kind, currency: doc.currency, number, quote_number: doc.quote_number ?? null,
    title: doc.title, issue_date: doc.issue_date, second_date: kind === 'quote' ? doc.valid_until : doc.due_date,
    tax_rate: doc.tax_rate, discount: doc.discount, subtotal: doc.subtotal, tax_amount: doc.tax_amount, total: doc.total,
    amount_paid: kind === 'invoice' ? doc.amount_paid : 0, notes: doc.notes, status: doc.status,
    client: client ?? {}, lines: lines.results,
  };
  return { document, settings, filename: `${doc.number ?? `brouillon-${id}`}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_') };
}
