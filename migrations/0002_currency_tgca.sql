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
