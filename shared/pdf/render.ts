import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb, setCharacterSpacing } from 'pdf-lib';
import type { Settings } from '../types';

/**
 * Gabarit PDF « SXM Digital » : reproduit le modèle de devis de l'agence
 * (bandeau crème + logo, Archivo Black / Space Grotesk, vert pétrole et corail).
 * Coordonnées exprimées depuis le HAUT de la page (comme le modèle), converties pour pdf-lib.
 *
 * Exécuté dans le NAVIGATEUR (bundle public/js/vendor/pdf.js) : le sous-ensemblage des polices
 * coûte ~450 ms de CPU, bien au-delà des 10 ms de l'offre gratuite Cloudflare Workers.
 */

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
  currency: 'EUR' | 'USD';
  number: string;
  title: string;
  issue_date: string | null;
  second_date: string | null; // validité (devis) ou échéance (facture)
  quote_number?: string | null;
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

/** Fichiers binaires du gabarit (servis depuis public/assets/pdf). */
export interface PdfAssets {
  regular: Uint8Array;
  medium: Uint8Array;
  bold: Uint8Array;
  black: Uint8Array;
  logo: Uint8Array;
}

export const PDF_ASSET_PATHS: Record<keyof PdfAssets, string> = {
  regular: '/assets/pdf/space-grotesk-400.woff',
  medium: '/assets/pdf/space-grotesk-500.woff',
  bold: '/assets/pdf/space-grotesk-700.woff',
  black: '/assets/pdf/archivo-black.woff',
  logo: '/assets/pdf/logo.png',
};

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const TEAL = hex('#0E5E59');
const CORAL = hex('#FF6B5B');
const CREAM = hex('#FAF6EF');
const INK = hex('#1C1C1C');
const GREY = hex('#5D6664');
const RULE = hex('#E3DED1');

const PAGE = { w: 595.28, h: 841.89 };
const L = 45;
const R = PAGE.w - 45.5;
const FOOTER_TOP = PAGE.h - 37.4;
const CONTENT_BOTTOM = FOOTER_TOP - 14; // le modèle laisse ~23 pt au-dessus du pied de page

type Fonts = { regular: PDFFont; medium: PDFFont; bold: PDFFont; black: PDFFont };

interface TextOpts {
  font?: PDFFont;
  size?: number;
  color?: ReturnType<typeof rgb>;
  align?: 'left' | 'right';
  tracking?: number; // em
}

export async function renderPdf(doc: PdfDocumentData, s: Settings, assets: PdfAssets): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const isQuote = doc.kind === 'quote';
  const label = isQuote ? 'Devis' : 'Facture';
  pdf.setTitle(`${label} ${doc.number}`);
  pdf.setAuthor(s.company_name);
  pdf.setCreator('CRM SDA');
  pdf.setLanguage('fr-FR');

  // Sous-ensemble obligatoire : l'intégration complète de ces WOFF échoue dans fontkit.
  const fonts: Fonts = {
    regular: await pdf.embedFont(assets.regular, { subset: true }),
    medium: await pdf.embedFont(assets.medium, { subset: true }),
    bold: await pdf.embedFont(assets.bold, { subset: true }),
    black: await pdf.embedFont(assets.black, { subset: true }),
  };
  const logo: PDFImage = await pdf.embedPng(assets.logo);
  const charsets = new Map<PDFFont, Set<number>>();
  const charset = (f: PDFFont) => {
    if (!charsets.has(f)) charsets.set(f, new Set(f.getCharacterSet()));
    return charsets.get(f)!;
  };

  /** Remplace les caractères absents de la police (espaces fines d'Intl, etc.) plutôt que de planter. */
  const safe = (text: string, font: PDFFont) => {
    const set = charset(font);
    return [...String(text ?? '')]
      .map((c) => {
        const cp = c.codePointAt(0)!;
        if (set.has(cp)) return c;
        if (/[    ]/.test(c)) return set.has(0xa0) ? ' ' : ' ';
        if (c === '’' || c === '‘') return "'";
        if (c === '\t') return ' ';
        return '';
      })
      .join('');
  };

  const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: doc.currency });
  const money = (cents: number) => fmt.format(cents / 100);
  const qtyFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 });
  const date = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
  const UNIT_SHORT: Record<string, string> = { heure: 'h', jour: 'j', mois: 'mois' };

  let page: PDFPage = pdf.addPage([PAGE.w, PAGE.h]);
  const Y = (top: number) => PAGE.h - top;

  const width = (text: string, o: TextOpts = {}) => {
    const font = o.font ?? fonts.regular;
    const size = o.size ?? 9.5;
    const t = safe(text, font);
    return font.widthOfTextAtSize(t, size) + (o.tracking ?? 0) * size * Math.max(0, [...t].length - 1);
  };

  /** Texte posé sur sa ligne de base (coordonnée depuis le haut). Retourne la largeur dessinée. */
  const text = (str: string, x: number, baseline: number, o: TextOpts = {}) => {
    const font = o.font ?? fonts.regular;
    const size = o.size ?? 9.5;
    const t = safe(str, font);
    if (!t) return 0;
    const w = width(t, o);
    const cs = (o.tracking ?? 0) * size;
    if (cs) page.pushOperators(setCharacterSpacing(cs));
    page.drawText(t, { x: o.align === 'right' ? x - w : x, y: Y(baseline), size, font, color: o.color ?? INK });
    if (cs) page.pushOperators(setCharacterSpacing(0));
    return w;
  };

  const wrap = (str: string, maxWidth: number, o: TextOpts = {}): string[] => {
    const out: string[] = [];
    for (const para of String(str ?? '').split(/\r?\n/)) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (width(test, o) <= maxWidth || !line) line = test;
        else { out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  };

  /** Rectangle (optionnellement arrondi) défini depuis le haut de la page. */
  const box = (x: number, top: number, w: number, h: number, o: { fill?: ReturnType<typeof rgb>; stroke?: ReturnType<typeof rgb>; radius?: number; strokeWidth?: number } = {}) => {
    const r = Math.min(o.radius ?? 0, w / 2, h / 2);
    if (!r) {
      page.drawRectangle({ x, y: Y(top + h), width: w, height: h, color: o.fill, borderColor: o.stroke, borderWidth: o.stroke ? o.strokeWidth ?? 0.75 : 0 });
      return;
    }
    const path = `M ${x + r} ${top} H ${x + w - r} Q ${x + w} ${top} ${x + w} ${top + r} V ${top + h - r} Q ${x + w} ${top + h} ${x + w - r} ${top + h} H ${x + r} Q ${x} ${top + h} ${x} ${top + h - r} V ${top + r} Q ${x} ${top} ${x + r} ${top} Z`;
    page.drawSvgPath(path, { x: 0, y: PAGE.h, color: o.fill, borderColor: o.stroke, borderWidth: o.stroke ? o.strokeWidth ?? 0.75 : undefined });
  };
  const hline = (x1: number, x2: number, top: number, o: { dashed?: boolean; color?: ReturnType<typeof rgb>; thickness?: number } = {}) =>
    page.drawLine({ start: { x: x1, y: Y(top) }, end: { x: x2, y: Y(top) }, thickness: o.thickness ?? 0.75, color: o.color ?? RULE, dashArray: o.dashed ? [2, 2] : undefined });

  const SECTION: TextOpts = { font: fonts.black, size: 7.5, color: TEAL, tracking: 0.1 };

  // ── Bandeau d'en-tête (première page) ─────────────────────
  box(0, 0, PAGE.w, 127.5, { fill: CREAM });
  const logoH = 234.75 / (logo.width / logo.height);
  page.drawImage(logo, { x: L, y: Y(42.75 + logoH), width: 234.75, height: logoH });

  const title = isQuote ? 'DEVIS' : 'FACTURE';
  const dotW = width('.', { font: fonts.black, size: 30 });
  text('.', R, 51, { font: fonts.black, size: 30, color: CORAL, align: 'right' });
  text(title, R - dotW, 51, { font: fonts.black, size: 30, color: TEAL, align: 'right' });

  const meta: [string, string][] = [
    ['N°', doc.number],
    ['Date', date(doc.issue_date)],
    [isQuote ? 'Valable jusqu\'au' : 'Échéance', date(doc.second_date)],
  ];
  if (!isQuote && doc.quote_number) meta.push(['Réf. devis', doc.quote_number]);
  meta.forEach(([k, v], i) => {
    const base = 73.5 + i * 15;
    text(k, 477.3, base, { size: 9, color: GREY, align: 'right' });
    text(v, R, base, { font: fonts.bold, size: 9, align: 'right' });
  });

  // ── Émetteur / Client ─────────────────────────────────────
  const COL2 = 327.5;
  const oneLine = (...parts: (string | undefined)[]) => parts.map((p) => (p ?? '').trim()).filter(Boolean).join(', ');
  const emitter = [
    [s.owner_name, s.legal_form].map((p) => (p ?? '').trim()).filter(Boolean).join(' — '),
    oneLine(...(s.company_address ?? '').split(/\r?\n/)),
    s.siret ? `SIRET ${s.siret}` : '',
    s.vat_number ? `NIF (${s.tax_label}) : ${s.vat_number}` : '',
    [s.company_email, s.company_phone].filter(Boolean).join(' · '),
  ].filter(Boolean);

  const c = doc.client;
  const contact = [c.first_name, c.last_name].filter(Boolean).join(' ');
  const clientName = c.company_name || contact || 'Client';
  const localRegistry = !c.country || ['france', 'saint-martin'].includes(c.country.toLowerCase());
  const clientLines = [
    c.company_name && contact ? `À l'attention de ${contact}` : '',
    oneLine(c.address, [c.postal_code, c.city].filter(Boolean).join(' '), localRegistry ? '' : c.country),
    c.siret ? `${localRegistry ? 'SIRET' : 'Immatriculation'} : ${c.siret}` : '',
    c.vat_number ? `N° fiscal : ${c.vat_number}` : '',
    [c.email, c.phone].filter(Boolean).join(' · '),
  ].filter(Boolean);

  const party = (x: number, heading: string, name: string, lines: string[], maxW: number) => {
    text(heading, x, 154.5, SECTION);
    let base = 174.8;
    for (const l of wrap(name, maxW, { font: fonts.bold, size: 10.5 })) { text(l, x, base, { font: fonts.bold, size: 10.5 }); base += 13.4; }
    // « email · téléphone » trop long : une ligne chacun plutôt qu'un numéro coupé en deux.
    const fitted = lines.flatMap((line) => (line.includes(' · ') && width(line) > maxW ? line.split(' · ') : [line]));
    for (const line of fitted) for (const l of wrap(line, maxW)) { text(l, x, base); base += 13.8; }
    return base - 13.8;
  };
  const lastL = party(L, 'ÉMETTEUR', s.company_name, emitter, 312 - L - 12);
  const lastR = party(COL2, 'CLIENT', clientName, clientLines, R - COL2);
  const partiesBottom = Math.max(lastL, lastR) + 4;
  box(312, 147, 1.5, partiesBottom - 147, { fill: TEAL });

  let y = partiesBottom + 17;

  // ── Objet ─────────────────────────────────────────────────
  if (doc.title.trim()) {
    const prefix = 'Objet : ';
    const prefixW = width(prefix, { font: fonts.bold });
    const maxW = R - 59.5 - 14;
    // Première ligne raccourcie de la largeur du préfixe, suivantes pleine largeur.
    const words = doc.title.trim().split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      const avail = lines.length === 0 ? maxW - prefixW : maxW;
      if (width(test) <= avail || !line) line = test;
      else { lines.push(line); line = w; }
    }
    lines.push(line);
    const h = 18 + (lines.length - 1) * 14.2 + 12;
    box(L, y, R - L, h, { fill: CREAM, radius: 6 });
    text(prefix, 59.5, y + 18, { font: fonts.bold, color: TEAL });
    lines.forEach((l, i) => text(l, i === 0 ? 59.5 + prefixW : 59.5, y + 18 + i * 14.2));
    y += h + 14.2;
  }

  // ── Tableau des prestations ───────────────────────────────
  const COLS = { qtyEnd: 346.8, priceEnd: 447.5, totalEnd: R - 8.6, descX: 53.8, descW: 236 };
  const HEAD: TextOpts = { font: fonts.medium, size: 8.5, color: CREAM, tracking: 0.03 };
  const tableHeader = () => {
    box(L, y, R - L, 27, { fill: TEAL, radius: 5 });
    for (const x of [307.5, 355.5, 456]) page.drawLine({ start: { x, y: Y(y) }, end: { x, y: Y(y + 27) }, thickness: 0.75, color: CREAM, opacity: 0.18 });
    text('Désignation', COLS.descX, y + 16.6, HEAD);
    text('Qté', COLS.qtyEnd, y + 16.6, { ...HEAD, align: 'right' });
    text('Prix unit. HT', COLS.priceEnd, y + 16.6, { ...HEAD, align: 'right' });
    text('Total HT', COLS.totalEnd, y + 16.6, { ...HEAD, align: 'right' });
    y += 27;
  };

  const newPage = () => {
    page = pdf.addPage([PAGE.w, PAGE.h]);
    const w = text(`${title}`, L, 48, { font: fonts.black, size: 11, color: TEAL });
    text('.', L + w, 48, { font: fonts.black, size: 11, color: CORAL });
    text(`${doc.number} — suite`, L + w + 12, 48, { size: 9, color: GREY });
    y = 66;
  };
  const ensure = (h: number, header = false) => {
    if (y + h > CONTENT_BOTTOM) { newPage(); if (header) tableHeader(); }
  };

  tableHeader();
  for (const line of doc.lines) {
    const desc = wrap(line.description, COLS.descW);
    const details = line.details ? wrap(line.details, COLS.descW, { size: 8.3 }) : [];
    const h = 16.6 + (desc.length - 1) * 13.2 + details.length * 12 + (details.length ? 2.2 : 0) + 9.8 + 0.75;
    ensure(h, true);
    let base = y + 16.6;
    const first = base;
    desc.forEach((l, i) => { if (i) base += 13.2; text(l, COLS.descX, base); });
    details.forEach((l, i) => { base += i === 0 ? 14.2 : 12; text(l, COLS.descX, base, { size: 8.3, color: GREY }); });
    const unit = UNIT_SHORT[line.unit];
    text(`${qtyFmt.format(line.quantity)}${unit ? ` ${unit}` : ''}`, COLS.qtyEnd, first, { align: 'right' });
    text(money(line.unit_price), COLS.priceEnd, first, { align: 'right' });
    text(money(line.amount), COLS.totalEnd, first, { align: 'right' });
    y = base + 9.8;
    hline(L, R, y);
    y += 0.75;
  }

  // ── Notes (colonne gauche) + totaux (colonne droite) ──────
  const TX = 337.3;
  const gross = doc.lines.reduce((sum, l) => sum + l.amount, 0);
  const rows: [string, string][] = [];
  if (doc.discount > 0) { rows.push(['Sous-total HT', money(gross)], ['Remise', `− ${money(doc.discount)}`]); }
  rows.push(['Total HT', money(doc.subtotal)]);
  if (doc.tax_rate > 0) rows.push([`${s.tax_label} ${qtyFmt.format(doc.tax_rate)} %`, money(doc.tax_amount)]);
  const paidRows: [string, string][] = !isQuote && doc.amount_paid > 0
    ? [['Déjà réglé', `− ${money(doc.amount_paid)}`], ['Reste à payer', money(doc.total - doc.amount_paid)]]
    : [];
  const exempt = doc.tax_rate === 0 && s.tax_exempt_mention ? wrap(s.tax_exempt_mention, R - TX, { size: 8.3 }) : [];
  const notes = doc.notes.trim() ? wrap(doc.notes, 312 - L - 20, { size: 8.6 }) : [];
  const totalsH = 23.3 + (rows.length - 1) * 22.6 + 9 + 33.7 + paidRows.length * 20 + exempt.length * 11 + (exempt.length ? 6 : 0);
  const notesH = notes.length ? 30 + notes.length * 12.7 : 0;
  ensure(Math.max(totalsH, notesH));

  const top = y;
  if (notes.length) {
    text('NOTES', L, top + 23.3, SECTION);
    notes.forEach((l, i) => text(l, L, top + 41 + i * 12.7, { size: 8.6 }));
  }
  let base = top + 23.3;
  rows.forEach(([k, v], i) => {
    if (i) base += 22.6;
    text(k, TX, base, { color: GREY });
    text(v, R - 8.6, base, { color: GREY, align: 'right' });
  });
  const boxTop = base + 9;
  const BOX_X = 328.5;
  box(BOX_X, boxTop, R - BOX_X, 33.7, { fill: TEAL, radius: 5 });
  page.drawLine({ start: { x: 441.8, y: Y(boxTop) }, end: { x: 441.8, y: Y(boxTop + 33.7) }, thickness: 0.75, color: CREAM, opacity: 0.18 });
  const totalLabel = doc.tax_rate > 0 ? 'Total TTC' : 'Total';
  const tw = text(totalLabel, TX, boxTop + 21, { font: fonts.black, size: 12, color: CREAM, tracking: 0.006 });
  box(TX + tw + 2.8, boxTop + 15, 6, 6, { fill: CORAL });
  text(money(doc.total), R - 8.6, boxTop + 21, { font: fonts.black, size: 12, color: CREAM, align: 'right', tracking: 0.006 });
  base = boxTop + 33.7;
  paidRows.forEach(([k, v], i) => {
    base += 20;
    const strong = i === paidRows.length - 1;
    text(k, TX, base, { font: strong ? fonts.bold : fonts.regular, color: strong ? TEAL : GREY });
    text(v, R - 8.6, base, { font: strong ? fonts.bold : fonts.regular, color: strong ? TEAL : GREY, align: 'right' });
  });
  exempt.forEach((l, i) => text(l, R - 8.6, base + 14 + i * 11, { size: 8.3, color: GREY, align: 'right' }));
  y = top + Math.max(totalsH, notesH) + 17.6;

  // ── Conditions + Bon pour accord / Règlement ──────────────
  const terms = (isQuote ? s.quote_terms : s.invoice_terms) ?? '';
  const items = terms.split(/\r?\n/).map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = t.match(/^([^:]{1,40}?)\s*:\s*(.+)$/);
    return m ? { label: `${m[1]} :`, body: m[2]! } : { label: '', body: t };
  });
  const CW = 322.5 - L;
  const layoutItem = (it: { label: string; body: string }) => {
    const lw = it.label ? width(`${it.label} `, { font: fonts.bold, size: 8.6 }) : 0;
    const words = it.body.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      const avail = lines.length === 0 ? CW - lw : CW;
      if (width(test, { size: 8.6 }) <= avail || !line) line = test;
      else { lines.push(line); line = w; }
    }
    lines.push(line);
    return { lw, lines };
  };
  const laid = items.map((it) => ({ it, ...layoutItem(it) }));
  const condH = items.length ? 28.1 + laid.reduce((h, l, i) => h + (i ? 12.8 : 0) + (l.lines.length - 1) * 12.7 + 6, 0) : 0;

  const accord = isQuote
    ? { heading: 'BON POUR ACCORD', intro: 'Date, signature et cachet du client, précédés de la mention manuscrite « Bon pour accord ».', fields: ['Date :', 'Signature :'] }
    : {
        heading: 'RÈGLEMENT',
        intro: s.iban ? `Par virement bancaire sur le compte IBAN ${s.iban}.` : 'Coordonnées bancaires sur demande.',
        fields: [`Référence à indiquer : ${doc.number}`, `À régler avant le : ${date(doc.second_date)}`],
      };
  const AX = 345.4;
  const AW = R - 0.4 - AX;
  const introLines = wrap(accord.intro, AW - 28.8, { size: 8.3 });
  const accordMin = 19 + 18 + (introLines.length - 1) * 12 + 12 + 15 + (accord.fields.length - 1) * 24 + 30;
  const blockH = Math.max(condH, accordMin);
  ensure(blockH);
  const t0 = y;
  if (items.length) {
    text('CONDITIONS', L, t0 + 7.1, SECTION);
    let b = t0 + 28.1;
    laid.forEach((l, i) => {
      if (i) b += 12.8;
      if (l.it.label) text(l.it.label, L, b, { font: fonts.bold, size: 8.6, color: TEAL });
      l.lines.forEach((ln, j) => { if (j) b += 12.7; text(ln, j === 0 ? L + l.lw : L, b, { size: 8.6 }); });
      b += 6;
      hline(L, 322.5, b, { dashed: true });
    });
  }
  box(AX, t0, AW, blockH, { stroke: TEAL, radius: 6, strokeWidth: 0.75 });
  text(accord.heading, AX + 14.4, t0 + 19, SECTION);
  let ab = t0 + 37;
  introLines.forEach((l, i) => { if (i) ab += 12; text(l, AX + 14.4, ab, { size: 8.3, color: GREY }); });
  ab += 12;
  hline(AX + 14.6, AX + AW - 14.6, ab, { dashed: true });
  ab += 15;
  accord.fields.forEach((f, i) => { if (i) ab += 24; text(f, AX + 14.4, ab, { size: 8.3, color: GREY }); });
  y = t0 + blockH;

  // ── Pied de page (toutes les pages) ───────────────────────
  const pages = pdf.getPages();
  const legalTail = [s.legal_form, s.siret ? `SIRET ${s.siret}` : ''].filter(Boolean).join(' · ');
  pages.forEach((p, i) => {
    page = p;
    box(0, FOOTER_TOP, PAGE.w, PAGE.h - FOOTER_TOP, { fill: TEAL });
    const fb = FOOTER_TOP + 21;
    const w = text(s.company_name.toUpperCase(), L, fb, { font: fonts.black, size: 7.8, color: CREAM, tracking: 0.04 });
    if (legalTail) text(` · ${legalTail}`, L + w + 0.2, fb, { size: 7.8, color: CREAM });
    const right = [s.company_website, pages.length > 1 ? `${i + 1}/${pages.length}` : ''].filter(Boolean).join('   ');
    if (right) text(right, R, fb, { size: 7.8, color: CREAM, align: 'right' });
  });

  return pdf.save();
}
