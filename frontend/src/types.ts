export type AuditStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type IssueSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "OPPORTUNITY" | "INFO";
export type ArtifactStatus = "GENERATING" | "AVAILABLE" | "FAILED" | "CANCELLED" | "UNAVAILABLE";
export type AuditMode = "QUICK" | "FULL" | "AUTHENTICATED" | "GUIDED";
export type ValidationStatus =
  | "AUTOMATICALLY_VALIDATED"
  | "PARTIALLY_VALIDATED"
  | "NOT_TESTED"
  | "BLOCKED_AUTHENTICATION"
  | "BLOCKED_CAPTCHA_OR_MFA"
  | "SKIPPED_FOR_SAFETY"
  | "FAILED"
  | "MANUAL_REVIEW_REQUIRED"
  // Valores presentes nas evidências brutas do auditor-service.
  | "VALIDATED_AUTOMATICALLY"
  | "VALIDATED_PARTIALLY"
  | "BLOCKED_CAPTCHA_MFA"
  | "NOT_EXECUTED_SAFETY"
  | "REQUIRES_MANUAL_VALIDATION";
export type ResolutionStatus = "OPEN" | "RESOLVED" | "IGNORED" | "REOPENED";
export type IssueType =
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

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface AuditListItem {
  id: string;
  url: string;
  status: AuditStatus;
  overallScore: number | null;
  performanceScore: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  bestPracticesScore: number | null;
  criticalIssues: number;
  totalIssues: number;
  progressPercent: number;
  currentStage: string;
  statusMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: string | null;
  projectId?: string | null;
  projectName?: string | null;
  auditMode?: AuditMode;
  coveragePercent?: number | null;
  currentPage?: string | null;
  actionsExecuted?: number;
  findingsCount?: number;
  pagesVisited?: number;
  interactionsExecuted?: number;
  elapsedSeconds?: number | null;
  estimatedRemainingSeconds?: number | null;
}

export interface AuditProject {
  id: string;
  name: string;
  url: string;
  domain?: string;
  environment: "PRODUCTION" | "STAGING" | "DEVELOPMENT" | string;
  frequency?: string | null;
  archived: boolean;
  baselineAuditId?: string | null;
  auditCount?: number;
  latestScore?: number | null;
  createdAt: string;
  updatedAt?: string;
}

export interface GuidedScenarioStep {
  action: GuidedScenarioAction;
  target?: string;
  value?: string;
  expected?: string;
  sensitive?: boolean;
}

export type GuidedScenarioAction = "navigate" | "click" | "fill" | "select" | "check" | "assert" | "press";

export interface GuidedScenario {
  name: string;
  steps: GuidedScenarioStep[];
}

export interface AuditAuthConfig {
  loginUrl: string;
  username: string;
  password: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  expectedUrl?: string;
  expectedSelector?: string;
}

export interface AuditViewport {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
}

export interface CreateAuditPayload {
  url: string;
  projectId?: string;
  projectName?: string;
  auditMode: AuditMode;
  maxPages: number;
  maxDepth: number;
  timeoutSeconds: number;
  includePatterns: string[];
  excludePatterns: string[];
  viewports: AuditViewport[];
  authorizationConfirmed: boolean;
  testEnvironment: boolean;
  allowDestructiveActions: boolean;
  aiEnabled: boolean;
  authConfig?: AuditAuthConfig;
  scenarios: GuidedScenario[];
}

export interface ScoreTimelinePoint {
  auditId: string;
  label: string;
  createdAt: string;
  overallScore: number | null;
  performanceScore: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  bestPracticesScore: number | null;
}

export interface IssueTypeBreakdownItem {
  type: string;
  total: number;
}

export interface CategoryAverageScore {
  category: string;
  score: number;
}

export interface DashboardSummary {
  totalAudits: number;
  completedAudits: number;
  runningAudits: number;
  failedAudits: number;
  cancelledAudits: number;
  monitoredProjects: number;
  averageScore: number;
  averageCoverage: number;
  criticalIssues: number;
  latestAudit: AuditListItem | null;
  recentAudits: AuditListItem[];
  statusBreakdown: Record<string, number>;
  scoreTimeline: ScoreTimelinePoint[];
  issueTypeBreakdown: IssueTypeBreakdownItem[];
  categoryAverages: CategoryAverageScore[];
}

export interface AuditIssue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  recommendation: string;
  source: string;
  evidenceId?: string | null;
  validationStatus?: ValidationStatus;
  resolutionStatus?: ResolutionStatus;
  confidence?: number | null;
  pageId?: string | null;
  pageUrl?: string | null;
  device?: string | null;
  element?: string | null;
  selector?: string | null;
  screenshotPath?: string | null;
  reproductionSteps?: string | null;
  expectedResult?: string | null;
  actualResult?: string | null;
  impact?: string | null;
  effort?: string | null;
  technicalReference?: string | null;
  resolutionComment?: string | null;
}

export interface BrokenLink {
  id: string;
  url: string;
  statusCode: number;
}

export interface ConsoleError {
  id: string;
  message: string;
  type: string;
}

export interface AuditComparison {
  previousAuditId: string;
  previousCreatedAt: string;
  previousOverallScore: number | null;
  currentOverallScore?: number | null;
  overallDelta: number | null;
  previousPerformanceScore?: number | null;
  currentPerformanceScore?: number | null;
  performanceDelta: number | null;
  previousAccessibilityScore?: number | null;
  currentAccessibilityScore?: number | null;
  accessibilityDelta: number | null;
  previousSeoScore?: number | null;
  currentSeoScore?: number | null;
  seoDelta: number | null;
  previousBestPracticesScore?: number | null;
  currentBestPracticesScore?: number | null;
  bestPracticesDelta: number | null;
  previousCoveragePercent?: number | null;
  currentCoveragePercent?: number | null;
  coverageDelta: number | null;
  baseline: boolean;
  trendLabel: string;
}

export interface AuditArtifact {
  status: ArtifactStatus;
  url: string | null;
  message: string;
}

export interface AiSummary {
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
}

export interface AuditReportData {
  metadata?: {
    auditId: string;
    url: string;
    auditedAt: string;
  };
  summary?: {
    overallScore: number | null;
    categoryScores: {
      performance: number | null;
      accessibility: number | null;
      seo: number | null;
      bestPractices: number | null;
    };
    ai: AiSummary;
  };
  issueSummary?: {
    critical: number;
    high?: number;
    medium: number;
    low: number;
    info: number;
    brokenLinks: number;
    consoleErrors: number;
    networkErrors: number;
  };
  lighthouse?: {
    status?: "COMPLETED" | "FAILED" | "SKIPPED";
    failureReason?: string;
    scores: {
      performance: number | null;
      accessibility: number | null;
      seo: number | null;
      bestPractices: number | null;
    };
    metrics: Record<string, string | number | undefined>;
    opportunities: Array<{
      id: string;
      title: string;
      description: string;
      score: number | null;
      displayValue?: string;
    }>;
  };
  axe?: {
    violationCount: number;
    violations: Array<{
      id: string;
      impact: string | null;
      description: string;
      help: string;
      helpUrl: string;
      nodes: number;
    }>;
  };
  responsive?: {
    desktop?: {
      screenshotPath: string;
    };
    mobile?: {
      screenshotPath?: string;
      horizontalOverflow: boolean;
      smallTapTargets: number;
    };
  };
  visualFindings?: string[];
  seoSignals?: {
    title: string;
    metaDescriptionLength: number;
    h1Count: number;
  };
  consoleErrors?: Array<{
    message: string;
    type: string;
  }>;
  networkErrors?: Array<{
    url: string;
    method: string;
    failureText: string;
  }>;
  brokenLinks?: Array<{
    url: string;
    statusCode: number;
  }>;
  coverage?: AuditCoverage;
  pages?: AuditPageEvidence[];
  actions?: AuditActionEvidence[];
  screenshots?: AuditScreenshotEvidence[];
  passiveSecurity?: PassiveSecurityResult;
  progressLogs?: AuditProgressLog[];
  limitations?: string[];
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

/** Cobertura normalizada e persistida pelo backend no nível superior do relatório. */
export interface AuditCoverageResponse {
  pagesDiscovered: number;
  pagesVisited: number;
  pagesSkipped: number;
  linksFound: number;
  linksChecked: number;
  interactionsDiscovered: number;
  interactionsExecuted: number;
  formsFound: number;
  formsTested: number;
  flowsCompleted: number;
  flowsFailed: number;
  findingsCount: number;
  coveragePercent: number;
  durationSeconds: number | null;
  devices: string[];
  viewports: AuditViewport[];
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
}

export interface PassiveSecurityResult {
  https: boolean;
  headers: Record<string, string | null>;
  cookies: Array<Record<string, unknown>>;
  mixedContent?: number;
  mixedContentRequests?: number;
  insecureForms: number;
  possibleSensitiveHtmlSignals?: string[];
}

export interface AuditProgressLog {
  timestamp?: string;
  stage?: string;
  message: string;
  level?: "INFO" | "WARN" | "ERROR" | string;
}

export interface AuditReport {
  id: string;
  url: string;
  status: AuditStatus;
  overallScore: number | null;
  performanceScore: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  bestPracticesScore: number | null;
  progressPercent: number;
  currentStage: string;
  statusMessage: string | null;
  aiSummary: string | null;
  failureReason: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  coverage?: AuditCoverageResponse | null;
  desktopScreenshotUrl: string | null;
  mobileScreenshotUrl: string | null;
  pdfDownloadUrl: string | null;
  jsonDownloadUrl: string | null;
  csvDownloadUrl: string | null;
  desktopScreenshotArtifact: AuditArtifact;
  mobileScreenshotArtifact: AuditArtifact;
  pdfArtifact: AuditArtifact;
  jsonArtifact: AuditArtifact;
  comparison: AuditComparison | null;
  issues: AuditIssue[];
  brokenLinks: BrokenLink[];
  consoleErrors: ConsoleError[];
  reportData: AuditReportData;
  projectId?: string | null;
  projectName?: string | null;
  auditMode?: AuditMode;
  coveragePercent?: number | null;
  currentPage?: string | null;
  actionsExecuted?: number;
  findingsCount?: number;
  elapsedSeconds?: number | null;
  estimatedRemainingSeconds?: number | null;
  progressLogs?: AuditProgressLog[];
}

export interface ApiError extends Error {
  status?: number;
  fieldErrors?: Record<string, string>;
}
