import path from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  Request as PlaywrightRequest,
  Response as PlaywrightResponse
} from "playwright";
import { throwIfAborted } from "./audit-runtime.js";
import { abortableDelay, mapWithConcurrency, runWithTimeout, type EvidenceIdFactory } from "./pipeline-utils.js";
import { selectRepresentativeScreenshotPaths } from "./report-utils.js";
import { redactText, redactUrl } from "./lib/redaction.js";
import type {
  AuditActionEvidence,
  AuditCoverage,
  AuditNetworkEvidence,
  AuditPageEvidence,
  AuditScreenshotEvidence,
  AuditViewport,
  BoundingBox,
  ConsoleErrorResult,
  DomInsights,
  NetworkErrorResult,
  PassiveSecurityResult,
  ResolvedAuditConfiguration,
  ValidationStatus
} from "./types.js";

export interface SafetyDecision {
  classification: AuditActionEvidence["safetyClassification"];
  allowed: boolean;
  reason: string;
}

export interface BrowserAuditInput {
  browser: Browser;
  rootUrl: string;
  config: ResolvedAuditConfiguration;
  screenshotDirectory: string;
  screenshotRelativeRoot: string;
  ids: EvidenceIdFactory;
  signal: AbortSignal;
  validateUrl: (url: string) => Promise<string>;
  evaluateUrlPolicy: (url: string) => { allowed: boolean; reason?: string };
  evaluateSafety: (input: { action: string; text: string; href?: string; elementType?: string }) => SafetyDecision;
  onProgress?: (update: {
    stage: string;
    message: string;
    currentPage?: string;
    pagesVisited?: number;
    actionsExecuted?: number;
  }) => Promise<void> | void;
  log: (message: string, error?: unknown) => void;
}

export interface AxeViolationEvidence {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  nodes: number;
  pageId: string;
  viewportId: string;
}

export interface ResponsiveIssueEvidence {
  pageId: string;
  viewportId: string;
  url: string;
  kind:
    | "HORIZONTAL_OVERFLOW"
    | "SMALL_TAP_TARGET"
    | "TINY_TEXT"
    | "CLIPPED"
    | "OFFSCREEN"
    | "OVERLAP"
    | "OVERSIZED_MODAL"
    | "FIXED_OVERLAY"
    | "SCROLL_LOCKED";
  description: string;
  selector?: string;
  boundingBox?: BoundingBox | null;
  screenshotId?: string;
}

export interface BrowserAuditResult {
  finalUrl: string;
  pages: AuditPageEvidence[];
  actions: AuditActionEvidence[];
  screenshots: AuditScreenshotEvidence[];
  network: AuditNetworkEvidence[];
  consoleErrors: ConsoleErrorResult[];
  networkErrors: NetworkErrorResult[];
  axeViolations: AxeViolationEvidence[];
  keyboardChecks: Array<{
    pageId: string;
    viewportId: string;
    validationStatus: ValidationStatus;
    details: string;
  }>;
  responsive: Array<{
    viewport: AuditViewport;
    pageId: string;
    screenshotPath: string;
    insights: DomInsights;
  }>;
  responsiveIssues: ResponsiveIssueEvidence[];
  rootHtml: string;
  linkCandidates: Array<{ url: string; pageId: string }>;
  coverage: AuditCoverage;
  passiveSecurity: PassiveSecurityResult;
  desktopScreenshotPath: string;
  mobileScreenshotPath: string;
  primaryInsights: DomInsights;
}

interface CrawlEntry {
  id: string;
  url: string;
  normalizedUrl: string;
  depth: number;
  discoveredFromPageId?: string;
  visited: boolean;
  skipReason?: string;
}

interface InteractiveElement {
  kind: "link" | "button" | "input" | "select" | "checkbox" | "tab" | "menu" | "accordion" | "submit";
  tag: string;
  role?: string;
  name: string;
  label?: string;
  testId?: string;
  text: string;
  type?: string;
  href?: string;
  selector: string;
  selectorStrategy: AuditActionEvidence["selectorStrategy"];
  required?: boolean;
  formHasRequired?: boolean;
  boundingBox?: BoundingBox | null;
}

interface PageDomAudit {
  insights: DomInsights;
  links: string[];
  interactives: InteractiveElement[];
  formsFound: number;
  responsiveIssues: Omit<ResponsiveIssueEvidence, "pageId" | "viewportId" | "url" | "screenshotId">[];
}

interface RuntimeCollector {
  currentPageId?: string;
  consoleErrors: ConsoleErrorResult[];
  networkErrors: NetworkErrorResult[];
  network: AuditNetworkEvidence[];
  requestStartedAt: WeakMap<PlaywrightRequest, number>;
  urlCounts: Map<string, number>;
  totalRequests: number;
  totalDeclaredBytes: number;
}

const MAX_NETWORK_EVIDENCE = 700;
const MAX_CONTEXT_REQUESTS = Math.max(100, Number(process.env.AUDITOR_MAX_REQUESTS || 900));
const MAX_TOTAL_DECLARED_BYTES = Math.max(5_000_000, Number(process.env.AUDITOR_MAX_TRANSFER_BYTES || 75_000_000));
const MAX_RESPONSE_BYTES = Math.max(250_000, Number(process.env.AUDITOR_MAX_RESPONSE_BYTES || 12_000_000));
const SLOW_REQUEST_MS = Math.max(500, Number(process.env.AUDITOR_SLOW_REQUEST_MS || 2_500));

export async function runBrowserAudit(input: BrowserAuditInput): Promise<BrowserAuditResult> {
  const startedAt = Date.now();
  const pages: AuditPageEvidence[] = [];
  const actions: AuditActionEvidence[] = [];
  const screenshots: AuditScreenshotEvidence[] = [];
  const consoleErrors: ConsoleErrorResult[] = [];
  const networkErrors: NetworkErrorResult[] = [];
  const network: AuditNetworkEvidence[] = [];
  const axeViolations: AxeViolationEvidence[] = [];
  const keyboardChecks: BrowserAuditResult["keyboardChecks"] = [];
  const responsive: BrowserAuditResult["responsive"] = [];
  const responsiveIssues: ResponsiveIssueEvidence[] = [];
  const linkCandidates: Array<{ url: string; pageId: string }> = [];
  const crawlEntries: CrawlEntry[] = [];
  const crawlByUrl = new Map<string, CrawlEntry>();
  const primaryViewport = selectPrimaryViewport(input.config.viewports);
  let rootHtml = "";
  let finalUrl = input.rootUrl;
  let primaryInsights = emptyInsights();
  let primaryHeaders: Record<string, string> = {};
  let rootCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
  let formsFound = 0;
  let formsTested = 0;
  let scenariosCompleted = 0;
  let scenariosFailed = 0;
  let blockedAuthentication = 0;
  let blockedCaptchaMfa = 0;

  const rootEntry = addCrawlEntry(input.rootUrl, 0, undefined, crawlEntries, crawlByUrl, input.ids);
  const primary = await createGuardedContext(input, primaryViewport, consoleErrors, networkErrors, network);
  try {
    const authentication = await authenticateContext(primary.context, input, primaryViewport, rootEntry.id, actions);
    blockedAuthentication += authentication.blockedAuthentication;
    blockedCaptchaMfa += authentication.blockedCaptchaMfa;

    const page = await primary.context.newPage();
    primary.collector.currentPageId = rootEntry.id;
    installPageGuards(page, input.signal);

    let queueIndex = 0;
    while (queueIndex < crawlEntries.length && pages.filter((entry) => !entry.skipReason).length < input.config.maxPages) {
      throwIfAborted(input.signal);
      const entry = crawlEntries[queueIndex++];
      if (entry.visited || entry.skipReason) {
        continue;
      }
      const urlPolicy = input.evaluateUrlPolicy(entry.url);
      if (!urlPolicy.allowed || entry.depth > input.config.maxDepth) {
        entry.skipReason = urlPolicy.reason || "Fora da profundidade configurada.";
        continue;
      }

      primary.collector.currentPageId = entry.id;
      await input.onProgress?.({
        stage: "DISCOVERING_PAGES",
        message: `Auditando ${entry.normalizedUrl}`,
        currentPage: entry.normalizedUrl,
        pagesVisited: pages.length,
        actionsExecuted: countExecutedActions(actions)
      });

      const pageStartedAt = Date.now();
      try {
        const safeUrl = await input.validateUrl(entry.url);
        const response = await navigateStable(page, safeUrl, input.config.stageTimeoutSeconds * 1000, input.signal);
        finalUrl = entry.id === rootEntry.id ? page.url() : finalUrl;
        entry.visited = true;
        const dom = await collectPageDomAudit(page);
        formsFound += dom.formsFound;
        if (entry.id === rootEntry.id) {
          rootHtml = await limitedPageContent(page);
          primaryInsights = dom.insights;
          primaryHeaders = response ? await response.allHeaders().catch(() => ({})) : {};
          rootCookies = await primary.context.cookies().catch(() => []);
        }

        const screenshot = await captureScreenshotSafely(page, entry.id, primaryViewport, "PAGE", input, screenshots);
        responsive.push({
          viewport: primaryViewport,
          pageId: entry.id,
          screenshotPath: screenshot?.relativePath || "",
          insights: dom.insights
        });
        appendResponsiveIssues(dom, entry, primaryViewport, screenshot?.id, responsiveIssues);
        await runAxe(page, entry.id, viewportId(primaryViewport), axeViolations);
        keyboardChecks.push(await checkKeyboardFocus(page, entry.id, viewportId(primaryViewport)));

        const interactionResult = await executeDiscoveredInteractions(
          page,
          entry,
          primaryViewport,
          dom.interactives,
          input,
          primary.collector,
          actions,
          screenshots
        );
        formsTested += interactionResult.formsTested;
        blockedCaptchaMfa += interactionResult.blockedCaptchaMfa;

        for (const rawLink of dom.links) {
          const normalized = normalizeDiscoveredLink(rawLink, page.url());
          if (!normalized) {
            continue;
          }
          linkCandidates.push({ url: normalized, pageId: entry.id });
          if (sameOrigin(normalized, input.rootUrl) && !crawlByUrl.has(normalizeForCrawl(normalized))) {
            addCrawlEntry(normalized, entry.depth + 1, entry.id, crawlEntries, crawlByUrl, input.ids);
          }
        }

        pages.push({
          id: entry.id,
          url: page.url(),
          normalizedUrl: entry.normalizedUrl,
          title: dom.insights.title,
          depth: entry.depth,
          statusCode: response?.status(),
          validationStatus: "VALIDATED_AUTOMATICALLY",
          discoveredFromPageId: entry.discoveredFromPageId,
          linksFound: dom.links.length,
          interactionsFound: dom.interactives.length,
          formsFound: dom.formsFound,
          visitedAt: new Date().toISOString(),
          durationMs: Date.now() - pageStartedAt,
          viewportIds: [viewportId(primaryViewport)],
          screenshotIds: screenshot ? [screenshot.id] : []
        });
      } catch (error) {
        if (input.signal.aborted) {
          throw input.signal.reason instanceof Error ? input.signal.reason : error;
        }
        entry.visited = true;
        pages.push({
          id: entry.id,
          url: entry.url,
          normalizedUrl: entry.normalizedUrl,
          title: "",
          depth: entry.depth,
          validationStatus: "FAILED",
          discoveredFromPageId: entry.discoveredFromPageId,
          linksFound: 0,
          interactionsFound: 0,
          formsFound: 0,
          visitedAt: new Date().toISOString(),
          durationMs: Date.now() - pageStartedAt,
          viewportIds: [viewportId(primaryViewport)],
          screenshotIds: [],
          skipReason: safeMessage(error)
        });
        input.log(`A página ${entry.id} falhou e a auditoria seguirá para as demais.`, error);
      }
    }

    const scenarioResult = await executeScenarios(page, rootEntry, primaryViewport, input, primary.collector, actions, screenshots);
    scenariosCompleted += scenarioResult.completed;
    scenariosFailed += scenarioResult.failed;
    await page.close().catch(() => undefined);
  } finally {
    await primary.context.close().catch(() => undefined);
  }

  const visitedEntries = crawlEntries.filter((entry) => entry.visited && pages.some((page) => page.id === entry.id));
  const otherViewports = input.config.viewports.filter((viewport) => viewportId(viewport) !== viewportId(primaryViewport));
  await mapWithConcurrency(otherViewports, input.config.concurrency, input.signal, async (viewport) => {
    const runtime = await createGuardedContext(input, viewport, consoleErrors, networkErrors, network);
    try {
      const authentication = await authenticateContext(runtime.context, input, viewport, rootEntry.id, actions);
      blockedAuthentication += authentication.blockedAuthentication;
      blockedCaptchaMfa += authentication.blockedCaptchaMfa;
      const page = await runtime.context.newPage();
      installPageGuards(page, input.signal);

      for (const entry of visitedEntries) {
        throwIfAborted(input.signal);
        runtime.collector.currentPageId = entry.id;
        await input.onProgress?.({
          stage: viewport.isMobile ? "AUDITING_MOBILE" : "AUDITING_DESKTOP",
          message: `Validando ${entry.normalizedUrl} em ${viewport.width}×${viewport.height}.`,
          currentPage: entry.normalizedUrl,
          pagesVisited: pages.length,
          actionsExecuted: countExecutedActions(actions)
        });
        try {
          const safeUrl = await input.validateUrl(entry.url);
          await navigateStable(page, safeUrl, input.config.stageTimeoutSeconds * 1000, input.signal);
          const dom = await collectPageDomAudit(page);
          formsFound += dom.formsFound;
          const screenshot = await captureScreenshotSafely(page, entry.id, viewport, "PAGE", input, screenshots);
          responsive.push({ viewport, pageId: entry.id, screenshotPath: screenshot?.relativePath || "", insights: dom.insights });
          appendResponsiveIssues(dom, entry, viewport, screenshot?.id, responsiveIssues);
          await runAxe(page, entry.id, viewportId(viewport), axeViolations);
          keyboardChecks.push(await checkKeyboardFocus(page, entry.id, viewportId(viewport)));
          const interactionResult = await executeDiscoveredInteractions(
            page,
            entry,
            viewport,
            dom.interactives,
            input,
            runtime.collector,
            actions,
            screenshots
          );
          formsTested += interactionResult.formsTested;
          blockedCaptchaMfa += interactionResult.blockedCaptchaMfa;
          const pageRecord = pages.find((item) => item.id === entry.id);
          if (pageRecord) {
            pageRecord.viewportIds.push(viewportId(viewport));
            if (screenshot) pageRecord.screenshotIds.push(screenshot.id);
          }
        } catch (error) {
          if (input.signal.aborted) {
            throw input.signal.reason instanceof Error ? input.signal.reason : error;
          }
          input.log(`Falha parcial em ${entry.id}/${viewportId(viewport)}; demais verificações continuarão.`, error);
        }
      }
      const scenarioResult = await executeScenarios(page, rootEntry, viewport, input, runtime.collector, actions, screenshots);
      scenariosCompleted += scenarioResult.completed;
      scenariosFailed += scenarioResult.failed;
      await page.close().catch(() => undefined);
    } finally {
      await runtime.context.close().catch(() => undefined);
    }
  });

  for (const entry of crawlEntries) {
    if (!entry.visited) {
      const reason = entry.skipReason || (entry.depth > input.config.maxDepth
        ? "Fora da profundidade configurada."
        : "Limite máximo de páginas atingido.");
      pages.push({
        id: entry.id,
        url: entry.url,
        normalizedUrl: entry.normalizedUrl,
        title: "",
        depth: entry.depth,
        validationStatus: "NOT_TESTED",
        discoveredFromPageId: entry.discoveredFromPageId,
        linksFound: 0,
        interactionsFound: 0,
        formsFound: 0,
        visitedAt: new Date().toISOString(),
        durationMs: 0,
        viewportIds: [],
        screenshotIds: [],
        skipReason: reason
      });
    }
  }

  markDuplicateNetworkRequests(network);
  const executedActions = countExecutedActions(actions);
  const interactionsDiscovered = pages.reduce((sum, page) => sum + page.interactionsFound * Math.max(1, page.viewportIds.length), 0);
  const coverage: AuditCoverage = {
    pagesDiscovered: crawlEntries.length,
    pagesVisited: pages.filter((page) => page.validationStatus === "VALIDATED_AUTOMATICALLY").length,
    pagesIgnored: pages.filter((page) => page.validationStatus === "NOT_TESTED").length,
    linksFound: linkCandidates.length,
    linksChecked: 0,
    interactionsDiscovered,
    interactionsExecuted: executedActions,
    interactionsSkippedSafety: actions.filter((action) => action.validationStatus === "NOT_EXECUTED_SAFETY").length,
    formsFound,
    formsTested,
    scenariosConfigured: input.config.scenarios.length * input.config.viewports.length,
    scenariosCompleted,
    scenariosFailed,
    blockedAuthentication,
    blockedCaptchaMfa,
    devices: input.config.viewports.map((viewport) => viewport.label || viewportId(viewport)),
    viewports: input.config.viewports,
    durationMs: Date.now() - startedAt,
    functionalCoveragePercent: calculateFunctionalCoverage({
      pagesDiscovered: crawlEntries.length,
      pagesVisited: pages.filter((page) => page.validationStatus === "VALIDATED_AUTOMATICALLY").length,
      interactionsDiscovered,
      interactionsExecuted: executedActions,
      formsFound,
      formsTested,
      scenariosConfigured: input.config.scenarios.length * input.config.viewports.length,
      scenariosCompleted
    })
  };

  const representativeScreenshots = selectRepresentativeScreenshotPaths(responsive, rootEntry.id);
  const passiveSecurity = buildPassiveSecurity(input.rootUrl, primaryHeaders, rootCookies, rootHtml, network);

  return {
    finalUrl,
    pages,
    actions,
    screenshots,
    network,
    consoleErrors,
    networkErrors,
    axeViolations,
    keyboardChecks,
    responsive,
    responsiveIssues,
    rootHtml,
    linkCandidates,
    coverage,
    passiveSecurity,
    desktopScreenshotPath: representativeScreenshots.desktop,
    mobileScreenshotPath: representativeScreenshots.mobile,
    primaryInsights
  };
}

async function createGuardedContext(
  input: BrowserAuditInput,
  viewport: AuditViewport,
  sharedConsoleErrors: ConsoleErrorResult[],
  sharedNetworkErrors: NetworkErrorResult[],
  sharedNetwork: AuditNetworkEvidence[]
): Promise<{ context: BrowserContext; collector: RuntimeCollector }> {
  throwIfAborted(input.signal);
  const context = await input.browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile === true,
    hasTouch: viewport.isMobile === true,
    acceptDownloads: false,
    userAgent: `AIWebAuditorBot/2.0 (${viewportId(viewport)})`,
    serviceWorkers: "block",
    reducedMotion: "reduce"
  });
  const collector: RuntimeCollector = {
    consoleErrors: sharedConsoleErrors,
    networkErrors: sharedNetworkErrors,
    network: sharedNetwork,
    requestStartedAt: new WeakMap(),
    urlCounts: new Map(),
    totalRequests: 0,
    totalDeclaredBytes: 0
  };

  await context.route("**/*", async (route) => {
    if (input.signal.aborted) {
      await route.abort("aborted").catch(() => undefined);
      return;
    }
    const requestUrl = route.request().url();
    if (/^(?:data|blob|about):/i.test(requestUrl)) {
      await route.continue();
      return;
    }
    if (!/^https?:/i.test(requestUrl)) {
      await route.abort("blockedbyclient");
      return;
    }
    collector.totalRequests += 1;
    if (
      collector.totalRequests > MAX_CONTEXT_REQUESTS ||
      collector.totalDeclaredBytes > MAX_TOTAL_DECLARED_BYTES
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    try {
      await input.validateUrl(requestUrl);
      await route.continue();
    } catch (error) {
      input.log(`Requisição bloqueada pela proteção SSRF: ${safeEvidenceUrl(requestUrl)}.`, error);
      await route.abort("blockedbyclient");
    }
  });

  context.on("page", (page) => {
    attachRuntimeListeners(page, collector, input);
    installPageGuards(page, input.signal);
  });
  return { context, collector };
}

function installPageGuards(page: Page, signal: AbortSignal): void {
  page.on("download", (download) => void download.cancel().catch(() => undefined));
  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
  const onAbort = () => void page.close({ runBeforeUnload: false }).catch(() => undefined);
  signal.addEventListener("abort", onAbort, { once: true });
  page.on("close", () => signal.removeEventListener("abort", onAbort));
}

function attachRuntimeListeners(page: Page, collector: RuntimeCollector, input: BrowserAuditInput): void {
  page.on("request", (request) => {
    collector.requestStartedAt.set(request, Date.now());
    const url = safeEvidenceUrl(request.url());
    collector.urlCounts.set(url, (collector.urlCounts.get(url) || 0) + 1);
  });

  page.on("console", (message) => {
    if (message.type() !== "error" && message.type() !== "warning") {
      return;
    }
    pushUnique(collector.consoleErrors, {
      id: `CONSOLE-${String(collector.consoleErrors.length + 1).padStart(3, "0")}`,
      type: message.type(),
      message: redactRuntimeText(message.text()).slice(0, 700),
      pageId: collector.currentPageId,
      url: safeEvidenceUrl(page.url()),
      timestamp: new Date().toISOString()
    });
  });

  page.on("pageerror", (error) => {
    pushUnique(collector.consoleErrors, {
      id: `CONSOLE-${String(collector.consoleErrors.length + 1).padStart(3, "0")}`,
      type: "pageerror",
      message: redactRuntimeText(error.message).slice(0, 700),
      pageId: collector.currentPageId,
      url: safeEvidenceUrl(page.url()),
      timestamp: new Date().toISOString()
    });
  });

  page.on("requestfailed", (request) => {
    const failureText = redactRuntimeText(request.failure()?.errorText || "Falha de rede");
    const url = safeEvidenceUrl(request.url());
    pushUnique(collector.networkErrors, {
      id: input.ids.nextNetwork(),
      url,
      method: request.method(),
      failureText,
      kind: "FAILED",
      pageId: collector.currentPageId
    });
    appendNetworkEvidence(collector, {
      id: input.ids.nextNetwork(),
      pageId: collector.currentPageId,
      url,
      method: request.method(),
      kind: "FAILED",
      failureText
    });
  });

  page.on("response", (response) => void collectResponse(response, collector, input));
}

async function collectResponse(
  response: PlaywrightResponse,
  collector: RuntimeCollector,
  input: BrowserAuditInput
): Promise<void> {
  const request = response.request();
  const durationMs = Math.max(0, Date.now() - (collector.requestStartedAt.get(request) || Date.now()));
  const headers: Record<string, string> = await response.allHeaders().catch(() => ({}));
  const declaredBytes = parseContentLength(headers["content-length"]);
  collector.totalDeclaredBytes += declaredBytes || 0;
  const statusCode = response.status();
  const url = safeEvidenceUrl(response.url());
  const isMixedContent = input.rootUrl.startsWith("https:") && response.url().startsWith("http:");
  const kind: AuditNetworkEvidence["kind"] =
    statusCode >= 400
      ? "HTTP_ERROR"
      : isMixedContent
        ? "MIXED_CONTENT"
        : declaredBytes !== undefined && declaredBytes > MAX_RESPONSE_BYTES
          ? "LARGE"
          : durationMs > SLOW_REQUEST_MS
            ? "SLOW"
            : "REQUEST";

  appendNetworkEvidence(collector, {
    id: input.ids.nextNetwork(),
    pageId: collector.currentPageId,
    url,
    method: request.method(),
    statusCode,
    durationMs,
    transferredBytes: declaredBytes,
    kind
  });
  if (kind !== "REQUEST") {
    pushUnique(collector.networkErrors, {
      id: `NETWORK-ISSUE-${String(collector.networkErrors.length + 1).padStart(3, "0")}`,
      url,
      method: request.method(),
      failureText:
        kind === "HTTP_ERROR"
          ? `Resposta HTTP ${statusCode}`
          : kind === "SLOW"
            ? `Requisição lenta (${durationMs} ms)`
            : kind === "LARGE"
              ? `Resposta acima do limite (${declaredBytes} bytes)`
              : "Conteúdo misto em página HTTPS",
      statusCode,
      durationMs,
      transferredBytes: declaredBytes,
      kind,
      pageId: collector.currentPageId
    });
  }
}

async function navigateStable(
  page: Page,
  url: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<PlaywrightResponse | null> {
  return runWithTimeout("navegação", timeoutMs, signal, async () => {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(8_000, timeoutMs) }).catch(() => undefined);
    await abortableDelay(350, signal);
    return response;
  });
}

async function captureScreenshot(
  page: Page,
  pageId: string,
  viewport: AuditViewport,
  stage: string,
  input: BrowserAuditInput,
  screenshots: AuditScreenshotEvidence[],
  actionId?: string,
  boundingBox?: BoundingBox | null
): Promise<AuditScreenshotEvidence> {
  const id = input.ids.nextScreenshot();
  const fileName = `${pageId.toLowerCase()}--${viewportId(viewport)}--${id.toLowerCase()}.png`;
  const absolutePath = path.join(input.screenshotDirectory, fileName);
  const relativePath = path.posix.join(input.screenshotRelativeRoot, fileName);
  const documentHeight = await page
    .evaluate(() => Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight || 0))
    .catch(() => viewport.height);
  await runWithTimeout("screenshot", Math.min(15_000, input.config.stageTimeoutSeconds * 1000), input.signal, () =>
    page.screenshot({
      path: absolutePath,
      fullPage: documentHeight <= 12_000,
      animations: "disabled",
      timeout: Math.min(15_000, input.config.stageTimeoutSeconds * 1000)
    })
  );
  const evidence: AuditScreenshotEvidence = {
    id,
    pageId,
    actionId,
    url: safeEvidenceUrl(page.url()),
    viewportId: viewportId(viewport),
    width: viewport.width,
    height: viewport.height,
    relativePath,
    stage,
    capturedAt: new Date().toISOString(),
    boundingBox
  };
  screenshots.push(evidence);
  return evidence;
}

async function captureScreenshotSafely(
  page: Page,
  pageId: string,
  viewport: AuditViewport,
  stage: string,
  input: BrowserAuditInput,
  screenshots: AuditScreenshotEvidence[],
  actionId?: string,
  boundingBox?: BoundingBox | null
): Promise<AuditScreenshotEvidence | null> {
  try {
    return await captureScreenshot(page, pageId, viewport, stage, input, screenshots, actionId, boundingBox);
  } catch (error) {
    if (input.signal.aborted) {
      throw input.signal.reason instanceof Error ? input.signal.reason : error;
    }
    input.log(
      `Falha parcial ao capturar screenshot ${stage.toLowerCase()} de ${pageId}/${viewportId(viewport)}; a auditoria continuará.`,
      error
    );
    return null;
  }
}

async function collectPageDomAudit(page: Page): Promise<PageDomAudit> {
  return page.evaluate(() => {
    type AnyControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    type LocalIssue = {
      kind:
        | "HORIZONTAL_OVERFLOW"
        | "SMALL_TAP_TARGET"
        | "TINY_TEXT"
        | "CLIPPED"
        | "OFFSCREEN"
        | "OVERLAP"
        | "OVERSIZED_MODAL"
        | "FIXED_OVERLAY"
        | "SCROLL_LOCKED";
      description: string;
      selector?: string;
      boundingBox?: BoundingBox | null;
    };
    const isVisible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    };
    const box = (element: Element): BoundingBox => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const cssSelector = (element: Element): string => {
      const htmlElement = element as HTMLElement;
      if (htmlElement.id) return `#${CSS.escape(htmlElement.id)}`;
      for (const attribute of ["data-testid", "data-test", "data-cy"]) {
        const value = element.getAttribute(attribute);
        if (value) return `[${attribute}="${CSS.escape(value)}"]`;
      }
      const name = element.getAttribute("name");
      if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      const parts: string[] = [];
      let cursor: Element | null = element;
      while (cursor && cursor !== document.body && parts.length < 4) {
        const tag = cursor.tagName.toLowerCase();
        const siblings = cursor.parentElement
          ? Array.from(cursor.parentElement.children).filter((sibling) => sibling.tagName === cursor!.tagName)
          : [];
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(cursor) + 1})` : tag);
        cursor = cursor.parentElement;
      }
      return parts.join(" > ");
    };
    const labelFor = (element: Element): string => {
      const id = element.getAttribute("id");
      const explicit = id ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`)?.innerText : "";
      return (
        explicit ||
        element.closest("label")?.textContent ||
        element.getAttribute("aria-label") ||
        ""
      ).trim();
    };
    const inferredRole = (element: Element): string | undefined => {
      const explicit = element.getAttribute("role");
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === "a" && element.hasAttribute("href")) return "link";
      if (tag === "button" || tag === "summary") return "button";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const type = (element.getAttribute("type") || "text").toLowerCase();
        if (["button", "submit", "reset"].includes(type)) return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        return "textbox";
      }
      return undefined;
    };
    const accessibleName = (element: Element): string => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || "")
            .join(" ")
        : "";
      const control = element as HTMLInputElement;
      return (
        element.getAttribute("aria-label") ||
        labelledText ||
        labelFor(element) ||
        element.getAttribute("title") ||
        control.value ||
        element.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
    };
    const allCandidates = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a[href],button,input,textarea,select,summary,[role='button'],[role='link'],[role='tab'],[role='menuitem'],[aria-expanded]"
      )
    ).filter(isVisible);
    const interactives = allCandidates.slice(0, 100).map((element) => {
      const role = inferredRole(element);
      const name = accessibleName(element);
      const label = labelFor(element);
      const testId = element.getAttribute("data-testid") || element.getAttribute("data-test") || element.getAttribute("data-cy") || undefined;
      const tag = element.tagName.toLowerCase();
      const type = element.getAttribute("type")?.toLowerCase();
      const form = element.closest("form");
      let kind: InteractiveElement["kind"] = "button";
      if (role === "link") kind = "link";
      else if (role === "tab") kind = "tab";
      else if (role === "menuitem" || element.getAttribute("aria-haspopup")) kind = "menu";
      else if (element.hasAttribute("aria-expanded") || tag === "summary") kind = "accordion";
      else if (role === "checkbox" || role === "radio") kind = "checkbox";
      else if (tag === "select") kind = "select";
      else if (tag === "textarea" || (tag === "input" && !["button", "submit", "reset", "checkbox", "radio"].includes(type || "text"))) kind = "input";
      else if (type === "submit" || (tag === "button" && form)) kind = "submit";

      const strategy: InteractiveElement["selectorStrategy"] =
        role && name
          ? "role"
          : label
            ? "label"
            : testId
              ? "testid"
              : element.textContent?.trim()
                ? "text"
                : "css";
      const selector =
        strategy === "role"
          ? `role=${role}[name="${name}"]`
          : strategy === "label"
            ? `label=${label}`
            : strategy === "testid"
              ? `testid=${testId}`
              : strategy === "text"
                ? `text=${(element.textContent || "").trim().slice(0, 120)}`
                : cssSelector(element);
      return {
        kind,
        tag,
        role,
        name,
        label: label || undefined,
        testId,
        text: (element.textContent || (element as HTMLInputElement).value || "").replace(/\s+/g, " ").trim().slice(0, 180),
        type,
        href: element instanceof HTMLAnchorElement ? element.href : undefined,
        selector,
        selectorStrategy: strategy,
        required: element.hasAttribute("required"),
        formHasRequired: Boolean(form?.querySelector("[required]")),
        boundingBox: box(element)
      };
    });

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((link) => link.href)
      .filter(Boolean)
      .slice(0, 500);
    const controls = Array.from(document.querySelectorAll<AnyControl>("input,textarea,select"));
    const inputsWithoutLabel = controls.filter((element) => {
      const id = element.id;
      return !element.getAttribute("aria-label") && !element.getAttribute("aria-labelledby") && !element.closest("label") && !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
    }).length;
    const visibleElements = Array.from(document.querySelectorAll<HTMLElement>("body *")).filter(isVisible).slice(0, 350);
    const smallTapElements = allCandidates.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width < 44 || rect.height < 44;
    });
    const tinyTextElements = visibleElements.filter((element) => {
      const text = element.innerText?.trim();
      if (!text || text.length < 12 || element.children.length > 3) return false;
      return Number.parseFloat(getComputedStyle(element).fontSize || "16") < 12;
    });
    const clippedElements = visibleElements.filter((element) => {
      const style = getComputedStyle(element);
      const clips = ["hidden", "clip"].includes(style.overflowX) || ["hidden", "clip"].includes(style.overflowY);
      return clips && (element.scrollWidth > element.clientWidth + 3 || element.scrollHeight > element.clientHeight + 3);
    });
    const offscreenElements = allCandidates.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right < -4 || rect.left > window.innerWidth + 4 || rect.bottom < -4;
    });
    const overlappingElements = allCandidates.filter((element) => {
      const rect = element.getBoundingClientRect();
      const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
      const top = document.elementFromPoint(x, y);
      if (!top || top === element || element.contains(top) || top.contains(element)) return false;
      const topStyle = getComputedStyle(top);
      return topStyle.pointerEvents !== "none";
    });
    const modals = visibleElements.filter((element) => element.getAttribute("role") === "dialog" || element.getAttribute("aria-modal") === "true");
    const oversizedModals = modals.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > window.innerWidth + 2 || rect.height > window.innerHeight + 2 || rect.left < -2 || rect.top < -2;
    });
    const fixedOverlays = visibleElements.filter((element) => {
      const style = getComputedStyle(element);
      if (style.position !== "fixed") return false;
      const rect = element.getBoundingClientRect();
      return rect.width * rect.height > window.innerWidth * window.innerHeight * 0.3;
    });
    const horizontalOverflow = document.documentElement.scrollWidth - window.innerWidth > 4;
    const scrollLocked =
      document.documentElement.scrollHeight > window.innerHeight + 10 &&
      ["hidden", "clip"].includes(getComputedStyle(document.body).overflowY);

    const issues: LocalIssue[] = [];
    if (horizontalOverflow) issues.push({ kind: "HORIZONTAL_OVERFLOW", description: "O documento excede horizontalmente a viewport." });
    smallTapElements.slice(0, 8).forEach((element) => issues.push({ kind: "SMALL_TAP_TARGET", description: "Alvo interativo menor que 44×44 px.", selector: cssSelector(element), boundingBox: box(element) }));
    tinyTextElements.slice(0, 5).forEach((element) => issues.push({ kind: "TINY_TEXT", description: "Texto visível menor que 12 px.", selector: cssSelector(element), boundingBox: box(element) }));
    clippedElements.slice(0, 5).forEach((element) => issues.push({ kind: "CLIPPED", description: "Conteúdo pode estar cortado por overflow.", selector: cssSelector(element), boundingBox: box(element) }));
    offscreenElements.slice(0, 5).forEach((element) => issues.push({ kind: "OFFSCREEN", description: "Controle interativo está fora da área navegável visível.", selector: cssSelector(element), boundingBox: box(element) }));
    overlappingElements.slice(0, 5).forEach((element) => issues.push({ kind: "OVERLAP", description: "Outro elemento intercepta o centro deste controle; requer confirmação manual.", selector: cssSelector(element), boundingBox: box(element) }));
    oversizedModals.slice(0, 3).forEach((element) => issues.push({ kind: "OVERSIZED_MODAL", description: "Modal excede a viewport.", selector: cssSelector(element), boundingBox: box(element) }));
    fixedOverlays.slice(0, 3).forEach((element) => issues.push({ kind: "FIXED_OVERLAY", description: "Overlay fixo cobre mais de 30% da viewport.", selector: cssSelector(element), boundingBox: box(element) }));
    if (scrollLocked) issues.push({ kind: "SCROLL_LOCKED", description: "O conteúdo excede a viewport, mas o scroll vertical do body está bloqueado." });

    return {
      insights: {
        title: document.title || "",
        metaDescription: document.querySelector<HTMLMetaElement>("meta[name='description']")?.content || "",
        h1Count: document.querySelectorAll("h1").length,
        links,
        imagesMissingAlt: document.querySelectorAll("img:not([alt])").length,
        buttonsWithoutLabel: Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter((button) => !accessibleName(button)).length,
        inputsWithoutLabel,
        smallTapTargets: smallTapElements.length,
        horizontalOverflow,
        tinyTextBlocks: tinyTextElements.length,
        clippedElements: clippedElements.length,
        offscreenElements: offscreenElements.length,
        overlappingElements: overlappingElements.length,
        oversizedModals: oversizedModals.length,
        fixedOverlayRisks: fixedOverlays.length,
        scrollLocked
      },
      links,
      interactives,
      formsFound: document.querySelectorAll("form").length,
      responsiveIssues: issues
    };
  });
}

async function runAxe(
  page: Page,
  pageId: string,
  viewportIdValue: string,
  output: AxeViolationEvidence[]
): Promise<void> {
  try {
    const result = await new AxeBuilder({ page }).analyze();
    for (const violation of result.violations.slice(0, 30)) {
      output.push({
        id: violation.id,
        impact: violation.impact ?? null,
        description: violation.description,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.length,
        pageId,
        viewportId: viewportIdValue
      });
    }
  } catch {
    // A failure to inject axe is reported as a limitation by the orchestrator;
    // it must not discard the browser evidence already collected.
  }
}

async function checkKeyboardFocus(
  page: Page,
  pageId: string,
  viewportIdValue: string
): Promise<BrowserAuditResult["keyboardChecks"][number]> {
  try {
    await page.keyboard.press("Tab");
    const result = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body) return null;
      const style = getComputedStyle(active);
      return {
        tag: active.tagName.toLowerCase(),
        name: (active.getAttribute("aria-label") || active.textContent || active.getAttribute("name") || "").trim().slice(0, 80),
        outline: style.outlineStyle,
        boxShadow: style.boxShadow
      };
    });
    return {
      pageId,
      viewportId: viewportIdValue,
      validationStatus: result ? "VALIDATED_PARTIALLY" : "FAILED",
      details: result
        ? `Tab moveu o foco para ${result.tag}${result.name ? ` (${result.name})` : ""}; indicador visual requer revisão manual.`
        : "Tab não moveu o foco para um controle detectável."
    };
  } catch (error) {
    return { pageId, viewportId: viewportIdValue, validationStatus: "FAILED", details: safeMessage(error) };
  }
}

function selectPrimaryViewport(viewports: AuditViewport[]): AuditViewport {
  return (
    viewports.find((viewport) => !viewport.isMobile && viewport.width >= 1024) ??
    viewports.find((viewport) => !viewport.isMobile) ??
    viewports[0] ??
    { id: "desktop", label: "Desktop", width: 1440, height: 900, isMobile: false }
  );
}

function emptyInsights(): DomInsights {
  return {
    title: "",
    metaDescription: "",
    h1Count: 0,
    links: [],
    imagesMissingAlt: 0,
    buttonsWithoutLabel: 0,
    inputsWithoutLabel: 0,
    smallTapTargets: 0,
    horizontalOverflow: false,
    tinyTextBlocks: 0,
    clippedElements: 0,
    offscreenElements: 0,
    overlappingElements: 0,
    oversizedModals: 0,
    fixedOverlayRisks: 0,
    scrollLocked: false
  };
}

function addCrawlEntry(
  url: string,
  depth: number,
  discoveredFromPageId: string | undefined,
  entries: CrawlEntry[],
  byUrl: Map<string, CrawlEntry>,
  ids: EvidenceIdFactory
): CrawlEntry {
  const normalizedUrl = normalizeForCrawl(url);
  const existing = byUrl.get(normalizedUrl);
  if (existing) return existing;
  const entry: CrawlEntry = {
    id: ids.nextPage(),
    url,
    normalizedUrl,
    depth,
    discoveredFromPageId,
    visited: false
  };
  entries.push(entry);
  byUrl.set(normalizedUrl, entry);
  return entry;
}

async function authenticateContext(
  context: BrowserContext,
  input: BrowserAuditInput,
  viewport: AuditViewport,
  pageId: string,
  actions: AuditActionEvidence[]
): Promise<{ blockedAuthentication: number; blockedCaptchaMfa: number }> {
  const auth = input.config.authConfig;
  if (!auth) return { blockedAuthentication: 0, blockedCaptchaMfa: 0 };

  const actionId = input.ids.nextAction();
  const startedAt = Date.now();
  const decision = input.evaluateSafety({
    action: "fill",
    text: "fluxo de autenticação configurado",
    elementType: "password"
  });
  const base: Omit<AuditActionEvidence, "validationStatus" | "result" | "durationMs"> = {
    id: actionId,
    pageId,
    url: safeEvidenceUrl(auth.loginUrl || input.rootUrl),
    viewportId: viewportId(viewport),
    action: "AUTHENTICATE",
    element: "Formulário de autenticação configurado",
    selectorStrategy: "css",
    selector: auth.submitSelector || "button[type='submit'],input[type='submit']",
    accessibleName: "Autenticação",
    safetyClassification: decision.classification,
    relatedNetworkIds: [],
    relatedConsoleIds: [],
    reproductionSteps: ["Abrir a página de login configurada.", "Preencher as credenciais efêmeras.", "Enviar o formulário."]
  };

  if (!decision.allowed || !input.config.authorizationConfirmed || !auth.password) {
    actions.push({
      ...base,
      validationStatus: "BLOCKED_AUTHENTICATION",
      result: !auth.password ? "Credenciais de autenticação não foram fornecidas." : decision.reason,
      durationMs: Date.now() - startedAt
    });
    return { blockedAuthentication: 1, blockedCaptchaMfa: 0 };
  }

  const page = await context.newPage();
  installPageGuards(page, input.signal);
  try {
    const loginUrl = await input.validateUrl(auth.loginUrl || input.rootUrl);
    await navigateStable(page, loginUrl, input.config.stageTimeoutSeconds * 1000, input.signal);
    if (await hasSecurityChallenge(page)) {
      actions.push({
        ...base,
        url: safeEvidenceUrl(page.url()),
        safetyClassification: "BLOCKED",
        validationStatus: "BLOCKED_CAPTCHA_MFA",
        result: "O login apresentou CAPTCHA, MFA ou desafio de segurança e não foi contornado.",
        durationMs: Date.now() - startedAt
      });
      return { blockedAuthentication: 0, blockedCaptchaMfa: 1 };
    }

    const usernameSelector = auth.usernameSelector || "input[autocomplete='username'],input[type='email'],input[name='username']";
    const passwordSelector = auth.passwordSelector || "input[autocomplete='current-password'],input[type='password']";
    const submitSelector = auth.submitSelector || "button[type='submit'],input[type='submit']";
    if (auth.username) {
      await page.locator(usernameSelector).first().fill(auth.username, { timeout: 8_000 });
    }
    await page.locator(passwordSelector).first().fill(auth.password, { timeout: 8_000 });
    await page.locator(submitSelector).first().click({ timeout: 8_000 });
    await page.waitForLoadState("domcontentloaded", { timeout: Math.min(12_000, input.config.stageTimeoutSeconds * 1000) }).catch(() => undefined);
    await abortableDelay(350, input.signal);

    const expectedUrlMatches = !auth.expectedUrl || page.url().includes(auth.expectedUrl);
    const expectedSelectorMatches = !auth.expectedSelector || (await page.locator(auth.expectedSelector).count()) > 0;
    const challenged = await hasSecurityChallenge(page);
    const success = expectedUrlMatches && expectedSelectorMatches && !challenged;
    actions.push({
      ...base,
      url: safeEvidenceUrl(page.url()),
      validationStatus: challenged ? "BLOCKED_CAPTCHA_MFA" : success ? "VALIDATED_PARTIALLY" : "FAILED",
      result: challenged
        ? "O fluxo solicitou CAPTCHA ou MFA após o envio."
        : success
          ? "Autenticação concluída segundo os critérios configurados."
          : "A autenticação não atingiu o estado esperado.",
      durationMs: Date.now() - startedAt,
      afterUrl: safeEvidenceUrl(page.url()),
      stateChanged: true
    });
    return {
      blockedAuthentication: success || challenged ? 0 : 1,
      blockedCaptchaMfa: challenged ? 1 : 0
    };
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : error;
    actions.push({
      ...base,
      validationStatus: "BLOCKED_AUTHENTICATION",
      result: "O fluxo de autenticação falhou.",
      error: safeMessage(error),
      durationMs: Date.now() - startedAt
    });
    return { blockedAuthentication: 1, blockedCaptchaMfa: 0 };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function executeDiscoveredInteractions(
  page: Page,
  entry: CrawlEntry,
  viewport: AuditViewport,
  interactives: InteractiveElement[],
  input: BrowserAuditInput,
  collector: RuntimeCollector,
  actions: AuditActionEvidence[],
  screenshots: AuditScreenshotEvidence[]
): Promise<{ formsTested: number; blockedCaptchaMfa: number }> {
  const configured = Number(process.env.AUDITOR_MAX_DISCOVERED_ACTIONS_PER_PAGE || 12);
  const maximum = Number.isFinite(configured) ? Math.max(0, Math.min(30, Math.trunc(configured))) : 12;
  let formsTested = 0;
  let blockedCaptchaMfa = 0;

  for (const element of interactives.slice(0, maximum)) {
    throwIfAborted(input.signal);
    const actionName = element.kind === "checkbox" ? "check" : element.kind === "input" ? "fill" : "click";
    const decision = input.evaluateSafety({
      action: actionName,
      text: [element.name, element.label, element.text].filter(Boolean).join(" "),
      href: element.href,
      elementType: element.type || element.kind
    });
    const actionId = input.ids.nextAction();
    const startedAt = Date.now();
    const beforeUrl = safeEvidenceUrl(page.url());
    const base: Omit<AuditActionEvidence, "validationStatus" | "result" | "durationMs"> = {
      id: actionId,
      pageId: entry.id,
      url: beforeUrl,
      viewportId: viewportId(viewport),
      action: actionName.toUpperCase(),
      element: element.name || element.label || element.text || element.tag,
      selectorStrategy: element.selectorStrategy,
      selector: element.selector,
      accessibleName: element.name || undefined,
      safetyClassification: decision.classification,
      relatedNetworkIds: [],
      relatedConsoleIds: [],
      reproductionSteps: [`Abrir ${entry.normalizedUrl}.`, `Localizar ${element.selector}.`, `Executar ${actionName}.`],
      beforeUrl,
      boundingBox: element.boundingBox
    };

    const hrefPolicy = element.href ? input.evaluateUrlPolicy(element.href) : { allowed: true };
    if (!decision.allowed || decision.classification !== "SAFE" || !hrefPolicy.allowed) {
      actions.push({
        ...base,
        validationStatus: "NOT_EXECUTED_SAFETY",
        result: hrefPolicy.allowed ? decision.reason : hrefPolicy.reason || "Destino fora do escopo autorizado.",
        durationMs: Date.now() - startedAt
      });
      continue;
    }

    const networkStart = collector.network.length;
    const consoleStart = collector.consoleErrors.length;
    try {
      const locator = resolveInteractiveLocator(page, element);
      await locator.waitFor({ state: "visible", timeout: 3_000 });
      await locator.click({ timeout: Math.min(6_000, input.config.stageTimeoutSeconds * 1000) });
      await page.waitForLoadState("domcontentloaded", { timeout: 4_000 }).catch(() => undefined);
      await abortableDelay(250, input.signal);
      if (await hasSecurityChallenge(page)) {
        blockedCaptchaMfa += 1;
        actions.push({
          ...base,
          safetyClassification: "BLOCKED",
          validationStatus: "BLOCKED_CAPTCHA_MFA",
          result: "A interação abriu um desafio CAPTCHA/MFA; nenhuma tentativa de contorno foi feita.",
          durationMs: Date.now() - startedAt,
          afterUrl: safeEvidenceUrl(page.url())
        });
        continue;
      }
      const screenshot = await captureScreenshotSafely(
        page,
        entry.id,
        viewport,
        "ACTION",
        input,
        screenshots,
        actionId,
        element.boundingBox
      );
      const afterUrl = safeEvidenceUrl(page.url());
      actions.push({
        ...base,
        validationStatus: "VALIDATED_PARTIALLY",
        result: screenshot
          ? "Interação somente leitura executada; o resultado visual foi capturado."
          : "Interação somente leitura executada; a captura visual ficou indisponível.",
        durationMs: Date.now() - startedAt,
        screenshotId: screenshot?.id,
        relatedNetworkIds: collector.network.slice(networkStart).map((item) => item.id),
        relatedConsoleIds: collector.consoleErrors.slice(consoleStart).map((item) => item.id).filter(Boolean) as string[],
        afterUrl,
        stateChanged: beforeUrl !== afterUrl
      });

      if (normalizeForCrawl(page.url()) !== entry.normalizedUrl) {
        const safeReturnUrl = await input.validateUrl(entry.url);
        await navigateStable(page, safeReturnUrl, input.config.stageTimeoutSeconds * 1000, input.signal);
      }
    } catch (error) {
      if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : error;
      actions.push({
        ...base,
        validationStatus: "FAILED",
        result: "A interação não pôde ser validada automaticamente.",
        error: safeMessage(error),
        durationMs: Date.now() - startedAt,
        relatedNetworkIds: collector.network.slice(networkStart).map((item) => item.id),
        relatedConsoleIds: collector.consoleErrors.slice(consoleStart).map((item) => item.id).filter(Boolean) as string[]
      });
    }
  }
  return { formsTested, blockedCaptchaMfa };
}

async function executeScenarios(
  page: Page,
  rootEntry: CrawlEntry,
  viewport: AuditViewport,
  input: BrowserAuditInput,
  collector: RuntimeCollector,
  actions: AuditActionEvidence[],
  screenshots: AuditScreenshotEvidence[]
): Promise<{ completed: number; failed: number }> {
  if (input.config.scenarios.length === 0) return { completed: 0, failed: 0 };
  let completed = 0;
  let failed = 0;

  for (const scenario of input.config.scenarios) {
    throwIfAborted(input.signal);
    let scenarioFailed = false;
    const safeRoot = await input.validateUrl(rootEntry.url);
    await navigateStable(page, safeRoot, input.config.stageTimeoutSeconds * 1000, input.signal);
    for (const [stepIndex, step] of (scenario.steps || []).slice(0, 50).entries()) {
      throwIfAborted(input.signal);
      const actionId = input.ids.nextAction();
      const startedAt = Date.now();
      const beforeUrl = safeEvidenceUrl(page.url());
      const target = String(step.target || "").slice(0, 500);
      const decision = input.evaluateSafety({
        action: step.action,
        text: `${scenario.name} ${target}`,
        href: step.action === "navigate" ? target : undefined,
        elementType: step.action
      });
      const base: Omit<AuditActionEvidence, "validationStatus" | "result" | "durationMs"> = {
        id: actionId,
        pageId: rootEntry.id,
        url: beforeUrl,
        viewportId: viewportId(viewport),
        action: step.action.toUpperCase(),
        element: target || `Etapa ${stepIndex + 1}`,
        selectorStrategy: "css",
        selector: target || "body",
        accessibleName: scenario.name,
        safetyClassification: decision.classification,
        relatedNetworkIds: [],
        relatedConsoleIds: [],
        reproductionSteps: [`Executar o cenário ${scenario.name}.`, `Executar a etapa ${stepIndex + 1}: ${step.action}.`],
        beforeUrl
      };
      if (!decision.allowed) {
        actions.push({
          ...base,
          validationStatus: "NOT_EXECUTED_SAFETY",
          result: decision.reason,
          durationMs: Date.now() - startedAt
        });
        scenarioFailed = true;
        break;
      }

      const networkStart = collector.network.length;
      const consoleStart = collector.consoleErrors.length;
      try {
        await executeScenarioStep(page, step, input);
        if (await hasSecurityChallenge(page)) {
          actions.push({
            ...base,
            safetyClassification: "BLOCKED",
            validationStatus: "BLOCKED_CAPTCHA_MFA",
            result: "A etapa encontrou CAPTCHA ou MFA e foi interrompida.",
            durationMs: Date.now() - startedAt,
            afterUrl: safeEvidenceUrl(page.url())
          });
          scenarioFailed = true;
          break;
        }
        const screenshot = step.action === "assert"
          ? undefined
          : await captureScreenshotSafely(page, rootEntry.id, viewport, "SCENARIO", input, screenshots, actionId);
        actions.push({
          ...base,
          validationStatus: "VALIDATED_AUTOMATICALLY",
          result: screenshot === null
            ? "Etapa do cenário concluída; a captura visual ficou indisponível."
            : "Etapa do cenário concluída.",
          durationMs: Date.now() - startedAt,
          screenshotId: screenshot?.id,
          relatedNetworkIds: collector.network.slice(networkStart).map((item) => item.id),
          relatedConsoleIds: collector.consoleErrors.slice(consoleStart).map((item) => item.id).filter(Boolean) as string[],
          afterUrl: safeEvidenceUrl(page.url()),
          stateChanged: beforeUrl !== safeEvidenceUrl(page.url()) || step.action !== "assert"
        });
      } catch (error) {
        if (input.signal.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : error;
        actions.push({
          ...base,
          validationStatus: "FAILED",
          result: "A etapa do cenário falhou.",
          error: safeMessage(error),
          durationMs: Date.now() - startedAt,
          relatedNetworkIds: collector.network.slice(networkStart).map((item) => item.id),
          relatedConsoleIds: collector.consoleErrors.slice(consoleStart).map((item) => item.id).filter(Boolean) as string[]
        });
        scenarioFailed = true;
        break;
      }
    }
    if (scenarioFailed) failed += 1;
    else completed += 1;
  }
  return { completed, failed };
}

async function executeScenarioStep(
  page: Page,
  step: ResolvedAuditConfiguration["scenarios"][number]["steps"] extends Array<infer T> | undefined ? T : never,
  input: BrowserAuditInput
): Promise<void> {
  const target = String(step.target || "");
  const value = String(step.value || "");
  switch (step.action) {
    case "navigate": {
      const safeUrl = await input.validateUrl(target || value || input.rootUrl);
      const policy = input.evaluateUrlPolicy(safeUrl);
      if (!policy.allowed) throw new Error(policy.reason || "Destino fora do escopo autorizado.");
      await navigateStable(page, safeUrl, input.config.stageTimeoutSeconds * 1000, input.signal);
      return;
    }
    case "click":
      await page.locator(target).first().click({ timeout: input.config.stageTimeoutSeconds * 1000 });
      return;
    case "fill":
      await page.locator(target).first().fill(value, { timeout: input.config.stageTimeoutSeconds * 1000 });
      return;
    case "select":
      await page.locator(target).first().selectOption(value, { timeout: input.config.stageTimeoutSeconds * 1000 });
      return;
    case "check":
      await page.locator(target).first().check({ timeout: input.config.stageTimeoutSeconds * 1000 });
      return;
    case "press":
      await page.locator(target || "body").first().press(value || "Enter", { timeout: input.config.stageTimeoutSeconds * 1000 });
      return;
    case "assert": {
      const locator = page.locator(target || "body").first();
      await locator.waitFor({ state: "visible", timeout: input.config.stageTimeoutSeconds * 1000 });
      const expected = String(step.expected || value || "");
      if (expected) {
        const text = (await locator.textContent()) || "";
        if (!text.includes(expected)) throw new Error("O conteúdo esperado não foi encontrado.");
      }
      return;
    }
  }
}

function resolveInteractiveLocator(page: Page, element: InteractiveElement): Locator {
  switch (element.selectorStrategy) {
    case "role":
      return page.getByRole((element.role || "button") as Parameters<Page["getByRole"]>[0], {
        name: element.name || undefined,
        exact: true
      }).first();
    case "label":
      return page.getByLabel(element.label || element.name, { exact: true }).first();
    case "testid":
      return page.getByTestId(element.testId || "").first();
    case "text":
      return page.getByText(element.text || element.name, { exact: true }).first();
    default:
      return page.locator(element.selector).first();
  }
}

async function hasSecurityChallenge(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const text = (document.body?.innerText || "").toLowerCase();
      const hasText = /\b(captcha|recaptcha|hcaptcha|turnstile|two[- ]factor|multi[- ]factor|verification code|código de verificação|autenticação de dois fatores|\bmfa\b|\botp\b)/i.test(text);
      const hasWidget = Boolean(document.querySelector("iframe[src*='captcha'],[class*='captcha'],[id*='captcha'],input[autocomplete='one-time-code']"));
      return hasText || hasWidget;
    })
    .catch(() => false);
}

function appendResponsiveIssues(
  dom: PageDomAudit,
  entry: CrawlEntry,
  viewport: AuditViewport,
  screenshotId: string | undefined,
  output: ResponsiveIssueEvidence[]
): void {
  for (const issue of dom.responsiveIssues) {
    output.push({
      ...issue,
      pageId: entry.id,
      viewportId: viewportId(viewport),
      url: safeEvidenceUrl(entry.url),
      screenshotId
    });
  }
}

function normalizeDiscoveredLink(rawUrl: string, baseUrl: string): string | null {
  try {
    const url = new URL(rawUrl, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeForCrawl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
      url.port = "";
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

async function limitedPageContent(page: Page): Promise<string> {
  const maximum = 1_000_000;
  const html = await page.content();
  return html.length <= maximum ? html : html.slice(0, maximum);
}

function countExecutedActions(actions: AuditActionEvidence[]): number {
  return actions.filter((action) =>
    action.validationStatus === "VALIDATED_AUTOMATICALLY" || action.validationStatus === "VALIDATED_PARTIALLY"
  ).length;
}

function calculateFunctionalCoverage(input: {
  pagesDiscovered: number;
  pagesVisited: number;
  interactionsDiscovered: number;
  interactionsExecuted: number;
  formsFound: number;
  formsTested: number;
  scenariosConfigured: number;
  scenariosCompleted: number;
}): number {
  const possible = input.pagesDiscovered + input.interactionsDiscovered + input.formsFound + input.scenariosConfigured;
  if (possible <= 0) return 0;
  const completed = input.pagesVisited + input.interactionsExecuted + input.formsTested + input.scenariosCompleted;
  return Math.max(0, Math.min(100, Math.round((completed / possible) * 100)));
}

function buildPassiveSecurity(
  rootUrl: string,
  headers: Record<string, string>,
  cookies: Awaited<ReturnType<BrowserContext["cookies"]>>,
  html: string,
  network: AuditNetworkEvidence[]
): PassiveSecurityResult {
  const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const headerNames = [
    "strict-transport-security",
    "content-security-policy",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy"
  ];
  const isHttps = rootUrl.startsWith("https:");
  const formTags = html.match(/<form\b[^>]*>/gi) || [];
  const insecureForms = formTags.filter((tag) =>
    /action\s*=\s*["']http:\/\//i.test(tag) || (!isHttps && /password|payment|card/i.test(tag))
  ).length;
  const possibleSensitiveHtmlSignals: string[] = [];
  if (/autocomplete\s*=\s*["'](?:cc-|one-time-code)/i.test(html)) possibleSensitiveHtmlSignals.push("sensitive-autocomplete-field");
  if (/type\s*=\s*["']password/i.test(html)) possibleSensitiveHtmlSignals.push("password-field");
  if (/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i.test(html)) possibleSensitiveHtmlSignals.push("private-key-material");

  return {
    https: isHttps,
    headers: Object.fromEntries(headerNames.map((name) => [name, normalizedHeaders[name] || null])),
    cookies: cookies.slice(0, 100).map((cookie) => ({
      name: cookie.name,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite
    })),
    insecureForms,
    mixedContentRequests: network.filter((item) => item.kind === "MIXED_CONTENT").length,
    possibleSensitiveHtmlSignals
  };
}

function markDuplicateNetworkRequests(network: AuditNetworkEvidence[]): void {
  const seen = new Set<string>();
  for (const item of network) {
    const key = `${item.method}:${item.url}`;
    if (seen.has(key) && item.kind === "REQUEST") item.kind = "DUPLICATE";
    else seen.add(key);
  }
}

function appendNetworkEvidence(collector: RuntimeCollector, item: AuditNetworkEvidence): void {
  if (collector.network.length < MAX_NETWORK_EVIDENCE) collector.network.push(item);
}

function parseContentLength(rawValue: string | undefined): number | undefined {
  if (!rawValue) return undefined;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function safeEvidenceUrl(rawUrl: string): string {
  try {
    return redactUrl(rawUrl).slice(0, 2_048);
  } catch {
    return "<url-invalid>";
  }
}

function redactRuntimeText(value: string): string {
  return redactText(value).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1_000);
}

function safeMessage(error: unknown): string {
  return redactRuntimeText(error instanceof Error ? error.message : String(error || "Erro desconhecido"));
}

function viewportId(viewport: AuditViewport): string {
  const raw = viewport.id || `${viewport.width}x${viewport.height}`;
  return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "viewport";
}

function pushUnique<T extends object>(list: T[], item: T): void {
  const comparable = (value: T) => JSON.stringify(
    Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "id"))
  );
  const key = comparable(item);
  if (!list.some((entry) => comparable(entry) === key)) list.push(item);
}
