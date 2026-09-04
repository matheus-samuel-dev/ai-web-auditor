import type { FindingSeverity, LighthouseReportData } from "./types.js";

interface ResponsiveScreenshotCandidate {
  pageId: string;
  screenshotPath: string;
  viewport: {
    isMobile?: boolean;
  };
}

/**
 * Selects representative captures without ever presenting one device class as
 * the other. A missing root capture remains explicitly unavailable.
 */
export function selectRepresentativeScreenshotPaths(
  candidates: readonly ResponsiveScreenshotCandidate[],
  rootPageId: string
): { desktop: string; mobile: string } {
  const desktop = candidates.find(
    (candidate) => candidate.pageId === rootPageId && !candidate.viewport.isMobile && Boolean(candidate.screenshotPath)
  );
  const mobile = candidates.find(
    (candidate) => candidate.pageId === rootPageId && candidate.viewport.isMobile === true && Boolean(candidate.screenshotPath)
  );
  return {
    desktop: desktop?.screenshotPath || "",
    mobile: mobile?.screenshotPath || ""
  };
}

export function calculateOverallScore(lighthouse: LighthouseReportData): number | null {
  if (lighthouse.status !== "COMPLETED") return null;
  const values = Object.values(lighthouse.scores).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function lighthouseFindingSeverity(score: number): FindingSeverity {
  if (score < 50) return "CRITICAL";
  if (score < 70) return "HIGH";
  return "MEDIUM";
}
