import { getSettings } from '../../../lib/documents';
import { error, toId } from '../../../lib/http';
import { pdfResponse, renderPdf, type PdfLine } from '../../../lib/pdf';
import type { Handler } from '../../../lib/types';

export const onRequestGet: Handler = async ({ params, request, env }) => {
  const id = toId(params.id);
  const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(id).first<Record<string, any>>();
  if (!inv) return error(404, 'Facture introuvable');
  const [client, lines, settings] = await Promise.all([
    env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(inv.client_id).first<Record<string, string>>(),
    env.DB.prepare(`SELECT * FROM line_items WHERE document_type = 'invoice' AND document_id = ? ORDER BY position`).bind(id).all<PdfLine>(),
    getSettings(env.DB),
  ]);
  // Un brouillon n'a pas encore de numéro légal : le PDF est marqué comme tel.
  const number = inv.number ?? 'BROUILLON';
  const bytes = await renderPdf({
    kind: 'invoice', number, title: inv.title, issue_date: inv.issue_date, second_date: inv.due_date,
    tax_rate: inv.tax_rate, discount: inv.discount, subtotal: inv.subtotal, tax_amount: inv.tax_amount, total: inv.total,
    amount_paid: inv.amount_paid, notes: inv.notes, status: inv.status, client: client ?? {}, lines: lines.results,
  }, settings);
  return pdfResponse(bytes, `${inv.number ?? `brouillon-${id}`}.pdf`, new URL(request.url).searchParams.get('download') !== '1');
};
