-- Prospection, phase 1 (enrich) : réglages du crawl et listes de détection, modifiables sans toucher au code.
-- Les listes de domaines sont un point de départ, à vérifier et compléter (aucune n'est exhaustive).
-- enrich_enabled = 0 : le cron du Worker ne met aucune entreprise en file tant que Mathys ne l'active pas.
INSERT OR IGNORE INTO prospect_config (key, value) VALUES
  ('enrich_enabled', '0'),
  ('enrich_batch_size', '10'),
  ('crawl_page_patterns', '{"contact":"^/contact","about":"^/about","services":"^/services","schedule":"^/schedule","book":"^/book"}'),
  ('crawl_max_bytes', '1500000'),
  ('booking_widget_hosts', '["calendly.com","acuityscheduling.com","housecallpro.com","getjobber.com","servicetitan.com","setmore.com","squareup.com/appointments"]'),
  ('booking_text_patterns', '["schedule service","schedule online","book online","book now","request service online"]'),
  ('chat_widget_hosts', '["tawk.to","intercom.io","intercomcdn.com","driftt.com","livechatinc.com","tidio.co","podium.com","birdeye.com","zdassets.com","usemessages.com","crisp.chat","olark.com"]');
