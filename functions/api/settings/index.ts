import { getSettings, parseCurrency } from '../../lib/documents';
import { HttpError, json, readJson, str } from '../../lib/http';
import type { Handler } from '../../lib/types';

const TEXT_FIELDS = [
  'company_name', 'owner_name', 'legal_form', 'company_address', 'company_email', 'company_phone', 'company_website',
  'siret', 'vat_number', 'iban', 'tax_label', 'tax_exempt_mention', 'quote_terms', 'invoice_terms',
] as const;

export const onRequestGet: Handler = async ({ env }) => json(await getSettings(env.DB));

export const onRequestPut: Handler = async ({ request, env }) => {
  const body = await readJson(request);
  const current = await getSettings(env.DB);

  const next = { ...current };
  for (const f of TEXT_FIELDS) if (f in body) next[f] = str(body[f], 4000);
  if ('quote_prefix' in body) next.quote_prefix = str(body.quote_prefix, 10).replace(/[^A-Za-z0-9]/g, '') || 'DEV';
  if ('invoice_prefix' in body) next.invoice_prefix = str(body.invoice_prefix, 10).replace(/[^A-Za-z0-9]/g, '') || 'FAC';

  next.default_currency = parseCurrency(body.default_currency, current.default_currency);
  const rate = Number(body.tax_rate ?? current.tax_rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new HttpError(400, 'Taux de taxe invalide');
  next.tax_rate = rate;
  for (const f of ['quote_validity_days', 'payment_terms_days'] as const) {
    const v = Number(body[f] ?? current[f]);
    if (!Number.isInteger(v) || v < 0 || v > 365) throw new HttpError(400, 'Délai invalide');
    next[f] = v;
  }

  await env.DB.prepare(
    `UPDATE settings SET company_name=?, owner_name=?, legal_form=?, company_address=?, company_email=?, company_phone=?, company_website=?,
       siret=?, vat_number=?, iban=?, tax_label=?, tax_rate=?, tax_exempt_mention=?, quote_prefix=?, invoice_prefix=?,
       quote_validity_days=?, payment_terms_days=?, quote_terms=?, invoice_terms=?, default_currency=?, updated_at=datetime('now')
     WHERE id = 1`,
  )
    .bind(
      next.company_name, next.owner_name, next.legal_form, next.company_address, next.company_email, next.company_phone, next.company_website,
      next.siret, next.vat_number, next.iban, next.tax_label, next.tax_rate, next.tax_exempt_mention,
      next.quote_prefix, next.invoice_prefix, next.quote_validity_days, next.payment_terms_days,
      next.quote_terms, next.invoice_terms, next.default_currency,
    )
    .run();
  return json(await getSettings(env.DB));
};
