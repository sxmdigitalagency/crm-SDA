import { getSettings } from '../../../lib/documents';
import { error, toId } from '../../../lib/http';
import { pdfResponse, renderPdf, type PdfLine } from '../../../lib/pdf';
import type { Handler } from '../../../lib/types';

export const onRequestGet: Handler = async ({ params, request, env }) => {
  const id = toId(params.id);
  const q = await env.DB.prepare('SELECT * FROM quotes WHERE id = ?').bind(id).first<Record<string, any>>();
  if (!q) return error(404, 'Devis introuvable');
  const [client, lines, settings] = await Promise.all([
    env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(q.client_id).first<Record<string, string>>(),
    env.DB.prepare(`SELECT * FROM line_items WHERE document_type = 'quote' AND document_id = ? ORDER BY position`).bind(id).all<PdfLine>(),
    getSettings(env.DB),
  ]);
  const bytes = await renderPdf({
    kind: 'quote', number: q.number, title: q.title, issue_date: q.issue_date, second_date: q.valid_until,
    tax_rate: q.tax_rate, discount: q.discount, subtotal: q.subtotal, tax_amount: q.tax_amount, total: q.total,
    amount_paid: 0, notes: q.notes, status: q.status, client: client ?? {}, lines: lines.results,
  }, settings);
  return pdfResponse(bytes, `${q.number}.pdf`, new URL(request.url).searchParams.get('download') !== '1');
};
