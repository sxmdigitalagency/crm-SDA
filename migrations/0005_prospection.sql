-- Prospection US (spec « agents de prospection », phase 0) : tables préfixées prospect_.
-- Aucune donnée importée ici ; seule prospect_config reçoit les hypothèses de départ.

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

-- Hypothèses de départ (spec section 0, 4 et 7), modifiables sans toucher au code.
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
