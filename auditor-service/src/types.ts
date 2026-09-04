export type AuditMode = "QUICK" | "FULL" | "AUTHENTICATED" | "GUIDED";

export type FindingType =
  | "PERFORMANCE"
  | "ACCESSIBILITY"
  | "SEO"
  | "BEST_PRACTICES"
  | "CONSOLE"
  | "NETWORK"
  | "BROKEN_LINK"
  | "RESPONSIVE"
  | "VISUAL"
  | "UX_UI"
  | "SECURITY"
  | "FUNCTIONAL"
  | "AI";

/** Kept compatible with the persistence enums used by the backend. */
export type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type ValidationStatus =
  | "VALIDATED_AUTOMATICALLY"
  | "VALIDATED_PARTIALLY"
  | "NOT_TESTED"
  | "BLOCKED_AUTHENTICATION"
  | "BLOCKED_CAPTCHA_MFA"
  | "NOT_EXECUTED_SAFETY"
  | "FAILED"
  | "REQUIRES_MANUAL_VALIDATION";

export type AuditExecutionStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export interface AuditViewport {
  id?: string;
  label?: string;
  width: number;
  height: number;
  isMobile?: boolean;
}

export interface AuditAuthConfig {
  loginUrl: string;
  username?: string;
  password?: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  expectedUrl?: string;
  expectedSelector?: string;
}

export interface AuditScenarioStep {
  action: "navigate" | "click" | "fill" | "select" | "check" | "assert" | "press";
  target?: string;
  value?: string;
  expected?: string;
}

export interface AuditScenario {
  id?: string;
  name: string;
  description?: string;
  steps?: AuditScenarioStep[];
}

export interface AuditConfiguration {
  auditMode: AuditMode | Lowercase<AuditMode>;
  maxPages: number;
  maxDepth: number;
  timeoutSeconds: number;
  stageTimeoutSeconds?: number;
  concurrency?: number;
  include?: string[];
  exclude?: string[];
  viewports?: Array<AuditViewport | string>;
  authorizationConfirmed: boolean;
  testEnvironment: boolean;
  allowDestructiveActions: boolean;
  aiEnabled: boolean;
  authConfig?: AuditAuthConfig | null;
  scenarios?: AuditScenario[];
}

/**
 * All configuration properties can be sent either inside `config` (new API) or
 * at the request root (migration compatibility). Legacy callers only need the
 * original four fields.
 */
export interface AuditRunRequest extends Partial<AuditConfiguration> {
  auditId: string;
  url: string;
  callbackUrl?: string | null;
  callbackToken?: string | null;
  config?: Partial<AuditConfiguration> | null;
}

export interface ResolvedAuditConfiguration extends Omit<AuditConfiguration, "auditMode" | "viewports"> {
  auditMode: AuditMode;
  stageTimeoutSeconds: number;
  concurrency: number;
  include: string[];
  exclude: string[];
  viewports: AuditViewport[];
  scenarios: AuditScenario[];
  authConfig: AuditAuthConfig | null;
}

export interface AuditProgressUpdatePayload {
  progressPercent: number;
  currentStage: string;
  statusMessage: string;
  status?: AuditExecutionStatus;
  currentPage?: string;
  pagesVisited?: number;
  actionsExecuted?: number;
  findingsCount?: number;
  elapsedMs?: number;
  estimatedRemainingMs?: number | null;
  logs?: string[];
}

export interface AuditFinding {
  id?: string;
  type: FindingType;
  severity: FindingSeverity;
  title: string;
  description: string;
  recommendation: string;
  source: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  validationStatus?: ValidationStatus;
  pageId?: string;
  actionId?: string;
  evidenceIds?: string[];
  viewportId?: string;
  url?: string;
  element?: string;
  selector?: string;
  screenshotPath?: string;
  boundingBox?: BoundingBox | null;
  reproductionSteps?: string[];
  expectedResult?: string;
  actualResult?: string;
  impact?: string;
  effort?: "LOW" | "MEDIUM" | "HIGH";
  technicalReference?: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrokenLinkResult {
  id?: string;
  url: string;
  statusCode: number;
  sourcePageId?: string;
  validationStatus?: ValidationStatus;
}

export interface ConsoleErrorResult {
  id?: string;
  message: string;
  type: string;
  pageId?: string;
  url?: string;
  timestamp?: string;
}

export interface NetworkErrorResult {
  id?: string;
  url: string;
  method: string;
  failureText: string;
  statusCode?: number;
  durationMs?: number;
  transferredBytes?: number;
  kind?: "FAILED" | "HTTP_ERROR" | "SLOW" | "LARGE" | "DUPLICATE" | "MIXED_CONTENT";
  pageId?: string;
}

export interface LighthouseOpportunity {
  id: string;
  title: string;
  description: string;
  score: number | null;
  displayValue?: string;
}

export interface LighthouseReportData {
  status?: "COMPLETED" | "FAILED" | "SKIPPED";
  failureReason?: string;
  scores: {
    performance: number | null;
    accessibility: number | null;
    seo: number | null;
    bestPractices: number | null;
  };
  metrics: {
    firstContentfulPaint?: string;
    largestContentfulPaint?: string;
    interactionToNextPaint?: string;
    speedIndex?: string;
    totalBlockingTime?: string;
    timeToInteractive?: string;
    cumulativeLayoutShift?: string;
    totalByteWeight?: string;
    requestCount?: number;
  };
  opportunities: LighthouseOpportunity[];
}

export interface AiAnalysis {
  executiveTitle: string;
  executiveSummary: string;
  confidenceLabel: string;
  releaseReadiness: string;
  topProblems: string[];
  quickWins: string[];
  practicalSuggestions: string[];
  correctionPriorities: string[];
  userImpact: string;
  businessImpact: string;
  technicalRecommendations: string[];
  enabled?: boolean;
  provider?: "OPENAI" | "DETERMINISTIC";
  evidenceIds?: string[];
  disclaimer?: string;
}

export interface DomInsights {
  title: string;
  metaDescription: string;
  h1Count: number;
  links: string[];
  imagesMissingAlt: number;
  buttonsWithoutLabel: number;
  inputsWithoutLabel: number;
  smallTapTargets: number;
  horizontalOverflow: boolean;
  tinyTextBlocks: number;
  clippedElements?: number;
  offscreenElements?: number;
  overlappingElements?: number;
  oversizedModals?: number;
  fixedOverlayRisks?: number;
  scrollLocked?: boolean;
}

export interface AuditPageEvidence {
  id: string;
  url: string;
  normalizedUrl: string;
  title: string;
  depth: number;
  statusCode?: number;
  validationStatus: ValidationStatus;
  discoveredFromPageId?: string;
  linksFound: number;
  interactionsFound: number;
  formsFound: number;
  visitedAt: string;
  durationMs: number;
  viewportIds: string[];
  screenshotIds: string[];
  skipReason?: string;
}

export interface AuditActionEvidence {
  id: string;
  pageId: string;
  url: string;
  viewportId: string;
  action: string;
  element: string;
  selectorStrategy: "role" | "label" | "testid" | "text" | "css";
  selector: string;
  accessibleName?: string;
  safetyClassification: "SAFE" | "REQUIRES_AUTHORIZATION" | "DESTRUCTIVE" | "BLOCKED";
  validationStatus: ValidationStatus;
  result: string;
  durationMs: number;
  screenshotId?: string;
  relatedNetworkIds: string[];
  relatedConsoleIds: string[];
  error?: string;
  reproductionSteps: string[];
  beforeUrl?: string;
  afterUrl?: string;
  stateChanged?: boolean;
  boundingBox?: BoundingBox | null;
}

export interface AuditScreenshotEvidence {
  id: string;
  pageId: string;
  actionId?: string;
  url: string;
  viewportId: string;
  width: number;
  height: number;
  relativePath: string;
  stage: string;
  capturedAt: string;
  boundingBox?: BoundingBox | null;
}

export interface AuditNetworkEvidence {
  id: string;
  pageId?: string;
  url: string;
  method: string;
  statusCode?: number;
  durationMs?: number;
  transferredBytes?: number;
  kind: "REQUEST" | "FAILED" | "HTTP_ERROR" | "SLOW" | "LARGE" | "DUPLICATE" | "MIXED_CONTENT";
  failureText?: string;
}

export interface AuditCoverage {
  pagesDiscovered: number;
  pagesVisited: number;
  pagesIgnored: number;
  linksFound: number;
  linksChecked: number;
  interactionsDiscovered: number;
  interactionsExecuted: number;
  interactionsSkippedSafety: number;
  formsFound: number;
  formsTested: number;
  scenariosConfigured: number;
  scenariosCompleted: number;
  scenariosFailed: number;
  blockedAuthentication: number;
  blockedCaptchaMfa: number;
  devices: string[];
  viewports: AuditViewport[];
  durationMs: number;
  functionalCoveragePercent: number;
}

export interface PassiveSecurityResult {
  https: boolean;
  headers: Record<string, string | null>;
  cookies: Array<{
    name: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: string;
  }>;
  insecureForms: number;
  mixedContentRequests: number;
  possibleSensitiveHtmlSignals: string[];
}

export interface AuditReportData {
  schemaVersion?: string;
  metadata: {
    auditId: string;
    url: string;
    finalUrl?: string;
    auditedAt: string;
    startedAt?: string;
    durationMs?: number;
    auditMode?: AuditMode;
    deterministic?: boolean;
  };
  configuration?: Omit<ResolvedAuditConfiguration, "authConfig"> & {
    authenticationConfigured: boolean;
  };
  summary: {
    overallScore: number | null;
    categoryScores: LighthouseReportData["scores"];
    ai: AiAnalysis;
  };
  issueSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    brokenLinks: number;
    consoleErrors: number;
    networkErrors: number;
  };
  coverage?: AuditCoverage;
  pages?: AuditPageEvidence[];
  actions?: AuditActionEvidence[];
  screenshots?: AuditScreenshotEvidence[];
  network?: AuditNetworkEvidence[];
  findings?: AuditFinding[];
  lighthouse: LighthouseReportData;
  axe: {
    violations: Array<{
      id: string;
      impact: string | null;
      description: string;
      help: string;
      helpUrl: string;
      nodes: number;
      pageId?: string;
      viewportId?: string;
    }>;
    violationCount: number;
    keyboardChecks?: Array<{
      pageId: string;
      viewportId: string;
      validationStatus: ValidationStatus;
      details: string;
    }>;
  };
  responsive: {
    desktop: {
      screenshotPath: string;
    };
    mobile: {
      screenshotPath: string;
      horizontalOverflow: boolean;
      smallTapTargets: number;
    };
    byViewport?: Array<{
      viewport: AuditViewport;
      pageId: string;
      screenshotPath: string;
      insights: DomInsights;
    }>;
  };
  passiveSecurity?: PassiveSecurityResult;
  visualFindings: string[];
  seoSignals: {
    title: string;
    metaDescriptionLength: number;
    h1Count: number;
  };
  consoleErrors: ConsoleErrorResult[];
  networkErrors: NetworkErrorResult[];
  brokenLinks: BrokenLinkResult[];
  limitations?: string[];
  artifacts?: {
    pdf: string;
    json: string;
  };
}

export interface AuditRunResponse {
  overallScore: number | null;
  performanceScore: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  bestPracticesScore: number | null;
  desktopScreenshotPath: string;
  mobileScreenshotPath: string;
  reportPdfPath: string;
  reportJsonPath?: string;
  aiSummary: string;
  finishedAt: string;
  reportData: AuditReportData;
  issues: AuditFinding[];
  brokenLinks: BrokenLinkResult[];
  consoleErrors: ConsoleErrorResult[];
}

export interface AuditRuntimeStatus {
  auditId: string;
  status: AuditExecutionStatus;
  progressPercent: number;
  currentStage: string;
  statusMessage: string;
  startedAt?: string;
  finishedAt?: string;
  elapsedMs: number;
  pagesVisited: number;
  actionsExecuted: number;
  findingsCount: number;
  currentPage?: string;
  cancellationRequested: boolean;
  error?: string;
}
