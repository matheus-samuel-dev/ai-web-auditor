import { describe, expect, it } from "vitest";
import type { ScoreTimelinePoint } from "../types";
import { statusColor, toScoreSeries } from "./DashboardPage";

describe("DashboardPage data mapping", () => {
  it("preserva score ausente como null sem confundir com zero medido", () => {
    const points: ScoreTimelinePoint[] = [
      {
        auditId: "missing",
        label: "Sem medição",
        createdAt: "2026-07-15T10:00:00Z",
        overallScore: null,
        performanceScore: null,
        accessibilityScore: null,
        seoScore: null,
        bestPracticesScore: null
      },
      {
        auditId: "zero",
        label: "Zero real",
        createdAt: "2026-07-15T11:00:00Z",
        overallScore: 0,
        performanceScore: 0,
        accessibilityScore: 0,
        seoScore: 0,
        bestPracticesScore: 0
      }
    ];

    expect(toScoreSeries(points)).toEqual([
      { label: "Sem medição", overall: null, performance: null, accessibility: null },
      { label: "Zero real", overall: 0, performance: 0, accessibility: 0 }
    ]);
  });

  it("mantém cores semânticas estáveis independentemente da ordem do backend", () => {
    expect(statusColor("COMPLETED")).toBe("#34D399");
    expect(statusColor("FAILED")).toBe("#FB7185");
    expect(statusColor("CANCELLED")).toBe("#8295AD");
  });
});
