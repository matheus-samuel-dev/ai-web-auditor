package com.aiwebauditor.audit;

import com.aiwebauditor.model.AuditMode;
import com.aiwebauditor.model.AuditStatus;
import com.aiwebauditor.model.FindingResolutionStatus;
import com.aiwebauditor.model.IssueSeverity;
import com.aiwebauditor.model.IssueType;
import com.aiwebauditor.model.ValidationStatus;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

record CreateAuditRequest(
    @NotBlank(message = "Informe a URL que deseja auditar.")
    @Size(max = 2048, message = "A URL é muito longa.")
    String url,
    UUID projectId,
    @Size(max = 120, message = "O nome do projeto deve ter no máximo 120 caracteres.")
    String projectName,
    AuditMode auditMode,
    @Min(value = 1, message = "Audite pelo menos uma página.")
    @Max(value = 30, message = "O limite máximo é de 30 páginas.")
    Integer maxPages,
    @Min(value = 0, message = "A profundidade mínima é 0.")
    @Max(value = 5, message = "A profundidade máxima é 5.")
    Integer maxDepth,
    @Min(value = 15, message = "O timeout mínimo é 15 segundos.")
    @Max(value = 900, message = "O timeout máximo é 900 segundos.")
    Integer timeoutSeconds,
    @Size(max = 50)
    List<@Size(max = 240) String> includePatterns,
    @Size(max = 50)
    List<@Size(max = 240) String> excludePatterns,
    @Valid
    @Size(max = 12)
    List<ViewportRequest> viewports,
    @NotNull(message = "Confirme que possui autorização para auditar o domínio.")
    @AssertTrue(message = "Você precisa confirmar que possui autorização para auditar o domínio.")
    Boolean authorizationConfirmed,
    Boolean testEnvironment,
    Boolean allowDestructiveActions,
    Boolean aiEnabled,
    @Valid AuthConfigRequest authConfig,
    @Valid @Size(max = 30) List<AuditScenarioRequest> scenarios
) {
  @AssertTrue(message = "Ações destrutivas só podem ser habilitadas em ambiente de teste.")
  boolean isDestructivePolicyValid() {
    return !Boolean.TRUE.equals(allowDestructiveActions) || Boolean.TRUE.equals(testEnvironment);
  }
}

record ViewportRequest(
    @NotBlank @Size(max = 40) String name,
    @Min(320) @Max(2560) int width,
    @Min(320) @Max(2560) int height,
    @Min(1) @Max(4) Integer deviceScaleFactor,
    Boolean mobile
) {}

record AuthConfigRequest(
    @Size(max = 2048) String loginUrl,
    @Size(max = 320) String username,
    @Size(max = 1024) String password,
    @Size(max = 240) String usernameSelector,
    @Size(max = 240) String passwordSelector,
    @Size(max = 240) String submitSelector,
    @Size(max = 2048) String expectedUrl,
    @Size(max = 240) String expectedSelector
) {
  AuthConfigRequest withoutCredentials() {
    return new AuthConfigRequest(
        loginUrl, null, null, usernameSelector, passwordSelector, submitSelector, expectedUrl, expectedSelector);
  }

  boolean hasCredentials() {
    return username != null && !username.isBlank() && password != null && !password.isBlank();
  }

  AuthConfigRequest withLoginUrl(String value) {
    return new AuthConfigRequest(
        value, username, password, usernameSelector, passwordSelector, submitSelector, expectedUrl, expectedSelector);
  }

  AuthConfigRequest mergeEphemeralCredentials(AuthConfigRequest value) {
    if (value == null) return this;
    return new AuthConfigRequest(
        firstPresent(value.loginUrl, loginUrl),
        value.username,
        value.password,
        firstPresent(value.usernameSelector, usernameSelector),
        firstPresent(value.passwordSelector, passwordSelector),
        firstPresent(value.submitSelector, submitSelector),
        firstPresent(value.expectedUrl, expectedUrl),
        firstPresent(value.expectedSelector, expectedSelector));
  }

  private static String firstPresent(String preferred, String fallback) {
    return preferred != null && !preferred.isBlank() ? preferred : fallback;
  }
}

record AuditScenarioRequest(
    @NotBlank @Size(max = 120) String name,
    @Valid @NotNull @Size(min = 1, max = 50) List<AuditScenarioStepRequest> steps
) {
  AuditScenarioRequest withoutSecrets() {
    return new AuditScenarioRequest(name, steps.stream().map(AuditScenarioStepRequest::withoutSecrets).toList());
  }

  boolean hasRedactedSecrets() {
    return steps.stream().anyMatch(AuditScenarioStepRequest::hasRedactedSecrets);
  }
}

record AuditScenarioStepRequest(
    @NotBlank @Size(max = 40) String action,
    @Size(max = 500) String target,
    @Size(max = 1000) String value,
    @Size(max = 1000) String expected,
    Boolean sensitive
) {
  private static final String REDACTED_VALUE = "[REDACTED]";
  private static final Pattern SENSITIVE_HINT = Pattern.compile(
      "(?i).*(password|passwd|secret|token|credential|authorization|api.?key|user(?:name)?|otp|mfa|pin).*"
  );

  boolean isSensitive() {
    return Boolean.TRUE.equals(sensitive)
        || SENSITIVE_HINT.matcher(action == null ? "" : action).matches()
        || SENSITIVE_HINT.matcher(target == null ? "" : target).matches();
  }

  AuditScenarioStepRequest withoutSecrets() {
    if (!isSensitive()) return this;
    return new AuditScenarioStepRequest(
        action,
        target,
        value == null || value.isBlank() ? value : REDACTED_VALUE,
        expected == null || expected.isBlank() ? expected : REDACTED_VALUE,
        true);
  }

  boolean hasRedactedSecrets() {
    return REDACTED_VALUE.equals(value) || REDACTED_VALUE.equals(expected);
  }

  List<String> secretValues() {
    if (!isSensitive()) return List.of();
    return java.util.stream.Stream.of(value, expected)
        .filter(item -> item != null && !item.isBlank() && !REDACTED_VALUE.equals(item))
        .toList();
  }
}

/** Immutable dispatch payload. The only in-memory instance may contain credentials. */
record AuditRunConfiguration(
    AuditMode auditMode,
    int maxPages,
    int maxDepth,
    int timeoutSeconds,
    List<String> includePatterns,
    List<String> excludePatterns,
    List<ViewportRequest> viewports,
    boolean authorizationConfirmed,
    boolean testEnvironment,
    boolean allowDestructiveActions,
    boolean aiEnabled,
    AuthConfigRequest authConfig,
    List<AuditScenarioRequest> scenarios
) {
  static AuditRunConfiguration from(CreateAuditRequest request) {
    AuditMode mode = request.auditMode() == null ? AuditMode.QUICK : request.auditMode();
    int defaultPages = mode == AuditMode.QUICK ? 1 : 20;
    return new AuditRunConfiguration(
        mode,
        request.maxPages() == null ? defaultPages : request.maxPages(),
        request.maxDepth() == null ? (mode == AuditMode.QUICK ? 0 : 3) : request.maxDepth(),
        request.timeoutSeconds() == null ? (mode == AuditMode.QUICK ? 180 : 900) : request.timeoutSeconds(),
        request.includePatterns() == null ? List.of() : List.copyOf(request.includePatterns()),
        request.excludePatterns() == null ? List.of() : List.copyOf(request.excludePatterns()),
        request.viewports() == null || request.viewports().isEmpty() ? defaultViewports() : List.copyOf(request.viewports()),
        Boolean.TRUE.equals(request.authorizationConfirmed()),
        Boolean.TRUE.equals(request.testEnvironment()),
        Boolean.TRUE.equals(request.allowDestructiveActions()),
        request.aiEnabled() == null || request.aiEnabled(),
        request.authConfig(),
        request.scenarios() == null ? List.of() : List.copyOf(request.scenarios()));
  }

  AuditRunConfiguration withoutCredentials() {
    return new AuditRunConfiguration(
        auditMode, maxPages, maxDepth, timeoutSeconds, includePatterns, excludePatterns, viewports,
        authorizationConfirmed, testEnvironment, allowDestructiveActions, aiEnabled,
        authConfig == null ? null : authConfig.withoutCredentials(),
        scenarios.stream().map(AuditScenarioRequest::withoutSecrets).toList());
  }

  boolean requiresEphemeralCredentials() {
    return auditMode == AuditMode.AUTHENTICATED;
  }

  boolean hasRedactedScenarioSecrets() {
    return scenarios.stream().anyMatch(AuditScenarioRequest::hasRedactedSecrets);
  }

  boolean requiresEphemeralInputs() {
    return requiresEphemeralCredentials() || hasRedactedScenarioSecrets();
  }

  List<String> secretValues() {
    java.util.stream.Stream<String> authenticationSecrets = authConfig == null
        ? java.util.stream.Stream.empty()
        : java.util.stream.Stream.of(authConfig.username(), authConfig.password());
    java.util.stream.Stream<String> scenarioSecrets = scenarios.stream()
        .flatMap(scenario -> scenario.steps().stream())
        .flatMap(step -> step.secretValues().stream());
    return java.util.stream.Stream.concat(authenticationSecrets, scenarioSecrets)
        .filter(value -> value != null && !value.isBlank())
        .distinct()
        .toList();
  }

  AuditRunConfiguration withAuthConfig(AuthConfigRequest value) {
    return new AuditRunConfiguration(
        auditMode, maxPages, maxDepth, timeoutSeconds, includePatterns, excludePatterns, viewports,
        authorizationConfirmed, testEnvironment, allowDestructiveActions, aiEnabled, value, scenarios);
  }

  AuditRunConfiguration withScenarios(List<AuditScenarioRequest> value) {
    return new AuditRunConfiguration(
        auditMode, maxPages, maxDepth, timeoutSeconds, includePatterns, excludePatterns, viewports,
        authorizationConfirmed, testEnvironment, allowDestructiveActions, aiEnabled, authConfig,
        value == null ? List.of() : List.copyOf(value));
  }

  private static List<ViewportRequest> defaultViewports() {
    return List.of(
        new ViewportRequest("mobile-360", 360, 800, 1, true),
        new ViewportRequest("mobile-390", 390, 844, 1, true),
        new ViewportRequest("mobile-414", 414, 896, 1, true),
        new ViewportRequest("tablet", 768, 1024, 1, true),
        new ViewportRequest("desktop", 1440, 900, 1, false));
  }
}

record AuditCoverageResponse(
    int pagesDiscovered,
    int pagesVisited,
    int pagesSkipped,
    int linksFound,
    int linksChecked,
    int interactionsDiscovered,
    int interactionsExecuted,
    int formsFound,
    int formsTested,
    int flowsCompleted,
    int flowsFailed,
    int findingsCount,
    int coveragePercent,
    Integer durationSeconds,
    List<String> devices,
    JsonNode viewports
) {}

record AuditListItemResponse(
    UUID id,
    String url,
    UUID projectId,
    String projectName,
    AuditMode auditMode,
    AuditStatus status,
    Integer overallScore,
    Integer performanceScore,
    Integer accessibilityScore,
    Integer seoScore,
    Integer bestPracticesScore,
    long criticalIssues,
    long totalIssues,
    Integer progressPercent,
    String currentStage,
    String currentPage,
    Integer actionsExecuted,
    Integer findingsCount,
    Integer elapsedSeconds,
    Integer estimatedRemainingSeconds,
    Integer coveragePercent,
    Integer pagesVisited,
    Integer interactionsExecuted,
    String statusMessage,
    OffsetDateTime createdAt,
    OffsetDateTime startedAt,
    OffsetDateTime finishedAt,
    String failureReason
) {}

record AuditHistoryPageResponse(
    List<AuditListItemResponse> items,
    int page,
    int size,
    long totalElements,
    int totalPages,
    boolean first,
    boolean last
) {}

record ScoreTimelinePointResponse(
    UUID auditId,
    String label,
    OffsetDateTime createdAt,
    Integer overallScore,
    Integer performanceScore,
    Integer accessibilityScore,
    Integer seoScore,
    Integer bestPracticesScore
) {}

record IssueTypeBreakdownResponse(String type, long total) {}

record CategoryAverageScoreResponse(String category, double score) {}

record DashboardSummaryResponse(
    long totalAudits,
    long completedAudits,
    long runningAudits,
    long failedAudits,
    long cancelledAudits,
    long monitoredProjects,
    double averageScore,
    double averageCoverage,
    long criticalIssues,
    AuditListItemResponse latestAudit,
    List<AuditListItemResponse> recentAudits,
    Map<String, Long> statusBreakdown,
    List<ScoreTimelinePointResponse> scoreTimeline,
    List<IssueTypeBreakdownResponse> issueTypeBreakdown,
    List<CategoryAverageScoreResponse> categoryAverages
) {}

record AuditIssueResponse(
    UUID id,
    String evidenceId,
    IssueType type,
    IssueSeverity severity,
    ValidationStatus validationStatus,
    Integer confidence,
    String title,
    String description,
    String recommendation,
    String source,
    String pageUrl,
    String device,
    String element,
    String selector,
    String screenshotPath,
    String reproductionSteps,
    String expectedResult,
    String actualResult,
    String impact,
    String effort,
    String technicalReference,
    FindingResolutionStatus resolutionStatus,
    String resolutionComment
) {}

record PatchAuditIssueRequest(
    FindingResolutionStatus resolutionStatus,
    @Size(max = 2000) String resolutionComment,
    ValidationStatus validationStatus
) {}

record BrokenLinkResponse(UUID id, String url, Integer statusCode) {}

record ConsoleErrorResponse(UUID id, String message, String type) {}

record AuditComparisonResponse(
    UUID previousAuditId,
    OffsetDateTime previousCreatedAt,
    Integer previousOverallScore,
    Integer currentOverallScore,
    Integer overallDelta,
    Integer previousPerformanceScore,
    Integer currentPerformanceScore,
    Integer performanceDelta,
    Integer previousAccessibilityScore,
    Integer currentAccessibilityScore,
    Integer accessibilityDelta,
    Integer previousSeoScore,
    Integer currentSeoScore,
    Integer seoDelta,
    Integer previousBestPracticesScore,
    Integer currentBestPracticesScore,
    Integer bestPracticesDelta,
    Integer previousCoveragePercent,
    Integer currentCoveragePercent,
    Integer coverageDelta,
    boolean baseline,
    String trendLabel
) {}

record AuditArtifactResponse(String status, String url, String message) {}

record AuditReportResponse(
    UUID id,
    String url,
    UUID projectId,
    String projectName,
    AuditMode auditMode,
    AuditStatus status,
    Integer overallScore,
    Integer performanceScore,
    Integer accessibilityScore,
    Integer seoScore,
    Integer bestPracticesScore,
    Integer progressPercent,
    String currentStage,
    String currentPage,
    Integer actionsExecuted,
    Integer findingsCount,
    Integer elapsedSeconds,
    Integer estimatedRemainingSeconds,
    String statusMessage,
    String aiSummary,
    String failureReason,
    OffsetDateTime createdAt,
    OffsetDateTime startedAt,
    OffsetDateTime finishedAt,
    AuditCoverageResponse coverage,
    String desktopScreenshotUrl,
    String mobileScreenshotUrl,
    String pdfDownloadUrl,
    String jsonDownloadUrl,
    String csvDownloadUrl,
    AuditArtifactResponse desktopScreenshotArtifact,
    AuditArtifactResponse mobileScreenshotArtifact,
    AuditArtifactResponse pdfArtifact,
    AuditArtifactResponse jsonArtifact,
    AuditComparisonResponse comparison,
    List<AuditIssueResponse> issues,
    List<BrokenLinkResponse> brokenLinks,
    List<ConsoleErrorResponse> consoleErrors,
    JsonNode reportData
) {}

record AuditProgressUpdateRequest(
    @Min(value = 0, message = "O progresso mínimo é 0.")
    @Max(value = 100, message = "O progresso máximo é 100.")
    Integer progressPercent,
    @NotBlank(message = "Informe a etapa atual.")
    @Size(max = 80)
    String currentStage,
    @Size(max = 500) String statusMessage,
    @Size(max = 2048) String currentPage,
    @Min(0) Integer pagesVisited,
    @Min(0) Integer actionsExecuted,
    @Min(0) Integer findingsCount,
    @Min(0) Integer elapsedSeconds,
    @Min(0) Integer estimatedRemainingSeconds,
    @Min(0) Long elapsedMs,
    @Min(0) Long estimatedRemainingMs,
    @Size(max = 50) List<@Size(max = 500) String> logs,
    @Valid AuditCoverageUpdate coverage
) {}

record AuditCoverageUpdate(
    @Min(0) Integer pagesDiscovered,
    @Min(0) Integer pagesVisited,
    @Min(0) Integer pagesSkipped,
    @Min(0) Integer linksFound,
    @Min(0) Integer linksChecked,
    @Min(0) Integer interactionsDiscovered,
    @Min(0) Integer interactionsExecuted,
    @Min(0) Integer formsFound,
    @Min(0) Integer formsTested,
    @Min(0) Integer flowsCompleted,
    @Min(0) Integer flowsFailed,
    @Min(0) @Max(100) Integer coveragePercent
) {}

record RetryAuditRequest(
    @Valid AuthConfigRequest authConfig,
    @Valid @Size(max = 30) List<AuditScenarioRequest> scenarios
) {}
