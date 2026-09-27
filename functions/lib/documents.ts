import { HttpError, str } from './http';

export type DocType = 'quote' | 'invoice';

export interface LineInput {
  service_id?: number | null;
  description?: string;
  details?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number; // centimes
}

export interface LineItem {
  service_id: number | null;
  description: string;
  details: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
}

export interface Totals {
  subtotal: number;
  tax_amount: number;
  total: number;
}

const UNITS = ['forfait', 'heure', 'jour', 'mois', 'unité'];

export function normalizeLines(input: unknown): LineItem[] {
  if (!Array.isArray(input)) return [];
  if (input.length > 200) throw new HttpError(400, 'Trop de lignes (200 max)');
  return input
    .map((raw: LineInput) => {
      const quantity = Number(raw.quantity ?? 1);
      const unit_price = Math.round(Number(raw.unit_price ?? 0));
      if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1e6) throw new HttpError(400, 'Quantité invalide');
      if (!Number.isFinite(unit_price) || Math.abs(unit_price) > 1e11) throw new HttpError(400, 'Prix unitaire invalide');
      const serviceId = raw.service_id ? Number(raw.service_id) : null;
      return {
        service_id: Number.isInteger(serviceId) && serviceId! > 0 ? serviceId : null,
        description: str(raw.description, 300),
        details: str(raw.details, 2000),
        quantity: Math.round(quantity * 1000) / 1000,
        unit: UNITS.includes(String(raw.unit)) ? String(raw.unit) : 'forfait',
        unit_price,
        amount: Math.round(quantity * unit_price),
      };
    })
    .filter((l) => l.description !== '');
}

export function computeTotals(lines: LineItem[], taxRate: number, discount: number): Totals {
  const gross = lines.reduce((sum, l) => sum + l.amount, 0);
  const subtotal = Math.max(0, gross - Math.max(0, discount));
  const tax_amount = Math.round((subtotal * taxRate) / 100);
  return { subtotal, tax_amount, total: subtotal + tax_amount };
}

export function lineStatements(db: D1Database, type: DocType, id: number, lines: LineItem[]): D1PreparedStatement[] {
  const insert = db.prepare(
    `INSERT INTO line_items (document_type, document_id, position, service_id, description, details, quantity, unit, unit_price, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return [
    db.prepare('DELETE FROM line_items WHERE document_type = ? AND document_id = ?').bind(type, id),
    ...lines.map((l, i) =>
      insert.bind(type, id, i, l.service_id, l.description, l.details, l.quantity, l.unit, l.unit_price, l.amount),
    ),
  ];
}

export async function getLines(db: D1Database, type: DocType, id: number) {
  const { results } = await db
    .prepare(
      `SELECT id, position, service_id, description, details, quantity, unit, unit_price, amount
       FROM line_items WHERE document_type = ? AND document_id = ? ORDER BY position`,
    )
    .bind(type, id)
    .all();
  return results;
}

/** Numéro séquentiel par année, incrémenté atomiquement (UPSERT ... RETURNING). */
export async function nextNumber(db: D1Database, type: DocType, prefix: string, date: string): Promise<string> {
  const year = date.slice(0, 4);
  const row = await db
    .prepare(
      `INSERT INTO counters (scope, value) VALUES (?, 1)
       ON CONFLICT(scope) DO UPDATE SET value = value + 1
       RETURNING value`,
    )
    .bind(`${type}:${year}`)
    .first<{ value: number }>();
  if (!row) throw new HttpError(500, 'Numérotation impossible');
  return `${prefix}-${year}-${String(row.value).padStart(4, '0')}`;
}

export interface Settings {
  company_name: string;
  company_address: string;
  company_email: string;
  company_phone: string;
  company_website: string;
  siret: string;
  vat_number: string;
  iban: string;
  tax_label: string;
  tax_rate: number;
  tax_exempt_mention: string;
  quote_prefix: string;
  invoice_prefix: string;
  quote_validity_days: number;
  payment_terms_days: number;
  quote_terms: string;
  invoice_terms: string;
}

export async function getSettings(db: D1Database): Promise<Settings> {
  const s = await db.prepare('SELECT * FROM settings WHERE id = 1').first<Settings>();
  if (!s) throw new HttpError(500, 'Paramètres introuvables — migration non appliquée ?');
  return s;
}

export const CLIENT_LABEL_SQL = `CASE WHEN c.company_name <> '' THEN c.company_name ELSE trim(c.first_name || ' ' || c.last_name) END`;
