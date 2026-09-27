-- GÉNÉRÉ par scripts/build-d1-setup.mjs — ne pas modifier à la main.
-- À exécuter UNE SEULE FOIS sur une base D1 vide (console D1 du tableau de bord Cloudflare).
-- Ne contient aucune donnée de démonstration.

CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ── 0001_init.sql ───────────────────────────────────────────────
-- Schéma initial CRM SDA.
-- Tous les montants sont en CENTIMES (INTEGER) pour éviter les erreurs d'arrondi flottant.
-- Les taux de taxe sont en pourcentage (REAL, ex. 20.0).

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                       -- token opaque (hex 32 octets)
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
  tax_exempt_mention TEXT NOT NULL DEFAULT '', -- ex. « TVA non applicable, art. 293 B du CGI » si taux = 0
  quote_prefix TEXT NOT NULL DEFAULT 'DEV',
  invoice_prefix TEXT NOT NULL DEFAULT 'FAC',
  quote_validity_days INTEGER NOT NULL DEFAULT 30,
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  quote_terms TEXT NOT NULL DEFAULT '',        -- conditions affichées en pied de devis
  invoice_terms TEXT NOT NULL DEFAULT '',      -- mentions légales affichées en pied de facture
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO settings (id, invoice_terms) VALUES (
  1,
  'En cas de retard de paiement, des pénalités seront appliquées au taux de 3 fois le taux d''intérêt légal, ainsi qu''une indemnité forfaitaire pour frais de recouvrement de 40 € (clients professionnels). Pas d''escompte pour paiement anticipé.'
);

CREATE TABLE counters (
  scope TEXT PRIMARY KEY,                    -- ex. 'quote:2026', 'invoice:2026'
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
  anonymized_at TEXT,                        -- RGPD : données personnelles effacées, documents comptables conservés
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'Autre',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'forfait' CHECK (unit IN ('forfait', 'heure', 'jour', 'mois', 'unité')),
  unit_price INTEGER NOT NULL DEFAULT 0,     -- centimes HT
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,               -- DEV-2026-0001
  client_id INTEGER NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'converted')),
  issue_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  tax_rate REAL NOT NULL,                    -- figé à la création
  discount INTEGER NOT NULL DEFAULT 0,       -- remise globale HT en centimes
  subtotal INTEGER NOT NULL DEFAULT 0,       -- HT après remise
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,          -- TTC
  notes TEXT NOT NULL DEFAULT '',
  invoice_id INTEGER,                        -- facture issue de la conversion
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE,                        -- NULL tant que brouillon ; attribué à l'émission (numérotation continue)
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

-- Lignes communes aux devis et factures (document_type discrimine).
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
  unit_price INTEGER NOT NULL DEFAULT 0,     -- centimes HT
  amount INTEGER NOT NULL DEFAULT 0          -- round(quantity * unit_price)
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

-- ── 0002_currency_tgca.sql ──────────────────────────────────────
-- Devise par client et par document (EUR / USD), taux de taxe propre à un client,
-- et bascule du défaut vers la TGCA de Saint-Martin (4 %).

ALTER TABLE clients ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD'));
ALTER TABLE clients ADD COLUMN tax_rate REAL;          -- NULL = taux par défaut des paramètres

ALTER TABLE quotes ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD'));
ALTER TABLE invoices ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD'));

ALTER TABLE settings ADD COLUMN default_currency TEXT NOT NULL DEFAULT 'EUR' CHECK (default_currency IN ('EUR', 'USD'));

-- Seulement si l'utilisateur n'a pas déjà personnalisé la taxe.
UPDATE settings SET tax_label = 'TGCA', tax_rate = 4.0 WHERE id = 1 AND tax_label = 'TVA' AND tax_rate = 20.0;

CREATE INDEX idx_quotes_currency ON quotes(currency);
CREATE INDEX idx_invoices_currency ON invoices(currency);
INSERT INTO d1_migrations (name) VALUES ('0002_currency_tgca.sql');

-- ── 0003_login_attempts.sql ─────────────────────────────────────
-- Limitation des tentatives de connexion (par adresse IP).
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip, at);
INSERT INTO d1_migrations (name) VALUES ('0003_login_attempts.sql');
