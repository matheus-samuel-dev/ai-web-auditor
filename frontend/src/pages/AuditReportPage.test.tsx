import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { AuditReport } from "../types";
import {
  ScreenshotDialog,
  describeLighthouseMetric,
  executionStageIndex,
  formatCoverageFraction,
  resolveReportCoverage
} from "./AuditReportPage";

describe("AuditReportPage", () => {
  it.each([
    "BOOTING_PIPELINE",
    "ANALYZING_DESKTOP",
    "ANALYZING_MOBILE",
    "CHECKING_LINKS",
    "BUILDING_JSON",
    "BUILDING_PDF",
    "AUDITING_DESKTOP",
    "GENERATING_REPORT"
  ])("reconhece a etapa real %s", (stage) => {
    expect(executionStageIndex(stage)).toBeGreaterThanOrEqual(0);
  });

  it("abre o visualizador como diálogo, foca o fechamento e restaura o foco com Escape", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Abrir evidência</button>
          {open ? (
            <ScreenshotDialog
              preview={{ title: "Evidência desktop", detail: "1440 × 900", url: "blob:test-screenshot" }}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Abrir evidência" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Evidência desktop" });
    expect(dialog).toHaveAttribute("aria-describedby");

    const closeButton = screen.getByRole("button", { name: "Fechar evidência" });
    await waitFor(() => expect(closeButton).toHaveFocus());
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("classifica métricas reais e mantém explicação legível", () => {
    expect(describeLighthouseMetric("largestContentfulPaint", "4.5 s")).toMatchObject({
      label: "Largest Contentful Paint (LCP)",
      rating: { label: "Ruim", tone: "poor" }
    });
    expect(describeLighthouseMetric("cumulativeLayoutShift", "0.12").rating).toMatchObject({
      label: "Precisa melhorar"
    });
  });

  it("não inventa ações ignoradas ao usar cobertura persistida legada", () => {
    const report = {
      coverage: {
        pagesDiscovered: 2,
        pagesVisited: 1,
        pagesSkipped: 1,
        linksFound: 4,
        linksChecked: 3,
        interactionsDiscovered: 2,
        interactionsExecuted: 1,
        formsFound: 1,
        formsTested: 0,
        flowsCompleted: 0,
        flowsFailed: 0,
        findingsCount: 1,
        coveragePercent: 50,
        durationSeconds: 10,
        devices: [],
        viewports: []
      },
      reportData: {}
    } as unknown as AuditReport;

    expect(resolveReportCoverage(report)?.interactionsSkippedSafety).toBeNull();
  });

  it("não exibe denominador impossível enquanto a cobertura parcial é consolidada", () => {
    expect(formatCoverageFraction(1, 0)).toBe("1/—");
    expect(formatCoverageFraction(1, null)).toBe("1/—");
    expect(formatCoverageFraction(1, undefined)).toBe("1/—");
    expect(formatCoverageFraction(undefined, undefined)).toBe("0/0");
    expect(formatCoverageFraction(0, 0)).toBe("0/0");
    expect(formatCoverageFraction(2, 3)).toBe("2/3");
  });
});
