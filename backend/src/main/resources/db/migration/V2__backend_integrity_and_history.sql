ALTER TABLE audits ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE audits
  ADD CONSTRAINT ck_audits_progress_percent CHECK (progress_percent BETWEEN 0 AND 100);
ALTER TABLE audits
  ADD CONSTRAINT ck_audits_coverage_percent CHECK (coverage_percent BETWEEN 0 AND 100);
ALTER TABLE audits
  ADD CONSTRAINT ck_audits_overall_score CHECK (overall_score IS NULL OR overall_score BETWEEN 0 AND 100);
ALTER TABLE audits
  ADD CONSTRAINT ck_audits_performance_score CHECK (performance_score IS NULL OR performance_score BETWEEN 0 AND 100);
ALTER TABLE audits
  ADD CONSTRAINT ck_audits_accessibility_score CHECK (accessibility_score IS NULL OR accessibility_score BETWEEN 0 AND 100);
ALTER TABLE audits
  ADD CONSTRAINT ck_audits_seo_score CHECK (seo_score IS NULL OR seo_score BETWEEN 0 AND 100);
ALTER TABLE audits
  ADD CONSTRAINT ck_audits_best_practices_score CHECK (best_practices_score IS NULL OR best_practices_score BETWEEN 0 AND 100);
ALTER TABLE audit_issues
  ADD CONSTRAINT ck_audit_issues_confidence CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100);

-- Explicit constraints also repair databases originally created by Hibernate before Flyway.
ALTER TABLE audits
  ADD CONSTRAINT fk_audits_project_v2 FOREIGN KEY (project_id) REFERENCES audit_projects(id);
ALTER TABLE audit_projects
  ADD CONSTRAINT fk_projects_baseline_audit FOREIGN KEY (baseline_audit_id) REFERENCES audits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audits_user_project_status_created
  ON audits(user_id, project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_user_score_created
  ON audits(user_id, overall_score, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_issues_audit_type
  ON audit_issues(audit_id, type);
