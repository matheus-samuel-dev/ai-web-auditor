import assert from "node:assert/strict";
import test from "node:test";
import { emptyLighthouseReport } from "./lighthouse-audit.js";
import {
  calculateOverallScore,
  lighthouseFindingSeverity,
  selectRepresentativeScreenshotPaths
} from "./report-utils.js";

test("falha do Lighthouse mantém scores indisponíveis em vez de inventar zero", () => {
  const report = emptyLighthouseReport(new Error("Lighthouse indisponível"));

  assert.equal(report.status, "FAILED");
  assert.deepEqual(report.scores, {
    performance: null,
    accessibility: null,
    seo: null,
    bestPractices: null
  });
  assert.equal(calculateOverallScore(report), null);
});

test("score geral usa somente categorias realmente medidas", () => {
  assert.equal(calculateOverallScore({
    status: "COMPLETED",
    scores: { performance: 80, accessibility: 90, seo: null, bestPractices: 70 },
    metrics: {},
    opportunities: []
  }), 80);
});

test("capturas representativas nunca usam mobile como desktop ou vice-versa", () => {
  const result = selectRepresentativeScreenshotPaths([
    { pageId: "PAGE-001", screenshotPath: "mobile.png", viewport: { isMobile: true } },
    { pageId: "PAGE-002", screenshotPath: "other-desktop.png", viewport: { isMobile: false } }
  ], "PAGE-001");

  assert.deepEqual(result, { desktop: "", mobile: "mobile.png" });
});

test("classificação Lighthouse contempla prioridade alta", () => {
  assert.equal(lighthouseFindingSeverity(35), "CRITICAL");
  assert.equal(lighthouseFindingSeverity(60), "HIGH");
  assert.equal(lighthouseFindingSeverity(75), "MEDIUM");
});
