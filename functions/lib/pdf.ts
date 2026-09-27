import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import type { Settings } from './documents';

export interface PdfLine {
  description: string;
  details: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
}

export interface PdfDocumentData {
  kind: 'quote' | 'invoice';
  number: string;
  title: string;
  issue_date: string | null;
  second_date: string | null; // validité (devis) ou échéance (facture)
  tax_rate: number;
  discount: number;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  notes: string;
  status: string;
  client: Record<string, string>;
  lines: PdfLine[];
}

const A4 = { w: 595.28, h: 841.89 };
const M = 48; // marge
const INK = rgb(0.09, 0.1, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.88, 0.89, 0.92);
const ACCENT = rgb(0.31, 0.27, 0.9);
const TINT = rgb(0.955, 0.953, 0.995);

/**
 * Les polices standard PDF n'encodent que WinAnsi : on remplace les espaces insécables
 * (produites par Intl fr-FR) et on retire tout caractère non encodable plutôt que de planter.
 */
function clean(text: string): string {
  return text
    .replace(/[   ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x0A\x20-\x7E¡-ÿ€ŒœŠšŸŽž]/g, '');
}

const money = (cents: number) =>
  clean(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100));
const qty = (n: number) => clean(new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n));
const date = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '-');

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= width) line = test;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderPdf(doc: PdfDocumentData, s: Settings): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const title = `${doc.kind === 'quote' ? 'Devis' : 'Facture'} ${doc.number}`;
  pdf.setTitle(title);
  pdf.setAuthor(s.company_name);
  pdf.setCreator('CRM SDA');

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M;

  const text = (t: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: typeof INK; align?: 'left' | 'right' } = {}) => {
    const size = o.size ?? 9.5;
    const font = o.font ?? regular;
    const str = clean(t);
    const dx = o.align === 'right' ? font.widthOfTextAtSize(str, size) : 0;
    page.drawText(str, { x: x - dx, y: yy, size, font, color: o.color ?? INK });
  };

  // ── En-tête ───────────────────────────────────────────────
  text(s.company_name, M, y - 14, { size: 17, font: bold, color: ACCENT });
  let hy = y - 32;
  for (const l of [s.company_address, [s.company_email, s.company_phone].filter(Boolean).join('  ·  '), s.company_website]
    .flatMap((v) => (v ? v.split('\n') : []))) {
    text(l, M, hy, { size: 8.5, color: MUTED });
    hy -= 12;
  }

  const right = A4.w - M;
  text(doc.kind === 'quote' ? 'DEVIS' : 'FACTURE', right, y - 14, { size: 20, font: bold, align: 'right' });
  text(doc.number, right, y - 32, { size: 10, font: bold, color: ACCENT, align: 'right' });
  text(`Date : ${date(doc.issue_date)}`, right, y - 47, { size: 8.5, color: MUTED, align: 'right' });
  text(`${doc.kind === 'quote' ? 'Valable jusqu\'au' : 'Échéance'} : ${date(doc.second_date)}`, right, y - 59, { size: 8.5, color: MUTED, align: 'right' });

  y = Math.min(hy, y - 59) - 24;

  // ── Bloc client ───────────────────────────────────────────
  const c = doc.client;
  const clientLines = [
    c.company_name,
    [c.first_name, c.last_name].filter(Boolean).join(' '),
    c.address,
    [c.postal_code, c.city].filter(Boolean).join(' '),
    c.country && c.country !== 'France' ? c.country : '',
    c.siret ? `SIRET ${c.siret}` : '',
    c.vat_number ? `TVA ${c.vat_number}` : '',
  ].flatMap((v) => (v ? v.split('\n') : []));
  const boxW = 240;
  const boxH = 26 + clientLines.length * 12;
  const boxX = A4.w - M - boxW;
  page.drawRectangle({ x: boxX, y: y - boxH, width: boxW, height: boxH, color: TINT });
  text(doc.kind === 'quote' ? 'DESTINATAIRE' : 'FACTURÉ À', boxX + 14, y - 16, { size: 7, font: bold, color: MUTED });
  clientLines.forEach((l, i) => text(l, boxX + 14, y - 30 - i * 12, { size: 9.5, font: i === 0 ? bold : regular }));
  y -= boxH + 26;

  if (doc.title) {
    for (const l of wrap(doc.title, bold, 12, A4.w - 2 * M)) {
      text(l, M, y, { size: 12, font: bold });
      y -= 16;
    }
    y -= 8;
  }

  // ── Tableau des lignes ────────────────────────────────────
  const cols = { desc: M, qty: 352, unit: 362, price: 462, amount: right };
  const descW = 250;

  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 8, width: A4.w - 2 * M, height: 22, color: INK });
    text('Désignation', cols.desc + 10, y, { size: 8, font: bold, color: rgb(1, 1, 1) });
    text('Qté', cols.qty, y, { size: 8, font: bold, color: rgb(1, 1, 1), align: 'right' });
    text('Unité', cols.unit, y, { size: 8, font: bold, color: rgb(1, 1, 1) });
    text('PU HT', cols.price, y, { size: 8, font: bold, color: rgb(1, 1, 1), align: 'right' });
    text('Montant HT', cols.amount - 10, y, { size: 8, font: bold, color: rgb(1, 1, 1), align: 'right' });
    y -= 26;
  };

  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M;
    text(`${title} (suite)`, M, y, { size: 9, font: bold, color: MUTED });
    y -= 24;
  };

  const ensure = (needed: number, withHeader = false) => {
    if (y - needed < M + 40) {
      newPage();
      if (withHeader) tableHeader();
    }
  };

  tableHeader();
  for (const line of doc.lines) {
    const descLines = wrap(line.description, bold, 9.5, descW);
    const detailLines = line.details ? wrap(line.details, regular, 8.5, descW) : [];
    const h = descLines.length * 13 + detailLines.length * 11 + 16;
    ensure(h, true);
    let ly = y;
    descLines.forEach((l) => { text(l, cols.desc + 10, ly, { font: bold }); ly -= 13; });
    detailLines.forEach((l) => { text(l, cols.desc + 10, ly, { size: 8.5, color: MUTED }); ly -= 11; });
    text(qty(line.quantity), cols.qty, y, { align: 'right' });
    text(line.unit, cols.unit, y, { color: MUTED });
    text(money(line.unit_price), cols.price, y, { align: 'right' });
    text(money(line.amount), cols.amount - 10, y, { font: bold, align: 'right' });
    y -= h;
    page.drawLine({ start: { x: M, y: y + 12 }, end: { x: right, y: y + 12 }, thickness: 0.5, color: RULE });
  }

  // ── Totaux ────────────────────────────────────────────────
  const gross = doc.lines.reduce((sum, l) => sum + l.amount, 0);
  const rows: [string, string, boolean?][] = [];
  if (doc.discount > 0) {
    rows.push(['Total HT avant remise', money(gross)]);
    rows.push(['Remise', `- ${money(doc.discount)}`]);
  }
  rows.push(['Total HT', money(doc.subtotal)]);
  if (doc.tax_rate > 0) rows.push([`${s.tax_label} ${qty(doc.tax_rate)} %`, money(doc.tax_amount)]);
  rows.push([doc.tax_rate > 0 ? 'Total TTC' : 'Total', money(doc.total), true]);
  if (doc.kind === 'invoice' && doc.amount_paid > 0) {
    rows.push(['Déjà réglé', `- ${money(doc.amount_paid)}`]);
    rows.push(['Reste à payer', money(doc.total - doc.amount_paid), true]);
  }

  ensure(rows.length * 18 + 30);
  y -= 8;
  const tx = 340;
  for (const [label, value, strong] of rows) {
    if (strong) {
      page.drawRectangle({ x: tx - 10, y: y - 7, width: right - tx + 10, height: 22, color: TINT });
      text(label, tx, y, { size: 10.5, font: bold });
      text(value, right - 10, y, { size: 10.5, font: bold, color: ACCENT, align: 'right' });
      y -= 24;
    } else {
      text(label, tx, y, { color: MUTED });
      text(value, right - 10, y, { align: 'right' });
      y -= 16;
    }
  }
  if (doc.tax_rate === 0 && s.tax_exempt_mention) {
    text(s.tax_exempt_mention, right - 10, y, { size: 8, color: MUTED, align: 'right' });
    y -= 14;
  }
  y -= 14;

  // ── Blocs de texte (notes, règlement, conditions) ─────────
  const block = (heading: string, body: string) => {
    if (!body.trim()) return;
    const lines = wrap(body, regular, 8.5, A4.w - 2 * M);
    ensure(20 + Math.min(lines.length, 4) * 11);
    text(heading, M, y, { size: 7.5, font: bold, color: MUTED });
    y -= 13;
    for (const l of lines) {
      ensure(11);
      text(l, M, y, { size: 8.5 });
      y -= 11;
    }
    y -= 12;
  };

  block('NOTES', doc.notes);
  if (doc.kind === 'invoice' && s.iban) block('RÈGLEMENT', `Virement bancaire - IBAN : ${s.iban}\nMerci d'indiquer la référence ${doc.number} dans le libellé.`);
  block('CONDITIONS', doc.kind === 'quote' ? s.quote_terms : s.invoice_terms);

  if (doc.kind === 'quote') {
    ensure(90);
    const sx = right - 220;
    page.drawRectangle({ x: sx, y: y - 70, width: 220, height: 78, borderColor: RULE, borderWidth: 1 });
    text('BON POUR ACCORD', sx + 12, y - 8, { size: 7.5, font: bold, color: MUTED });
    text('Date, signature et mention « Bon pour accord »', sx + 12, y - 22, { size: 7.5, color: MUTED });
  }

  // ── Pied de page sur chaque page ──────────────────────────
  const pages = pdf.getPages();
  const legal = [s.company_name, s.siret ? `SIRET ${s.siret}` : '', s.vat_number ? `TVA ${s.vat_number}` : ''].filter(Boolean).join('  ·  ');
  pages.forEach((p, i) => {
    page = p;
    page.drawLine({ start: { x: M, y: M - 6 }, end: { x: right, y: M - 6 }, thickness: 0.5, color: RULE });
    text(legal, M, M - 20, { size: 7.5, color: MUTED });
    text(`${i + 1} / ${pages.length}`, right, M - 20, { size: 7.5, color: MUTED, align: 'right' });
  });

  return pdf.save();
}

export function pdfResponse(bytes: Uint8Array, filename: string, inline: boolean): Response {
  return new Response(bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'cache-control': 'private, no-store',
    },
  });
}
