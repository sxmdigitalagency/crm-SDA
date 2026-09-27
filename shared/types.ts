// Types partagés entre les Functions (serveur) et le rendu PDF (navigateur).
export type Currency = 'EUR' | 'USD';

export interface Settings {
  company_name: string;
  company_address: string;
  company_email: string;
  company_phone: string;
  company_website: string;
  owner_name: string;
  legal_form: string;
  siret: string;
  vat_number: string;
  iban: string;
  tax_label: string;
  tax_rate: number;
  default_currency: Currency;
  tax_exempt_mention: string;
  quote_prefix: string;
  invoice_prefix: string;
  quote_validity_days: number;
  payment_terms_days: number;
  quote_terms: string;
  invoice_terms: string;
}
