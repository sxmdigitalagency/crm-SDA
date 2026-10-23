CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT 'SDA Digital Agency',
  company_address TEXT NOT NULL DEFAULT '',
  company_email TEXT NOT NULL DEFAULT '',
  company_phone TEXT NOT NULL DEFAULT '',
  company_website TEXT NOT NULL DEFAULT '',
  siret TEXT NOT NULL DEFAULT '',
  vat_number TEXT NOT NULL DEFAULT '',
  iban TEXT NOT NULL DEFAULT '',
  tax_label TEXT NOT NULL DEFAULT 'TVA',
  tax_rate REAL NOT NULL DEFAULT 20.0,
  tax_exempt_mention TEXT NOT NULL DEFAULT '',
  quote_prefix TEXT NOT NULL DEFAULT 'DEV',
  invoice_prefix TEXT NOT NULL DEFAULT 'FAC',
  quote_validity_days INTEGER NOT NULL DEFAULT 30,
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  quote_terms TEXT NOT NULL DEFAULT '',
  invoice_terms TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO settings (id, invoice_terms) VALUES (
  1,
  'En cas de retard de paiement, des pénalités seront appliquées au taux de 3 fois le taux d''intérêt légal, ainsi qu''une indemnité forfaitaire pour frais de recouvrement de 40 € (clients professionnels). Pas d''escompte pour paiement anticipé.'
);
CREATE TABLE counters (
  scope TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'pro' CHECK (type IN ('pro', 'particulier')),
  company_name TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT 'France',
  siret TEXT NOT NULL DEFAULT '',
  vat_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect', 'active', 'inactive')),
  anonymized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'Autre',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'forfait' CHECK (unit IN ('forfait', 'heure', 'jour', 'mois', 'unité')),
  unit_price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'converted')),
  issue_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  tax_rate REAL NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  invoice_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  quote_id INTEGER REFERENCES quotes(id),
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'cancelled')),
  issue_date TEXT,
  due_date TEXT,
  tax_rate REAL NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_type TEXT NOT NULL CHECK (document_type IN ('quote', 'invoice')),
  document_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'forfait',
  unit_price INTEGER NOT NULL DEFAULT 0,
  amount INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  paid_at TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'virement' CHECK (method IN ('virement', 'carte', 'especes', 'cheque', 'autre')),
  reference TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_quotes_client ON quotes(client_id);
CREATE INDEX idx_quotes_status ON quotes(status);
CREATE INDEX idx_quotes_issue ON quotes(issue_date);
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_issue ON invoices(issue_date);
CREATE INDEX idx_line_items_doc ON line_items(document_type, document_id, position);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_paid ON payments(paid_at);
INSERT INTO d1_migrations (name) VALUES ('0001_init.sql');
ALTER TABLE clients ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD'));
ALTER TABLE clients ADD COLUMN tax_rate REAL;
ALTER TABLE quotes ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD'));
ALTER TABLE invoices ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD'));
ALTER TABLE settings ADD COLUMN default_currency TEXT NOT NULL DEFAULT 'EUR' CHECK (default_currency IN ('EUR', 'USD'));
UPDATE settings SET tax_label = 'TGCA', tax_rate = 4.0 WHERE id = 1 AND tax_label = 'TVA' AND tax_rate = 20.0;
CREATE INDEX idx_quotes_currency ON quotes(currency);
CREATE INDEX idx_invoices_currency ON invoices(currency);
INSERT INTO d1_migrations (name) VALUES ('0002_currency_tgca.sql');
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip, at);
INSERT INTO d1_migrations (name) VALUES ('0003_login_attempts.sql');
ALTER TABLE settings ADD COLUMN owner_name TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN legal_form TEXT NOT NULL DEFAULT '';
UPDATE settings SET quote_terms =
'Validité : 30 jours à compter de la date d''émission.
Acompte : 40 % à la signature, solde à la livraison.
Paiement : virement bancaire, à 15 jours date de facture.
Retard de paiement : pénalités au taux de 3 fois le taux d''intérêt légal + indemnité forfaitaire de 40 € pour frais de recouvrement.
Propriété : le site et ses contenus sont cédés au client après paiement intégral.
Hors périmètre : toute demande non listée ci-dessus fera l''objet d''un devis complémentaire.'
WHERE id = 1 AND quote_terms = '';
UPDATE settings SET invoice_terms =
'Paiement : virement bancaire, à 15 jours date de facture.
Retard de paiement : pénalités au taux de 3 fois le taux d''intérêt légal + indemnité forfaitaire de 40 € pour frais de recouvrement.
Escompte : aucun escompte pour paiement anticipé.'
WHERE id = 1 AND (invoice_terms = '' OR substr(invoice_terms, 1, 29) = 'En cas de retard de paiement,');
UPDATE settings SET payment_terms_days = 15 WHERE id = 1 AND payment_terms_days = 30;
INSERT INTO d1_migrations (name) VALUES ('0004_pdf_identity.sql');
CREATE TABLE prospect_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE prospect_companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_number TEXT NOT NULL UNIQUE,
  license_class TEXT NOT NULL,
  trade TEXT NOT NULL CHECK (trade IN ('hvac', 'plumbing', 'roofing')),
  legal_name TEXT,
  dba_name TEXT,
  city TEXT,
  county TEXT,
  state TEXT NOT NULL DEFAULT 'FL',
  license_status TEXT,
  license_expiry TEXT,
  website_url TEXT,
  website_domain TEXT,
  website_checked_at TEXT,
  duplicate_of INTEGER REFERENCES prospect_companies(id),
  stage TEXT NOT NULL DEFAULT 'discovered' CHECK (stage IN (
    'discovered', 'enriched', 'qualified', 'drafted', 'approved', 'sent',
    'replied', 'closed', 'rejected', 'suppressed')),
  rejected_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_prospect_companies_stage ON prospect_companies(stage);
CREATE INDEX idx_prospect_companies_domain ON prospect_companies(website_domain);
CREATE TABLE prospect_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES prospect_companies(id),
  email TEXT,
  phone TEXT,
  source_url TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('generic', 'named')),
  verified_at TEXT,
  verification_result TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX uq_prospect_contacts_email ON prospect_contacts(company_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX uq_prospect_contacts_phone ON prospect_contacts(company_id, phone) WHERE email IS NULL;
CREATE TABLE prospect_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES prospect_companies(id),
  signal TEXT NOT NULL,
  value TEXT,
  source_url TEXT NOT NULL,
  excerpt TEXT CHECK (excerpt IS NULL OR length(excerpt) <= 200),
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, signal, source_url)
);
CREATE TABLE prospect_qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES prospect_companies(id),
  score INTEGER NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('ready', 'review', 'reject')),
  breakdown_json TEXT NOT NULL,
  rationale TEXT,
  best_evidence_id INTEGER REFERENCES prospect_evidence(id),
  red_flags_json TEXT,
  rubric_version TEXT NOT NULL,
  reviewer_verdict TEXT CHECK (reviewer_verdict IN ('agree', 'disagree')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (company_id, rubric_version)
);
CREATE TABLE prospect_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES prospect_companies(id),
  contact_id INTEGER REFERENCES prospect_contacts(id),
  direction TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  step INTEGER NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 2),
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'pending_approval', 'approved', 'sent', 'bounced', 'replied', 'rejected', 'received')),
  evidence_ids TEXT,
  reject_reason TEXT,
  provider_message_id TEXT UNIQUE,
  in_reply_to TEXT,
  thread_key TEXT,
  classification TEXT CHECK (classification IN (
    'interested', 'not_interested', 'unsubscribe', 'ooo', 'question', 'other')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  sent_at TEXT
);
CREATE INDEX idx_prospect_messages_status ON prospect_messages(status);
CREATE INDEX idx_prospect_messages_company ON prospect_messages(company_id);
CREATE INDEX idx_prospect_messages_thread ON prospect_messages(thread_key);
CREATE UNIQUE INDEX uq_prospect_messages_out_step ON prospect_messages(company_id, step) WHERE direction = 'out' AND status <> 'rejected';
CREATE TABLE prospect_suppression (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'domain')),
  value TEXT NOT NULL CHECK (value = lower(value)),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (kind, value)
);
CREATE TABLE prospect_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker TEXT NOT NULL CHECK (worker IN ('discover', 'enrich', 'qualify', 'draft', 'send', 'inbox', 'supervisor')),
  idem_key TEXT NOT NULL,
  company_id INTEGER REFERENCES prospect_companies(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (worker, idem_key)
);
CREATE INDEX idx_prospect_jobs_status ON prospect_jobs(worker, status);
CREATE TABLE prospect_llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker TEXT NOT NULL,
  job_id INTEGER REFERENCES prospect_jobs(id),
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  est_cost_usd REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE prospect_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  worker TEXT NOT NULL,
  job_id INTEGER,
  message TEXT NOT NULL,
  context_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_prospect_log_at ON prospect_log(created_at);
INSERT INTO prospect_config (key, value) VALUES
  ('target_license_classes', 'CAC,CFC,CCC'),
  ('license_class_trade', '{"CAC":"hvac","CFC":"plumbing","CCC":"roofing"}'),
  ('license_class_codes_verified', '0'),
  ('target_state', 'FL'),
  ('target_counties', 'Hillsborough,Orange,Duval'),
  ('message_language', 'en-US'),
  ('crawl_user_agent', 'SDA-Research-Bot/1.0 (+https://sxmdigitalagency.com)'),
  ('crawl_delay_ms', '2000'),
  ('crawl_max_pages', '6'),
  ('crawl_timeout_ms', '10000'),
  ('ai_answering_signals', '[]'),
  ('rubric_version', 'v0'),
  ('tier_ready_min', '60'),
  ('tier_review_min', '40'),
  ('draft_max_words', '90'),
  ('postal_address', ''),
  ('sending_enabled', '0'),
  ('auto_send_enabled', '0'),
  ('send_daily_start', '5'),
  ('send_daily_step', '5'),
  ('send_daily_cap', '30'),
  ('send_days', 'Mon,Tue,Wed,Thu'),
  ('send_timezone', 'America/New_York'),
  ('followup_days', '4,9'),
  ('stop_bounce_rate', '0.02'),
  ('stop_complaint_rate', '0.003'),
  ('test_total_sends', '150');
INSERT INTO d1_migrations (name) VALUES ('0005_prospection.sql');
