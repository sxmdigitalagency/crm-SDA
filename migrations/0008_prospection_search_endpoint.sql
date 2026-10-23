-- Prospection : URL de base de l'API Mojeek et champs de la réponse, en configuration.
-- search_endpoint_base : exemple du démarrage rapide Mojeek. La page « Request Parameters » donne
--   https://www.mojeek.com/search : contradiction non tranchée, à confirmer par --probe.
-- search_result_fields : vide tant que Mathys ne l'a pas rempli d'après une sonde réelle (--probe), au format
--   {"results_path":"chemin.vers.la.liste","url":"champ","title":"champ"}. Vide = recherche verrouillée.
-- Les verrous search_provider_terms_read et search_endpoint_verified ne sont pas modifiés (restent à 0).
INSERT OR IGNORE INTO prospect_config (key, value) VALUES
  ('search_endpoint_base', 'https://api.mojeek.com/search'),
  ('search_result_fields', '');
