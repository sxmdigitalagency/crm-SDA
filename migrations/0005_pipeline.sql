-- Pipeline commercial : une « affaire » par opportunité, liée à un client, qui avance d'étape en étape.
-- Elle existe avant le devis et peut ensuite pointer vers lui. Montant en centimes, devise propre à l'affaire.
CREATE TABLE deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  title TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'lead'
    CHECK (stage IN ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency IN ('EUR', 'USD')),
  expected_close_date TEXT,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  lost_reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL DEFAULT 0,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_deals_stage ON deals(stage, position);
CREATE INDEX idx_deals_client ON deals(client_id);
CREATE INDEX idx_deals_quote ON deals(quote_id);
