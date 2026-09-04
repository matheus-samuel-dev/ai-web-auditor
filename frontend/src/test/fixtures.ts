import type { AuditListItem, AuditReport } from "../types";

export function auditItem(overrides: Partial<AuditListItem> = {}): AuditListItem {
  return {
    id: "audit-1",
    url: "https://example.com",
    status: "COMPLETED",
    overallScore: 88,
    performanceScore: 84,
    accessibilityScore: 91,
    seoScore: 90,
    bestPracticesScore: 87,
    criticalIssues: 0,
    totalIssues: 2,
    progressPercent: 100,
    currentStage: "COMPLETED",
    statusMessage: null,
    createdAt: "2026-07-15T12:00:00Z",
    startedAt: "2026-07-15T12:00:01Z",
    finishedAt: "2026-07-15T12:05:00Z",
    failureReason: null,
    ...overrides
  };
}

export function auditReport(overrides: Partial<AuditReport> = {}): AuditReport {
  const availableArtifact = { status: "AVAILABLE" as const, url: "/api/assets/screenshot", message: "Disponível" };
  return {
    id: "audit-1",
    url: "https://example.com",
    status: "COMPLETED",
    overallScore: 88,
    performanceScore: 84,
    accessibilityScore: 91,
    seoScore: 90,
    bestPracticesScore: 87,
    progressPercent: 100,
    currentStage: "COMPLETED",
    statusMessage: null,
    aiSummary: null,
    failureReason: null,
    createdAt: "2026-07-15T12:00:00Z",
    startedAt: "2026-07-15T12:00:01Z",
    finishedAt: "2026-07-15T12:05:00Z",
    coverage: {
      pagesDiscovered: 1,
      pagesVisited: 1,
      pagesSkipped: 0,
      linksFound: 8,
      linksChecked: 8,
      interactionsDiscovered: 2,
      interactionsExecuted: 2,
      formsFound: 0,
      formsTested: 0,
      flowsCompleted: 0,
      flowsFailed: 0,
      findingsCount: 0,
      coveragePercent: 100,
      durationSeconds: 299,
      devices: ["desktop", "mobile-390"],
      viewports: []
    },
    desktopScreenshotUrl: "/api/assets/desktop",
    mobileScreenshotUrl: "/api/assets/mobile",
    pdfDownloadUrl: null,
    jsonDownloadUrl: null,
    csvDownloadUrl: null,
    desktopScreenshotArtifact: availableArtifact,
    mobileScreenshotArtifact: { ...availableArtifact, url: "/api/assets/mobile" },
    pdfArtifact: { status: "UNAVAILABLE", url: null, message: "Indisponível" },
    jsonArtifact: { status: "UNAVAILABLE", url: null, message: "Indisponível" },
    comparison: null,
    issues: [],
    brokenLinks: [],
    consoleErrors: [],
    reportData: {},
    ...overrides
  };
}
