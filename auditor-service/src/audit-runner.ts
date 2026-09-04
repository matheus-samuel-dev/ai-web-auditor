import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { resolveAuditConfiguration } from "./audit-config.js";
import {
  AuditCancelledError,
  AuditTimeoutError,
  createAuditRuntime,
  finishAuditRuntime,
  throwIfAborted,
  updateAuditRuntime
} from "./audit-runtime.js";
import { runBrowserAudit, type BrowserAuditResult, type SafetyDecision } from "./browser-audit.js";
import { runLighthouseAudit } from "./lighthouse-audit.js";
import { generateAiAnalysis } from "./openai.js";
import { generatePdfReport } from "./pdf-report.js";
import { createEvidenceIdFactory, mapWithConcurrency, runWithTimeout, type EvidenceIdFactory } from "./pipeline-utils.js";
import { reportAuditProgress } from "./progress.js";
import { calculateOverallScore, lighthouseFindingSeverity } from "./report-utils.js";
import { classifyActionSafety, evaluateActionPermission } from "./lib/action-safety.js";
import {
  assertExistingPathWithinRoot,
  normalizeArtifactRelativePath,
  resolvePathWithinRoot
} from "./lib/path-confinement.js";
import { redactText, redactUrl, toSafeErrorDetails } from "./lib/redaction.js";
import {
  assertSafeAuditUrl,
  fetchWithSsrfGuard,
  type SsrfGuardOptions
} from "./lib/ssrf-guard.js";
import type {
  AuditFinding,
  AuditProgressUpdatePayload,
  AuditReportData,
  AuditRunRequest,
  AuditRunResponse,
  BrokenLinkResult,
  LighthouseReportData,
  ResolvedAuditConfiguration
} from "./types.js";

const STORAGE_ROOT = path.resolve(process.env.STORAGE_PATH || "../storage");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ArtifactPaths {
  screenshotDirectory: string;
  screenshotRelativeRoot: string;
  reportDirectory: string;
  pdfAbsolutePath: string;
  pdfRelativePath: string;
  jsonAbsolutePath: string;
  jsonRelativePath: string;
}

export async function runAudit(request: AuditRunRequest): Promise<AuditRunResponse> {
  assertAuditId(request.auditId);
  const config = resolveAuditConfiguration(request);
  if (!config.authorizationConfirmed) {
    throw new Error("A auditoria exige confirmação explícita de autorização do domínio.");
  }

  const startedAt = new Date();
  const runtime = createAuditRuntime(request.auditId, config.timeoutSeconds * 1_000);
  const ids = createEvidenceIdFactory();
  const ssrfOptions = buildSsrfOptions();
  const log = createAuditLogger(request.auditId, request.url);
  let browser: Browser | null = null;
  let runtimeFinished = false;

  const emitProgress = async (
    progressPercent: number,
    currentStage: string,
    statusMessage: string,
    extra: Partial<AuditProgressUpdatePayload> = {}
  ): Promise<void> => {
    const safeCurrentPage = extra.currentPage ? safeUrl(extra.currentPage) : undefined;
    const safeMessage = redactText(statusMessage).slice(0, 500);
    updateAuditRuntime(request.auditId, {
      progressPercent: clampInteger(progressPercent, 0, 100),
      currentStage,
      statusMessage: safeMessage,
      currentPage: safeCurrentPage,
      pagesVisited: extra.pagesVisited,
      actionsExecuted: extra.actionsExecuted,
      findingsCount: extra.findingsCount
    });
    await reportAuditProgress(request, {
      ...extra,
      progressPercent: clampInteger(progressPercent, 0, 100),
      currentStage,
      statusMessage: safeMessage,
      currentPage: safeCurrentPage,
      elapsedMs: Date.now() - startedAt.getTime()
    });
  };

  const closeOnAbort = () => {
    if (browser) void browser.close().catch(() => undefined);
  };
  runtime.signal.addEventListener("abort", closeOnAbort, { once: true });

  try {
    await runtime.waitForSlot();
    await emitProgress(3, "VALIDATING_DOMAIN", "Validando domínio, DNS e política SSRF.");
    const initialTarget = await assertSafeAuditUrl(request.url, ssrfOptions);
    const targetUrl = initialTarget.url.toString();
    const artifacts = await prepareArtifactPaths(request.auditId);
    const validateUrl = async (candidate: string): Promise<string> =>
      (await assertSafeAuditUrl(candidate, ssrfOptions)).url.toString();
    const evaluateUrlPolicy = createUrlPolicy(targetUrl, config);
    const evaluateSafety = createSafetyEvaluator(config);

    log("audit.accepted", { mode: config.auditMode, viewports: config.viewports.length, maxPages: config.maxPages });
    await emitProgress(7, "BOOTING_BROWSER", "Iniciando o navegador isolado.");
    browser = await runWithTimeout(
      "inicialização do browser",
      Math.min(config.stageTimeoutSeconds * 1_000, 60_000),
      runtime.signal,
      async (stageSignal) => {
        const launchPromise = chromium.launch({ headless: true });
        void launchPromise.then((launchedBrowser) => {
          if (stageSignal.aborted || runtime.signal.aborted) {
            void launchedBrowser.close().catch(() => undefined);
          }
        }).catch(() => undefined);
        return launchPromise;
      }
    );
    throwIfAborted(runtime.signal);

    const browserResult = await runBrowserAudit({
      browser,
      rootUrl: targetUrl,
      config,
      screenshotDirectory: artifacts.screenshotDirectory,
      screenshotRelativeRoot: artifacts.screenshotRelativeRoot,
      ids,
      signal: runtime.signal,
      validateUrl,
      evaluateUrlPolicy,
      evaluateSafety,
      onProgress: async (update) => {
        const percent = browserStagePercent(update.stage);
        await emitProgress(percent, update.stage, update.message, {
          currentPage: update.currentPage,
          pagesVisited: update.pagesVisited,
          actionsExecuted: update.actionsExecuted
        });
      },
      log: (message, error) => log("browser", { message: redactText(message), error: error ? toSafeErrorDetails(error) : undefined })
    });

    throwIfAborted(runtime.signal);
    await emitProgress(66, "RUNNING_LIGHTHOUSE", "Executando Lighthouse com proteção de rede.", {
      pagesVisited: browserResult.coverage.pagesVisited,
      actionsExecuted: browserResult.coverage.interactionsExecuted
    });
    const lighthouseTimeout = clampInteger(
      Number(process.env.AUDITOR_LIGHTHOUSE_TIMEOUT_MS || config.stageTimeoutSeconds * 1_000),
      10_000,
      180_000
    );
    const lighthouseTarget = await validateUrl(browserResult.finalUrl || targetUrl);
    const lighthouse = await runLighthouseAudit(lighthouseTarget, lighthouseTimeout, runtime.signal, validateUrl);

    throwIfAborted(runtime.signal);
    await emitProgress(76, "CHECKING_LINKS", "Verificando links com validação SSRF em cada redirecionamento.");
    const brokenLinks = await checkBrokenLinks(browserResult, config, ssrfOptions, runtime.signal, ids);
    browserResult.coverage.linksChecked = uniqueLinkCandidates(browserResult).length;

    const findings = buildFindings({ browser: browserResult, lighthouse, brokenLinks }, ids);
    const issueSummary = buildIssueSummary(findings, brokenLinks, browserResult);
    const overallScore = calculateOverallScore(lighthouse);
    await emitProgress(86, "GENERATING_AI", "Consolidando resumo executivo e recomendações.", {
      pagesVisited: browserResult.coverage.pagesVisited,
      actionsExecuted: browserResult.coverage.interactionsExecuted,
      findingsCount: findings.length
    });
    const aiInput = {
        url: safeUrl(targetUrl),
        overallScore,
        lighthouse,
        issues: findings,
        brokenLinks,
        consoleErrors: browserResult.consoleErrors,
        networkErrors: browserResult.networkErrors,
        enabled: config.aiEnabled
    };
    let ai: Awaited<ReturnType<typeof generateAiAnalysis>>;
    try {
      ai = await runWithTimeout(
        "análise executiva",
        Math.min(50_000, config.stageTimeoutSeconds * 1_000),
        runtime.signal,
        (stageSignal) => generateAiAnalysis(aiInput, stageSignal)
      );
    } catch (error) {
      if (runtime.signal.aborted) throw runtime.signal.reason instanceof Error ? runtime.signal.reason : error;
      log("ai.partial_failure", { error: toSafeErrorDetails(error) });
      ai = await generateAiAnalysis({ ...aiInput, enabled: false });
      ai.disclaimer = "A análise generativa ficou indisponível; o resumo foi consolidado de forma determinística.";
    }

    const auditedAt = new Date().toISOString();
    const reportData = buildReportData({
      request,
      config,
      startedAt: startedAt.toISOString(),
      auditedAt,
      overallScore,
      lighthouse,
      browser: browserResult,
      brokenLinks,
      findings,
      issueSummary,
      ai,
      artifacts
    });

    throwIfAborted(runtime.signal);
    await emitProgress(93, "BUILDING_JSON", "Persistindo relatório JSON estruturado.", { findingsCount: findings.length });
    await writeJsonAtomically(artifacts.jsonAbsolutePath, reportData);

    const desktopAbsolutePath = resolveArtifactForRead(browserResult.desktopScreenshotPath);
    const mobileAbsolutePath = resolveArtifactForRead(browserResult.mobileScreenshotPath);
    await emitProgress(97, "BUILDING_PDF", "Gerando relatório executivo em PDF.", { findingsCount: findings.length });
    await generatePdfReport({
      outputPath: artifacts.pdfAbsolutePath,
      url: safeUrl(targetUrl),
      auditedAt,
      scores: { ...lighthouse.scores, overall: overallScore },
      ai,
      issues: findings,
      brokenLinks,
      consoleErrors: browserResult.consoleErrors,
      desktopScreenshotPath: desktopAbsolutePath,
      mobileScreenshotPath: mobileAbsolutePath,
      lighthouse,
      issueSummary
    });

    throwIfAborted(runtime.signal);
    finishAuditRuntime(request.auditId, "COMPLETED");
    runtimeFinished = true;
    await reportAuditProgress(request, {
      progressPercent: 100,
      currentStage: "COMPLETED",
      statusMessage: "Auditoria concluída com relatório e evidências persistidos.",
      status: "COMPLETED",
      pagesVisited: browserResult.coverage.pagesVisited,
      actionsExecuted: browserResult.coverage.interactionsExecuted,
      findingsCount: findings.length,
      elapsedMs: Date.now() - startedAt.getTime(),
      estimatedRemainingMs: 0
    });
    log("audit.completed", {
      durationMs: Date.now() - startedAt.getTime(),
      findings: findings.length,
      coverage: browserResult.coverage.functionalCoveragePercent
    });

    return {
      overallScore,
      performanceScore: lighthouse.scores.performance,
      accessibilityScore: lighthouse.scores.accessibility,
      seoScore: lighthouse.scores.seo,
      bestPracticesScore: lighthouse.scores.bestPractices,
      desktopScreenshotPath: browserResult.desktopScreenshotPath,
      mobileScreenshotPath: browserResult.mobileScreenshotPath,
      reportPdfPath: artifacts.pdfRelativePath,
      reportJsonPath: artifacts.jsonRelativePath,
      aiSummary: ai.executiveSummary,
      finishedAt: auditedAt,
      reportData,
      issues: findings,
      brokenLinks,
      consoleErrors: browserResult.consoleErrors
    };
  } catch (error) {
    const cancelled = error instanceof AuditCancelledError;
    const safeError = redactText(error instanceof Error ? error.message : "Falha inesperada na auditoria.").slice(0, 500);
    if (!runtimeFinished) {
      finishAuditRuntime(request.auditId, cancelled ? "CANCELLED" : "FAILED", safeError);
      runtimeFinished = true;
    }
    await reportAuditProgress(request, {
      progressPercent: 0,
      currentStage: cancelled ? "CANCELLED" : "FAILED",
      statusMessage: cancelled ? "Auditoria cancelada e recursos encerrados." : "A auditoria falhou antes da consolidação final.",
      status: cancelled ? "CANCELLED" : "FAILED",
      elapsedMs: Date.now() - startedAt.getTime(),
      estimatedRemainingMs: 0
    });
    log(cancelled ? "audit.cancelled" : "audit.failed", { error: toSafeErrorDetails(error) });
    throw error;
  } finally {
    runtime.signal.removeEventListener("abort", closeOnAbort);
    if (browser) await browser.close().catch(() => undefined);
    if (!runtimeFinished) finishAuditRuntime(request.auditId, "FAILED", "Execução encerrada sem estado terminal.");
  }
}

function buildSsrfOptions(): SsrfGuardOptions {
  return {
    environment: process.env.NODE_ENV || "development",
    allowLocalhost: false,
    allowPrivateAddresses: false,
    privateHostAllowlist: environmentList("AUDITOR_PRIVATE_HOST_ALLOWLIST"),
    allowedHosts: environmentList("AUDITOR_HOST_ALLOWLIST"),
    blockedHosts: environmentList("AUDITOR_BLOCKED_HOSTS")
  };
}

function createUrlPolicy(rootUrl: string, config: ResolvedAuditConfiguration) {
  const root = new URL(rootUrl);
  return (candidate: string): { allowed: boolean; reason?: string } => {
    let url: URL;
    try {
      url = new URL(candidate, root);
    } catch {
      return { allowed: false, reason: "URL inválida." };
    }
    if (!/^https?:$/.test(url.protocol)) return { allowed: false, reason: "Protocolo fora do escopo HTTP(S)." };
    if (url.origin !== root.origin) return { allowed: false, reason: "Destino fora da origem autorizada para navegação funcional." };
    const comparable = `${url.pathname}${url.search}`;
    if (config.exclude.some((pattern) => globMatches(comparable, pattern))) {
      return { allowed: false, reason: "URL excluída pela configuração da auditoria." };
    }
    if (config.include.length > 0 && url.toString() !== root.toString() && !config.include.some((pattern) => globMatches(comparable, pattern))) {
      return { allowed: false, reason: "URL fora dos padrões de inclusão configurados." };
    }
    return { allowed: true };
  };
}

function createSafetyEvaluator(config: ResolvedAuditConfiguration) {
  return (input: { action: string; text: string; href?: string; elementType?: string }): SafetyDecision => {
    const classification = classifyActionSafety({
      kind: input.action,
      label: input.text,
      url: input.href,
      inputType: input.elementType
    });
    const permission = evaluateActionPermission(classification, {
      hasUserAuthorization: config.authorizationConfirmed,
      domainAuthorized: config.authorizationConfirmed,
      flowConfigured: Boolean(config.authConfig) || config.scenarios.length > 0,
      testEnvironment: config.testEnvironment,
      destructiveActionsEnabled: config.allowDestructiveActions
    });
    return { classification: classification.level, allowed: permission.allowed, reason: permission.reason };
  };
}

async function prepareArtifactPaths(auditId: string): Promise<ArtifactPaths> {
  await fs.mkdir(STORAGE_ROOT, { recursive: true });
  const screenshotRelativeRoot = normalizeArtifactRelativePath(`screenshots/${auditId}`);
  const reportRelativeRoot = normalizeArtifactRelativePath(`reports/${auditId}`);
  const screenshotLexical = resolvePathWithinRoot(STORAGE_ROOT, screenshotRelativeRoot);
  const reportLexical = resolvePathWithinRoot(STORAGE_ROOT, reportRelativeRoot);
  await Promise.all([
    fs.mkdir(screenshotLexical, { recursive: true }),
    fs.mkdir(reportLexical, { recursive: true })
  ]);
  const [screenshotDirectory, reportDirectory] = await Promise.all([
    assertExistingPathWithinRoot(STORAGE_ROOT, screenshotRelativeRoot),
    assertExistingPathWithinRoot(STORAGE_ROOT, reportRelativeRoot)
  ]);
  const pdfRelativePath = normalizeArtifactRelativePath(`${reportRelativeRoot}/audit-report.pdf`);
  const jsonRelativePath = normalizeArtifactRelativePath(`${reportRelativeRoot}/audit-report.json`);
  return {
    screenshotDirectory,
    screenshotRelativeRoot,
    reportDirectory,
    pdfAbsolutePath: path.join(reportDirectory, "audit-report.pdf"),
    pdfRelativePath,
    jsonAbsolutePath: path.join(reportDirectory, "audit-report.json"),
    jsonRelativePath
  };
}

async function checkBrokenLinks(
  browser: BrowserAuditResult,
  config: ResolvedAuditConfiguration,
  ssrfOptions: SsrfGuardOptions,
  signal: AbortSignal,
  ids: EvidenceIdFactory
): Promise<BrokenLinkResult[]> {
  const configuredMax = Number(process.env.AUDITOR_LINK_CHECK_MAX_LINKS || (config.auditMode === "QUICK" ? 24 : 100));
  const maximum = clampInteger(configuredMax, 0, 250);
  const configuredConcurrency = Number(process.env.AUDITOR_LINK_CHECK_CONCURRENCY || config.concurrency);
  const candidates = uniqueLinkCandidates(browser).slice(0, maximum);
  const results = await mapWithConcurrency(candidates, clampInteger(configuredConcurrency, 1, 8), signal, async (candidate) => {
    try {
      const statusCode = await runWithTimeout("checagem de link", Math.min(config.stageTimeoutSeconds * 1_000, 15_000), signal, async (stageSignal) => {
        let response = await fetchWithSsrfGuard(candidate.url, {
          method: "HEAD",
          signal: stageSignal,
          headers: { "User-Agent": "AIWebAuditorBot/2.0 LinkChecker" }
        }, { ...ssrfOptions, maxRedirects: 6 });
        let status = response.status;
        await response.body?.cancel().catch(() => undefined);
        if (status === 405 || status === 501) {
          response = await fetchWithSsrfGuard(candidate.url, {
            method: "GET",
            signal: stageSignal,
            headers: { "User-Agent": "AIWebAuditorBot/2.0 LinkChecker", Range: "bytes=0-0" }
          }, { ...ssrfOptions, maxRedirects: 6 });
          status = response.status;
          await response.body?.cancel().catch(() => undefined);
        }
        return status;
      });
      return { id: ids.nextNetwork(), url: safeUrl(candidate.url), statusCode, sourcePageId: candidate.pageId, validationStatus: "VALIDATED_AUTOMATICALLY" as const };
    } catch (error) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : error;
      return { id: ids.nextNetwork(), url: safeUrl(candidate.url), statusCode: 599, sourcePageId: candidate.pageId, validationStatus: "FAILED" as const };
    }
  });
  return results.filter((item) => item.statusCode >= 400);
}

function uniqueLinkCandidates(browser: BrowserAuditResult): Array<{ url: string; pageId: string }> {
  const seen = new Set<string>();
  return browser.linkCandidates.filter((candidate) => {
    const key = candidate.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildFindings(
  input: { browser: BrowserAuditResult; lighthouse: LighthouseReportData; brokenLinks: BrokenLinkResult[] },
  ids: EvidenceIdFactory
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const add = (finding: Omit<AuditFinding, "id">) => findings.push({
    id: ids.nextFinding(),
    confidence: "HIGH",
    validationStatus: "VALIDATED_AUTOMATICALLY",
    ...finding
  });

  if (input.lighthouse.status === "FAILED") {
    add({
      type: "PERFORMANCE",
      severity: "INFO",
      title: "Lighthouse indisponível nesta execução",
      description: input.lighthouse.failureReason || "O Lighthouse não produziu dados confiáveis.",
      recommendation: "Repita a medição em um ambiente estável e consulte as demais evidências determinísticas.",
      source: "Lighthouse",
      confidence: "HIGH",
      validationStatus: "FAILED"
    });
  } else {
    const categories: Array<[keyof LighthouseReportData["scores"], string, AuditFinding["type"], number]> = [
      ["performance", "Performance", "PERFORMANCE", 80],
      ["accessibility", "Acessibilidade", "ACCESSIBILITY", 85],
      ["seo", "SEO", "SEO", 85],
      ["bestPractices", "Boas práticas", "BEST_PRACTICES", 85]
    ];
    for (const [key, label, type, target] of categories) {
      const score = input.lighthouse.scores[key];
      if (score !== null && score < target) add({
        type,
        severity: lighthouseFindingSeverity(score),
        title: `${label} abaixo da meta`,
        description: `O Lighthouse registrou ${score}/100 para ${label.toLowerCase()}.`,
        recommendation: "Priorize as oportunidades mensuradas e repita a auditoria após a correção.",
        source: "Lighthouse",
        impact: `Score abaixo da referência de ${target}.`,
        effort: "MEDIUM"
      });
    }
  }

  for (const violation of input.browser.axeViolations.slice(0, 30)) {
    const screenshot = input.browser.screenshots.find((item) => item.pageId === violation.pageId && item.viewportId === violation.viewportId);
    add({
      type: "ACCESSIBILITY",
      severity: axeSeverity(violation.impact),
      title: violation.help,
      description: `${violation.description} (${violation.nodes} ocorrência(s)).`,
      recommendation: `Corrija a regra ${violation.id} e valide com teclado e tecnologia assistiva.`,
      source: "axe-core",
      pageId: violation.pageId,
      viewportId: violation.viewportId,
      evidenceIds: [violation.pageId, screenshot?.id].filter(Boolean) as string[],
      screenshotPath: screenshot?.relativePath,
      technicalReference: violation.helpUrl
    });
  }

  for (const issue of input.browser.responsiveIssues.slice(0, 40)) {
    const screenshot = input.browser.screenshots.find((item) => item.id === issue.screenshotId);
    add({
      type: issue.kind === "TINY_TEXT" ? "VISUAL" : "RESPONSIVE",
      severity: ["HORIZONTAL_OVERFLOW", "OFFSCREEN", "OVERSIZED_MODAL", "SCROLL_LOCKED"].includes(issue.kind) ? "HIGH" : "MEDIUM",
      title: responsiveTitle(issue.kind),
      description: issue.description,
      recommendation: "Revise layout, breakpoints, dimensões e empilhamento nessa viewport.",
      source: "Playwright",
      pageId: issue.pageId,
      viewportId: issue.viewportId,
      url: issue.url,
      element: issue.selector,
      selector: issue.selector,
      boundingBox: issue.boundingBox,
      evidenceIds: [issue.pageId, issue.screenshotId].filter(Boolean) as string[],
      screenshotPath: screenshot?.relativePath,
      reproductionSteps: [`Abrir ${issue.url}.`, `Usar a viewport ${issue.viewportId}.`, "Inspecionar a região indicada na captura."],
      validationStatus: issue.kind === "OVERLAP" ? "REQUIRES_MANUAL_VALIDATION" : "VALIDATED_AUTOMATICALLY"
    });
  }

  for (const broken of input.brokenLinks.slice(0, 30)) {
    add({
      type: "BROKEN_LINK",
      severity: broken.statusCode === 599 ? "MEDIUM" : "HIGH",
      title: `Link indisponível (${broken.statusCode})`,
      description: `A URL ${broken.url} não respondeu com sucesso.`,
      recommendation: "Corrija, remova ou redirecione o link e valide novamente.",
      source: "Link Checker",
      pageId: broken.sourcePageId,
      url: broken.url,
      evidenceIds: [broken.sourcePageId, broken.id].filter(Boolean) as string[],
      validationStatus: broken.validationStatus || "VALIDATED_AUTOMATICALLY"
    });
  }

  for (const network of input.browser.networkErrors.slice(0, 24)) {
    add({
      type: "NETWORK",
      severity: network.kind === "SLOW" || network.kind === "DUPLICATE"
        ? "LOW"
        : network.kind === "FAILED" || network.kind === "HTTP_ERROR" || network.kind === "MIXED_CONTENT"
          ? "HIGH"
          : "MEDIUM",
      title: network.kind === "SLOW" ? "Requisição lenta" : network.kind === "MIXED_CONTENT" ? "Conteúdo misto" : "Falha de rede",
      description: `${network.method} ${network.url}: ${network.failureText}`,
      recommendation: "Revise disponibilidade, protocolo, cache, tamanho e tempo de resposta do recurso.",
      source: "Playwright Network",
      pageId: network.pageId,
      url: network.url,
      evidenceIds: [network.pageId, network.id].filter(Boolean) as string[],
      validationStatus: "VALIDATED_AUTOMATICALLY"
    });
  }

  for (const error of input.browser.consoleErrors.slice(0, 16)) {
    add({
      type: "CONSOLE",
      severity: error.type === "warning" ? "LOW" : "MEDIUM",
      title: error.type === "warning" ? "Warning no console" : "Erro no runtime da página",
      description: error.message,
      recommendation: "Reproduza na página indicada, corrija a origem e monitore regressões no frontend.",
      source: "Playwright Console",
      pageId: error.pageId,
      url: error.url,
      evidenceIds: [error.pageId, error.id].filter(Boolean) as string[]
    });
  }

  for (const action of input.browser.actions.filter((item) => item.validationStatus === "FAILED").slice(0, 16)) {
    const screenshot = input.browser.screenshots.find((item) => item.id === action.screenshotId);
    add({
      type: "FUNCTIONAL",
      severity: "HIGH",
      title: `Falha funcional em ${action.action.toLowerCase()}`,
      description: action.error || action.result,
      recommendation: "Reproduza o fluxo configurado e corrija o estado ou seletor que impediu a conclusão.",
      source: "Playwright Functional",
      pageId: action.pageId,
      actionId: action.id,
      viewportId: action.viewportId,
      url: action.url,
      element: action.element,
      selector: action.selector,
      evidenceIds: [action.pageId, action.id, action.screenshotId].filter(Boolean) as string[],
      screenshotPath: screenshot?.relativePath,
      reproductionSteps: action.reproductionSteps,
      validationStatus: "FAILED"
    });
  }

  const missingHeaders = Object.entries(input.browser.passiveSecurity.headers)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (!input.browser.passiveSecurity.https || missingHeaders.length > 0 || input.browser.passiveSecurity.insecureForms > 0) {
    add({
      type: "SECURITY",
      severity: !input.browser.passiveSecurity.https || input.browser.passiveSecurity.insecureForms > 0 ? "CRITICAL" : "MEDIUM",
      title: "Hardening HTTP incompleto",
      description: `HTTPS: ${input.browser.passiveSecurity.https ? "sim" : "não"}; headers ausentes: ${missingHeaders.join(", ") || "nenhum"}; formulários inseguros: ${input.browser.passiveSecurity.insecureForms}.`,
      recommendation: "Force HTTPS e configure CSP, HSTS, proteção de frame, MIME sniffing e referrer policy.",
      source: "Passive Security",
      url: safeUrl(input.browser.finalUrl)
    });
  }

  return deduplicateFindings(findings).slice(0, 160);
}

function buildReportData(input: {
  request: AuditRunRequest;
  config: ResolvedAuditConfiguration;
  startedAt: string;
  auditedAt: string;
  overallScore: number | null;
  lighthouse: LighthouseReportData;
  browser: BrowserAuditResult;
  brokenLinks: BrokenLinkResult[];
  findings: AuditFinding[];
  issueSummary: AuditReportData["issueSummary"];
  ai: AuditReportData["summary"]["ai"];
  artifacts: ArtifactPaths;
}): AuditReportData {
  const { authConfig, ...publicConfiguration } = input.config;
  const mobile = input.browser.responsive.find((item) => item.viewport.isMobile);
  const limitations: string[] = [];
  if (input.lighthouse.status === "FAILED") limitations.push(`Lighthouse falhou: ${input.lighthouse.failureReason || "motivo não informado"}.`);
  if (!input.browser.desktopScreenshotPath) limitations.push("A captura desktop da página principal ficou indisponível.");
  if (!input.browser.mobileScreenshotPath) limitations.push("A captura mobile da página principal ficou indisponível.");
  const unavailableResponsiveCaptures = input.browser.responsive.filter((item) => !item.screenshotPath).length;
  if (unavailableResponsiveCaptures > 0) {
    limitations.push(`${unavailableResponsiveCaptures} captura(s) responsiva(s) ficaram indisponíveis sem interromper as demais verificações.`);
  }
  const failedPages = input.browser.pages.filter((page) => page.validationStatus === "FAILED").length;
  if (failedPages > 0) limitations.push(`${failedPages} página(s) não puderam ser auditadas completamente.`);
  if (input.browser.coverage.pagesIgnored > 0) limitations.push(`${input.browser.coverage.pagesIgnored} página(s) ficaram fora dos limites ou filtros configurados.`);
  if (input.browser.coverage.blockedCaptchaMfa > 0) limitations.push("CAPTCHA/MFA foi detectado e deliberadamente não foi contornado.");
  limitations.push("Achados visuais heurísticos e foco de teclado podem exigir confirmação humana.");

  return {
    schemaVersion: "2.0.0",
    metadata: {
      auditId: input.request.auditId,
      url: safeUrl(input.request.url),
      finalUrl: safeUrl(input.browser.finalUrl),
      auditedAt: input.auditedAt,
      startedAt: input.startedAt,
      durationMs: Math.max(0, Date.parse(input.auditedAt) - Date.parse(input.startedAt)),
      auditMode: input.config.auditMode,
      deterministic: input.ai.provider !== "OPENAI"
    },
    configuration: { ...publicConfiguration, authenticationConfigured: Boolean(authConfig) },
    summary: {
      overallScore: input.overallScore,
      categoryScores: input.lighthouse.scores,
      ai: input.ai
    },
    issueSummary: input.issueSummary,
    coverage: input.browser.coverage,
    pages: input.browser.pages,
    actions: input.browser.actions,
    screenshots: input.browser.screenshots,
    network: input.browser.network,
    findings: input.findings,
    lighthouse: input.lighthouse,
    axe: {
      violations: input.browser.axeViolations,
      violationCount: input.browser.axeViolations.length,
      keyboardChecks: input.browser.keyboardChecks
    },
    responsive: {
      desktop: { screenshotPath: input.browser.desktopScreenshotPath },
      mobile: {
        screenshotPath: input.browser.mobileScreenshotPath,
        horizontalOverflow: mobile?.insights.horizontalOverflow || false,
        smallTapTargets: mobile?.insights.smallTapTargets || 0
      },
      byViewport: input.browser.responsive
    },
    passiveSecurity: input.browser.passiveSecurity,
    visualFindings: buildVisualNotes(input.browser),
    seoSignals: {
      title: input.browser.primaryInsights.title,
      metaDescriptionLength: input.browser.primaryInsights.metaDescription.length,
      h1Count: input.browser.primaryInsights.h1Count
    },
    consoleErrors: input.browser.consoleErrors,
    networkErrors: input.browser.networkErrors,
    brokenLinks: input.brokenLinks,
    limitations,
    artifacts: { pdf: input.artifacts.pdfRelativePath, json: input.artifacts.jsonRelativePath }
  };
}

function buildIssueSummary(
  findings: AuditFinding[],
  brokenLinks: BrokenLinkResult[],
  browser: BrowserAuditResult
): AuditReportData["issueSummary"] {
  return {
    critical: findings.filter((finding) => finding.severity === "CRITICAL").length,
    high: findings.filter((finding) => finding.severity === "HIGH").length,
    medium: findings.filter((finding) => finding.severity === "MEDIUM").length,
    low: findings.filter((finding) => finding.severity === "LOW").length,
    info: findings.filter((finding) => finding.severity === "INFO").length,
    brokenLinks: brokenLinks.length,
    consoleErrors: browser.consoleErrors.length,
    networkErrors: browser.networkErrors.length
  };
}

function buildVisualNotes(browser: BrowserAuditResult): string[] {
  const notes = new Set<string>();
  for (const issue of browser.responsiveIssues) notes.add(issue.description);
  for (const keyboard of browser.keyboardChecks.filter((item) => item.validationStatus !== "VALIDATED_AUTOMATICALLY")) {
    notes.add(keyboard.details);
  }
  if (notes.size === 0) notes.add("Nenhum problema visual heurístico grave foi detectado automaticamente.");
  return [...notes].slice(0, 30);
}

async function writeJsonAtomically(outputPath: string, reportData: AuditReportData): Promise<void> {
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(reportData, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, outputPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function resolveArtifactForRead(relativePath: string): string {
  if (!relativePath) return "";
  return resolvePathWithinRoot(STORAGE_ROOT, relativePath);
}

function browserStagePercent(stage: string): number {
  switch (stage) {
    case "DISCOVERING_PAGES": return 18;
    case "AUDITING_DESKTOP": return 38;
    case "AUDITING_MOBILE": return 52;
    default: return 30;
  }
}

function axeSeverity(impact: string | null): AuditFinding["severity"] {
  if (impact === "critical") return "CRITICAL";
  if (impact === "serious") return "HIGH";
  if (impact === "moderate") return "MEDIUM";
  if (impact === "minor") return "LOW";
  return "INFO";
}

function responsiveTitle(kind: BrowserAuditResult["responsiveIssues"][number]["kind"]): string {
  const titles: Record<typeof kind, string> = {
    HORIZONTAL_OVERFLOW: "Overflow horizontal",
    SMALL_TAP_TARGET: "Alvo de toque pequeno",
    TINY_TEXT: "Texto pequeno",
    CLIPPED: "Conteúdo cortado",
    OFFSCREEN: "Controle fora da viewport",
    OVERLAP: "Possível sobreposição",
    OVERSIZED_MODAL: "Modal maior que a viewport",
    FIXED_OVERLAY: "Overlay fixo dominante",
    SCROLL_LOCKED: "Rolagem bloqueada"
  };
  return titles[kind];
}

function deduplicateFindings(findings: AuditFinding[]): AuditFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.type}:${finding.title}:${finding.pageId || ""}:${finding.viewportId || ""}:${finding.url || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createAuditLogger(auditId: string, rawUrl: string) {
  const url = safeUrl(rawUrl);
  return (event: string, details: Record<string, unknown> = {}): void => {
    console.info(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", service: "auditor-service", auditId, event, url, ...details }));
  };
}

function safeUrl(rawUrl: string): string {
  return redactUrl(rawUrl).slice(0, 2_048);
}

function globMatches(value: string, pattern: string): boolean {
  const bounded = pattern.trim().slice(0, 500);
  if (!bounded) return false;
  const escaped = bounded.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value) || value.toLowerCase().includes(bounded.toLowerCase());
}

function environmentList(name: string): string[] | undefined {
  const values = String(process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 100);
  return values.length > 0 ? values : undefined;
}

function assertAuditId(auditId: string): void {
  if (!UUID_PATTERN.test(auditId)) throw new Error("auditId deve ser um UUID válido.");
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export const __testing = {
  globMatches,
  createUrlPolicy,
  calculateOverallScore,
  environmentList
};

export { AuditCancelledError, AuditTimeoutError };
