import { chromium } from "playwright";
import { runWithTimeout } from "./pipeline-utils.js";
import { redactText } from "./lib/redaction.js";
import type { LighthouseOpportunity, LighthouseReportData } from "./types.js";

export async function runLighthouseAudit(
  targetUrl: string,
  timeoutMs: number,
  signal: AbortSignal,
  validateRequestUrl?: (url: string) => Promise<unknown>
): Promise<LighthouseReportData> {
  let chrome: Awaited<ReturnType<(typeof import("chrome-launcher"))["launch"]>> | null = null;
  let cdpBrowser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  try {
    const lighthouseModule = await import("lighthouse");
    const chromeLauncher = await import("chrome-launcher");
    chrome = await chromeLauncher.launch({
      chromePath: chromium.executablePath(),
      chromeFlags: [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-component-update"
      ]
    });
    const activeChrome = chrome;
    if (validateRequestUrl) {
      cdpBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${activeChrome.port}`);
      const context = cdpBrowser.contexts()[0];
      if (!context) throw new Error("Não foi possível proteger o contexto do Lighthouse.");
      await context.route("**/*", async (route) => {
        const requestUrl = route.request().url();
        if (/^(?:data|blob|about):/i.test(requestUrl)) {
          await route.continue();
          return;
        }
        if (!/^https?:/i.test(requestUrl)) {
          await route.abort("blockedbyclient");
          return;
        }
        try {
          await validateRequestUrl(requestUrl);
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
    }
    const onAbort = () => {
      try {
        activeChrome.kill();
      } catch {
        // The browser process may already have exited.
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      const runnerResult = await runWithTimeout("Lighthouse", timeoutMs, signal, () =>
        lighthouseModule.default(targetUrl, {
          port: activeChrome.port,
          output: "json",
          logLevel: "error",
          onlyCategories: ["performance", "accessibility", "seo", "best-practices"],
          maxWaitForLoad: Math.min(timeoutMs, 45_000)
        })
      );
      const lhr = runnerResult?.lhr as Record<string, any> | undefined;
      if (!lhr) {
        throw new Error("O Lighthouse não produziu um relatório válido.");
      }
      const audits = (lhr.audits || {}) as Record<string, any>;
      const networkItems = Array.isArray(audits["network-requests"]?.details?.items)
        ? audits["network-requests"].details.items
        : [];

      const opportunities = Object.values(audits)
        .filter(
          (audit): audit is Record<string, any> =>
            typeof audit === "object" &&
            audit !== null &&
            typeof audit.score === "number" &&
            audit.score < 0.9 &&
            Boolean(audit.title)
        )
        .sort((left, right) => (left.score ?? 1) - (right.score ?? 1))
        .slice(0, 10)
        .map<LighthouseOpportunity>((audit) => ({
          id: String(audit.id),
          title: String(audit.title),
          description: String(audit.description || audit.explanation || ""),
          score: audit.score ?? null,
          displayValue: audit.displayValue ? String(audit.displayValue) : undefined
        }));

      return {
        status: "COMPLETED",
        scores: {
          performance: scoreToNumber(lhr.categories?.performance?.score),
          accessibility: scoreToNumber(lhr.categories?.accessibility?.score),
          seo: scoreToNumber(lhr.categories?.seo?.score),
          bestPractices: scoreToNumber(lhr.categories?.["best-practices"]?.score)
        },
        metrics: {
          firstContentfulPaint: audits["first-contentful-paint"]?.displayValue,
          largestContentfulPaint: audits["largest-contentful-paint"]?.displayValue,
          interactionToNextPaint: audits["interaction-to-next-paint"]?.displayValue,
          speedIndex: audits["speed-index"]?.displayValue,
          totalBlockingTime: audits["total-blocking-time"]?.displayValue,
          timeToInteractive: audits.interactive?.displayValue,
          cumulativeLayoutShift: audits["cumulative-layout-shift"]?.displayValue,
          totalByteWeight: audits["total-byte-weight"]?.displayValue,
          requestCount: networkItems.length
        },
        opportunities
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : error;
    }
    return emptyLighthouseReport(error);
  } finally {
    if (cdpBrowser) {
      await cdpBrowser.close().catch(() => undefined);
    }
    if (chrome) {
      try {
        chrome.kill();
      } catch {
        // The browser process may already have exited.
      }
    }
  }
}

export function emptyLighthouseReport(error?: unknown): LighthouseReportData {
  return {
    status: error ? "FAILED" : "SKIPPED",
    failureReason: error instanceof Error ? redactText(error.message).slice(0, 240) : undefined,
    scores: {
      performance: null,
      accessibility: null,
      seo: null,
      bestPractices: null
    },
    metrics: {},
    opportunities: []
  };
}

function scoreToNumber(score: number | null | undefined): number | null {
  return typeof score === "number" && Number.isFinite(score) ? Math.round(score * 100) : null;
}
