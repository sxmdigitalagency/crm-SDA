-- Prospection, suite phase 1 : recherche du site web, suivi des imports DBPR, grille de score v0.
-- Colonnes AJOUTÉES uniquement (ALTER TABLE … ADD COLUMN) : aucune table n'est reconstruite ni copiée.

-- Résultat de la recherche du site : accepted (deux signaux) | review (un seul) | none (aucun candidat).
ALTER TABLE prospect_companies ADD COLUMN website_status TEXT NOT NULL DEFAULT 'none'
  CHECK (website_status IN ('none', 'accepted', 'review'));
-- Pourquoi l'URL a été retenue (les deux signaux vérifiés). Aucun résultat brut de recherche n'est stocké.
ALTER TABLE prospect_companies ADD COLUMN website_match_reason TEXT
  CHECK (website_match_reason IS NULL OR length(website_match_reason) <= 120);
-- Nombre d'imports consécutifs où la licence est introuvable dans tout le fichier DBPR.
ALTER TABLE prospect_companies ADD COLUMN absent_streak INTEGER NOT NULL DEFAULT 0 CHECK (absent_streak >= 0);
-- Dernier import qui a traité cette licence (empêche de compter deux fois le même import).
ALTER TABLE prospect_companies ADD COLUMN last_import_sha TEXT;

CREATE INDEX idx_prospect_companies_website_status ON prospect_companies(website_status);

CREATE TABLE prospect_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_sha256 TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  rows_read INTEGER NOT NULL,
  licenses_in_file INTEGER NOT NULL,
  matched INTEGER NOT NULL,
  absent INTEGER NOT NULL,
  status_changes INTEGER NOT NULL,
  forced INTEGER NOT NULL DEFAULT 0 CHECK (forced IN (0, 1)),
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO prospect_config (key, value) VALUES
  ('search_provider', 'mojeek'),
  ('search_provider_terms_read', '0'),
  ('search_enabled', '0'),
  ('search_endpoint_verified', '0'),
  ('search_max_candidates', '5'),
  ('search_max_checked', '3'),
  ('search_excluded_domains', '["yelp.com","facebook.com","fb.com","instagram.com","linkedin.com","bbb.org","angi.com","angieslist.com","homeadvisor.com","thumbtack.com","yellowpages.com","yp.com","manta.com","nextdoor.com","mapquest.com","google.com","goo.gl","youtube.com","tiktok.com","x.com","twitter.com","pinterest.com","houzz.com","porch.com","buildzoom.com","bizapedia.com","opencorporates.com","dnb.com","zoominfo.com","chamberofcommerce.com","myfloridalicense.com","sunbiz.org","indeed.com","glassdoor.com","nextinsurance.com","birdeye.com","superpages.com","citysearch.com","local.com","merchantcircle.com"]'),
  ('rubric_weights', '{"no_booking_and_no_chat":20,"phone_only_no_form":15,"no_24_7_mention":10,"ads_tracking":20,"team_3_to_25":15,"multi_city_service_area":5,"email_public_verified":0,"ai_answering_signal":-40}'),
  ('rubric_notes', 'v0 : email_public_verified = 0 jusqu''à la phase 1b (score maximal 85 au lieu de 100). has_online_booking = text_only compte comme « pas de widget ».'),
  ('rubric_score_max', '85'),
  ('booking_text_only_counts_as_widget', '0');
