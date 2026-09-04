-- Idempotent bootstrap: safe for both fresh databases and the pre-Flyway Hibernate schema.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_projects (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  domain VARCHAR(255) NOT NULL,
  environment VARCHAR(40) NOT NULL DEFAULT 'PRODUCTION',
  frequency VARCHAR(40),
  default_config_json TEXT,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  baseline_audit_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audits (
  id UUID PRIMARY KEY,
  url VARCHAR(2048) NOT NULL,
  audit_mode VARCHAR(24) NOT NULL DEFAULT 'QUICK',
  status VARCHAR(20) NOT NULL,
  overall_score INTEGER,
  performance_score INTEGER,
  accessibility_score INTEGER,
  seo_score INTEGER,
  best_practices_score INTEGER,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  current_stage VARCHAR(80) NOT NULL DEFAULT 'QUEUED',
  status_message VARCHAR(500),
  current_page VARCHAR(2048),
  actions_executed INTEGER NOT NULL DEFAULT 0,
  findings_count INTEGER NOT NULL DEFAULT 0,
  elapsed_seconds INTEGER,
  estimated_remaining_seconds INTEGER,
  pages_discovered INTEGER NOT NULL DEFAULT 0,
  pages_visited INTEGER NOT NULL DEFAULT 0,
  pages_skipped INTEGER NOT NULL DEFAULT 0,
  links_found INTEGER NOT NULL DEFAULT 0,
  links_checked INTEGER NOT NULL DEFAULT 0,
  interactions_discovered INTEGER NOT NULL DEFAULT 0,
  interactions_executed INTEGER NOT NULL DEFAULT 0,
  forms_found INTEGER NOT NULL DEFAULT 0,
  forms_tested INTEGER NOT NULL DEFAULT 0,
  flows_completed INTEGER NOT NULL DEFAULT 0,
  flows_failed INTEGER NOT NULL DEFAULT 0,
  coverage_percent INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  devices_json TEXT,
  viewports_json TEXT,
  config_json TEXT,
  desktop_screenshot_path VARCHAR(1024),
  mobile_screenshot_path VARCHAR(1024),
  report_pdf_path VARCHAR(1024),
  ai_summary TEXT,
  report_data_json TEXT,
  failure_reason VARCHAR(1024),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  user_id UUID NOT NULL REFERENCES users(id),
  project_id UUID REFERENCES audit_projects(id)
);

CREATE TABLE IF NOT EXISTS audit_issues (
  id UUID PRIMARY KEY,
  evidence_id VARCHAR(80),
  type VARCHAR(30) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  validation_status VARCHAR(40) NOT NULL DEFAULT 'AUTOMATICALLY_VALIDATED',
  confidence INTEGER,
  title VARCHAR(240) NOT NULL,
  description TEXT,
  recommendation TEXT,
  source VARCHAR(80),
  page_url VARCHAR(2048),
  device VARCHAR(80),
  element VARCHAR(500),
  selector VARCHAR(500),
  screenshot_path VARCHAR(1024),
  reproduction_steps TEXT,
  expected_result TEXT,
  actual_result TEXT,
  impact TEXT,
  effort VARCHAR(80),
  technical_reference VARCHAR(1024),
  resolution_status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  resolution_comment TEXT,
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS broken_links (
  id UUID PRIMARY KEY,
  url VARCHAR(1024) NOT NULL,
  status_code INTEGER NOT NULL,
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS console_errors (
  id UUID PRIMARY KEY,
  message TEXT NOT NULL,
  type VARCHAR(60) NOT NULL,
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE
);

ALTER TABLE audits ADD COLUMN IF NOT EXISTS audit_mode VARCHAR(24) NOT NULL DEFAULT 'QUICK';
ALTER TABLE audits ADD COLUMN IF NOT EXISTS current_page VARCHAR(2048);
ALTER TABLE audits ADD COLUMN IF NOT EXISTS actions_executed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS findings_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS elapsed_seconds INTEGER;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS estimated_remaining_seconds INTEGER;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS pages_discovered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS pages_visited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS pages_skipped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS links_found INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS links_checked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS interactions_discovered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS interactions_executed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS forms_found INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS forms_tested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS flows_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS flows_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS coverage_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS devices_json TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS viewports_json TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS config_json TEXT;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS project_id UUID;

ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS evidence_id VARCHAR(80);
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS validation_status VARCHAR(40) NOT NULL DEFAULT 'AUTOMATICALLY_VALIDATED';
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS confidence INTEGER;
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS page_url VARCHAR(2048);
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS device VARCHAR(80);
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS element VARCHAR(500);
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS selector VARCHAR(500);
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS screenshot_path VARCHAR(1024);
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS reproduction_steps TEXT;
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS expected_result TEXT;
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS actual_result TEXT;
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS impact TEXT;
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS effort VARCHAR(80);
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS technical_reference VARCHAR(1024);
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS resolution_status VARCHAR(20) NOT NULL DEFAULT 'OPEN';
ALTER TABLE audit_issues ADD COLUMN IF NOT EXISTS resolution_comment TEXT;

CREATE INDEX IF NOT EXISTS idx_audits_user_created ON audits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_user_status ON audits(user_id, status);
CREATE INDEX IF NOT EXISTS idx_audits_project_created ON audits(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_recovery ON audits(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_audit_issues_audit_severity ON audit_issues(audit_id, severity);
CREATE INDEX IF NOT EXISTS idx_audit_issues_resolution ON audit_issues(audit_id, resolution_status);
CREATE INDEX IF NOT EXISTS idx_projects_user_archived ON audit_projects(user_id, archived);
