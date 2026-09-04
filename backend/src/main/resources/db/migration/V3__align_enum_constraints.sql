-- Legacy installations created enum checks through Hibernate before Flyway
-- became authoritative. Keep those checks aligned with the current Java enums.
ALTER TABLE audits DROP CONSTRAINT IF EXISTS audits_status_check;
ALTER TABLE audits
  ADD CONSTRAINT audits_status_check
  CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'));

ALTER TABLE audit_issues DROP CONSTRAINT IF EXISTS audit_issues_severity_check;
ALTER TABLE audit_issues
  ADD CONSTRAINT audit_issues_severity_check
  CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'OPPORTUNITY', 'INFO'));

ALTER TABLE audit_issues DROP CONSTRAINT IF EXISTS audit_issues_type_check;
ALTER TABLE audit_issues
  ADD CONSTRAINT audit_issues_type_check
  CHECK (type IN (
    'PERFORMANCE', 'ACCESSIBILITY', 'SEO', 'BEST_PRACTICES', 'CONSOLE',
    'NETWORK', 'BROKEN_LINK', 'RESPONSIVE', 'VISUAL', 'UX_UI',
    'SECURITY', 'FUNCTIONAL', 'AI'
  ));
