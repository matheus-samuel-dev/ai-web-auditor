package com.aiwebauditor.audit;

import com.aiwebauditor.model.Audit;
import com.aiwebauditor.model.AuditIssue;
import com.aiwebauditor.model.AuditStatus;
import com.aiwebauditor.model.BrokenLink;
import com.aiwebauditor.model.ConsoleError;
import com.aiwebauditor.model.FindingResolutionStatus;
import com.aiwebauditor.model.IssueSeverity;
import com.aiwebauditor.model.IssueType;
import com.aiwebauditor.model.ValidationStatus;
import com.aiwebauditor.repository.AuditRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/** Orchestrates remote work without holding a database transaction open. */
@Service
public class AuditExecutionService {
  private static final Logger log = LoggerFactory.getLogger(AuditExecutionService.class);
  private final AuditStateService stateService;
  private final AuditorClient auditorClient;

  public AuditExecutionService(AuditStateService stateService, AuditorClient auditorClient) {
    this.stateService = stateService;
    this.auditorClient = auditorClient;
  }

  @Async("auditExecutor")
  public void executeAsync(UUID auditId, AuditRunConfiguration configuration) {
    long startMillis = System.currentTimeMillis();
    try {
      AuditExecutionTarget target = stateService.claim(auditId);
      if (target == null) {
        log.info("Execução ignorada porque a auditoria {} não está pendente", auditId);
        return;
      }
      log.info("Iniciando a auditoria {}", auditId);
      AuditorRunResponse result = auditorClient.runAudit(auditId, target.url(), configuration);
      stateService.complete(auditId, result, configuration);
      log.info("Auditoria {} finalizada em {} ms", auditId, System.currentTimeMillis() - startMillis);
    } catch (Exception exception) {
      stateService.fail(auditId, exception, configuration);
      log.error("Auditoria {} falhou após {} ms", auditId, System.currentTimeMillis() - startMillis, exception);
    }
  }

  public void updateProgress(UUID auditId, AuditProgressUpdateRequest request) {
    stateService.updateProgress(auditId, request);
  }

  public void failDispatch(UUID auditId, Exception exception, AuditRunConfiguration configuration) {
    stateService.fail(auditId, exception, configuration);
  }
}

record AuditExecutionTarget(UUID id, String url) {}

@Service
class AuditStateService {
  private static final Logger log = LoggerFactory.getLogger(AuditStateService.class);
  private final AuditRepository auditRepository;
  private final ObjectMapper objectMapper;

  AuditStateService(AuditRepository auditRepository, ObjectMapper objectMapper) {
    this.auditRepository = auditRepository;
    this.objectMapper = objectMapper;
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public AuditExecutionTarget claim(UUID auditId) {
    OffsetDateTime now = OffsetDateTime.now();
    if (auditRepository.claimForExecution(auditId, now) != 1) return null;
    Audit audit = auditRepository.findById(auditId).orElse(null);
    return audit == null ? null : new AuditExecutionTarget(audit.getId(), audit.getUrl());
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void complete(UUID auditId, AuditorRunResponse result, AuditRunConfiguration configuration) {
    Audit audit = auditRepository.findById(auditId).orElse(null);
    if (audit == null) return;
    if (audit.getStatus() == AuditStatus.CANCELLED || audit.isCancelRequested()) {
      log.info("Resultado descartado porque a auditoria {} foi cancelada", auditId);
      return;
    }
    if (audit.getStatus() != AuditStatus.RUNNING) {
      log.warn("Resultado descartado para a auditoria {} no estado {}", auditId, audit.getStatus());
      return;
    }

    applyResult(audit, result, configuration);
    audit.setStatus(AuditStatus.COMPLETED);
    audit.setCurrentStage("COMPLETED");
    audit.setStatusMessage("Auditoria concluída e pronta para exportação.");
    audit.setProgressPercent(100);
    audit.setCurrentPage(null);
    audit.setEstimatedRemainingSeconds(0);
    OffsetDateTime finishedAt = result.finishedAt() == null ? OffsetDateTime.now() : result.finishedAt();
    audit.setFinishedAt(finishedAt);
    if (audit.getStartedAt() != null) {
      audit.setDurationSeconds((int) Math.max(0, Duration.between(audit.getStartedAt(), finishedAt).toSeconds()));
      audit.setElapsedSeconds(audit.getDurationSeconds());
    }
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void fail(UUID auditId, Exception exception, AuditRunConfiguration configuration) {
    Audit audit = auditRepository.findById(auditId).orElse(null);
    if (audit == null || audit.getStatus() == AuditStatus.COMPLETED || audit.getStatus() == AuditStatus.CANCELLED) return;
    audit.setStatus(AuditStatus.FAILED);
    audit.setCurrentStage("FAILED");
    audit.setStatusMessage("A auditoria falhou antes da consolidação final.");
    audit.setFailureReason(buildFailureReason(exception, configuration));
    audit.setFinishedAt(OffsetDateTime.now());
    audit.setEstimatedRemainingSeconds(0);
    if (audit.getStartedAt() != null) {
      audit.setDurationSeconds((int) Math.max(0, Duration.between(audit.getStartedAt(), audit.getFinishedAt()).toSeconds()));
      audit.setElapsedSeconds(audit.getDurationSeconds());
    }
  }

  @Transactional(propagation = Propagation.REQUIRES_NEW)
  public void updateProgress(UUID auditId, AuditProgressUpdateRequest request) {
    Audit audit = auditRepository.findById(auditId).orElse(null);
    if (audit == null || isTerminal(audit.getStatus())) return;
    audit.setStatus(AuditStatus.RUNNING);
    if (audit.getStartedAt() == null) audit.setStartedAt(OffsetDateTime.now());
    audit.setProgressPercent(clamp(request.progressPercent(), 0, 99, audit.getProgressPercent()));
    audit.setCurrentStage(request.currentStage().trim());
    if (StringUtils.hasText(request.statusMessage())) audit.setStatusMessage(trim(request.statusMessage(), 500));
    if (StringUtils.hasText(request.currentPage())) audit.setCurrentPage(trim(request.currentPage(), 2048));
    if (request.pagesVisited() != null) audit.setPagesVisited(nonNegative(request.pagesVisited()));
    if (request.actionsExecuted() != null) audit.setActionsExecuted(nonNegative(request.actionsExecuted()));
    if (request.findingsCount() != null) audit.setFindingsCount(nonNegative(request.findingsCount()));
    Integer elapsed = request.elapsedSeconds();
    if (elapsed == null && request.elapsedMs() != null) elapsed = millisToSeconds(request.elapsedMs());
    Integer remaining = request.estimatedRemainingSeconds();
    if (remaining == null && request.estimatedRemainingMs() != null) remaining = millisToSeconds(request.estimatedRemainingMs());
    if (elapsed != null) audit.setElapsedSeconds(nonNegative(elapsed));
    if (remaining != null) audit.setEstimatedRemainingSeconds(nonNegative(remaining));
    applyCoverageUpdate(audit, request.coverage());
    log.debug("Progresso da auditoria {}: {}% - {}", auditId, audit.getProgressPercent(), audit.getCurrentStage());
  }

  private void applyResult(Audit audit, AuditorRunResponse result, AuditRunConfiguration configuration) {
    audit.setOverallScore(result.overallScore());
    audit.setPerformanceScore(result.performanceScore());
    audit.setAccessibilityScore(result.accessibilityScore());
    audit.setSeoScore(result.seoScore());
    audit.setBestPracticesScore(result.bestPracticesScore());
    audit.setDesktopScreenshotPath(redact(result.desktopScreenshotPath(), configuration));
    audit.setMobileScreenshotPath(redact(result.mobileScreenshotPath(), configuration));
    audit.setReportPdfPath(redact(result.reportPdfPath(), configuration));
    audit.setAiSummary(redact(result.aiSummary(), configuration));
    audit.setReportDataJson(writeReportData(result.reportData(), configuration));
    applyCoverageMap(audit, result.reportData());

    audit.getIssues().clear();
    if (result.issues() != null) {
      for (AuditorFinding finding : result.issues()) {
        AuditIssue issue = new AuditIssue();
        issue.setAudit(audit);
        issue.setEvidenceId(trim(firstText(finding.id(), first(finding.evidenceIds())), 80));
        issue.setType(parseIssueType(finding.type()));
        issue.setSeverity(parseSeverity(finding.severity()));
        issue.setValidationStatus(parseValidationStatus(finding.validationStatus()));
        issue.setConfidence(parseConfidence(finding.confidence()));
        issue.setTitle(trim(defaultText(redact(finding.title(), configuration), "Problema identificado"), 240));
        issue.setDescription(redact(finding.description(), configuration));
        issue.setRecommendation(redact(finding.recommendation(), configuration));
        issue.setSource(trim(redact(finding.source(), configuration), 80));
        issue.setPageUrl(trim(redact(finding.url(), configuration), 2048));
        issue.setDevice(trim(finding.viewportId(), 80));
        issue.setElement(trim(redact(finding.element(), configuration), 500));
        issue.setSelector(trim(redact(finding.selector(), configuration), 500));
        issue.setScreenshotPath(trim(redact(finding.screenshotPath(), configuration), 1024));
        issue.setReproductionSteps(finding.reproductionSteps() == null ? null
            : redact(String.join("\n", finding.reproductionSteps()), configuration));
        issue.setExpectedResult(redact(finding.expectedResult(), configuration));
        issue.setActualResult(redact(finding.actualResult(), configuration));
        issue.setImpact(redact(finding.impact(), configuration));
        issue.setEffort(trim(finding.effort(), 80));
        issue.setTechnicalReference(trim(redact(finding.technicalReference(), configuration), 1024));
        issue.setResolutionStatus(FindingResolutionStatus.OPEN);
        audit.getIssues().add(issue);
      }
    }
    audit.setFindingsCount(audit.getIssues().size());

    audit.getBrokenLinks().clear();
    if (result.brokenLinks() != null) {
      for (AuditorBrokenLink link : result.brokenLinks()) {
        BrokenLink brokenLink = new BrokenLink();
        brokenLink.setAudit(audit);
        brokenLink.setUrl(trim(redact(link.url(), configuration), 1024));
        brokenLink.setStatusCode(link.statusCode() == null ? 0 : link.statusCode());
        audit.getBrokenLinks().add(brokenLink);
      }
    }

    audit.getConsoleErrors().clear();
    if (result.consoleErrors() != null) {
      for (AuditorConsoleError item : result.consoleErrors()) {
        ConsoleError error = new ConsoleError();
        error.setAudit(audit);
        error.setMessage(defaultText(redact(item.message(), configuration), "Erro de console sem mensagem."));
        error.setType(trim(defaultText(item.type(), "ERROR"), 60));
        audit.getConsoleErrors().add(error);
      }
    }
  }

  @SuppressWarnings("unchecked")
  private void applyCoverageMap(Audit audit, Map<String, Object> reportData) {
    if (reportData == null || !(reportData.get("coverage") instanceof Map<?, ?> raw)) return;
    Map<String, Object> coverage = (Map<String, Object>) raw;
    audit.setPagesDiscovered(number(coverage, "pagesDiscovered", audit.getPagesDiscovered()));
    audit.setPagesVisited(number(coverage, "pagesVisited", audit.getPagesVisited()));
    audit.setPagesSkipped(number(coverage, "pagesIgnored", audit.getPagesSkipped()));
    audit.setLinksFound(number(coverage, "linksFound", audit.getLinksFound()));
    audit.setLinksChecked(number(coverage, "linksChecked", audit.getLinksChecked()));
    audit.setInteractionsDiscovered(number(coverage, "interactionsDiscovered", audit.getInteractionsDiscovered()));
    audit.setInteractionsExecuted(number(coverage, "interactionsExecuted", audit.getInteractionsExecuted()));
    audit.setActionsExecuted(audit.getInteractionsExecuted());
    audit.setFormsFound(number(coverage, "formsFound", audit.getFormsFound()));
    audit.setFormsTested(number(coverage, "formsTested", audit.getFormsTested()));
    audit.setFlowsCompleted(number(coverage, "scenariosCompleted", audit.getFlowsCompleted()));
    audit.setFlowsFailed(number(coverage, "scenariosFailed", audit.getFlowsFailed()));
    audit.setCoveragePercent(clamp(number(coverage, "functionalCoveragePercent", 0), 0, 100, 0));
    Object durationMs = coverage.get("durationMs");
    if (durationMs instanceof Number value) audit.setDurationSeconds(millisToSeconds(value.longValue()));
    audit.setDevicesJson(writeJson(coverage.get("devices")));
    audit.setViewportsJson(writeJson(coverage.get("viewports")));
  }

  private void applyCoverageUpdate(Audit audit, AuditCoverageUpdate update) {
    if (update == null) return;
    if (update.pagesDiscovered() != null) audit.setPagesDiscovered(nonNegative(update.pagesDiscovered()));
    if (update.pagesVisited() != null) audit.setPagesVisited(nonNegative(update.pagesVisited()));
    if (update.pagesSkipped() != null) audit.setPagesSkipped(nonNegative(update.pagesSkipped()));
    if (update.linksFound() != null) audit.setLinksFound(nonNegative(update.linksFound()));
    if (update.linksChecked() != null) audit.setLinksChecked(nonNegative(update.linksChecked()));
    if (update.interactionsDiscovered() != null) audit.setInteractionsDiscovered(nonNegative(update.interactionsDiscovered()));
    if (update.interactionsExecuted() != null) audit.setInteractionsExecuted(nonNegative(update.interactionsExecuted()));
    if (update.formsFound() != null) audit.setFormsFound(nonNegative(update.formsFound()));
    if (update.formsTested() != null) audit.setFormsTested(nonNegative(update.formsTested()));
    if (update.flowsCompleted() != null) audit.setFlowsCompleted(nonNegative(update.flowsCompleted()));
    if (update.flowsFailed() != null) audit.setFlowsFailed(nonNegative(update.flowsFailed()));
    if (update.coveragePercent() != null) audit.setCoveragePercent(clamp(update.coveragePercent(), 0, 100, 0));
  }

  private IssueType parseIssueType(String value) {
    if (value == null) return IssueType.AI;
    try { return IssueType.valueOf(value.trim().toUpperCase(Locale.ROOT)); }
    catch (IllegalArgumentException ignored) { return IssueType.AI; }
  }

  private IssueSeverity parseSeverity(String value) {
    if (value == null) return IssueSeverity.INFO;
    return switch (value.trim().toUpperCase(Locale.ROOT)) {
      case "CRITICAL" -> IssueSeverity.CRITICAL;
      case "HIGH" -> IssueSeverity.HIGH;
      case "MEDIUM", "MODERATE", "WARNING" -> IssueSeverity.MEDIUM;
      case "LOW" -> IssueSeverity.LOW;
      case "OPPORTUNITY" -> IssueSeverity.OPPORTUNITY;
      default -> IssueSeverity.INFO;
    };
  }

  private ValidationStatus parseValidationStatus(String value) {
    if (value == null) return ValidationStatus.AUTOMATICALLY_VALIDATED;
    return switch (value.trim().toUpperCase(Locale.ROOT)) {
      case "VALIDATED_AUTOMATICALLY", "AUTOMATICALLY_VALIDATED" -> ValidationStatus.AUTOMATICALLY_VALIDATED;
      case "VALIDATED_PARTIALLY", "PARTIALLY_VALIDATED" -> ValidationStatus.PARTIALLY_VALIDATED;
      case "NOT_TESTED" -> ValidationStatus.NOT_TESTED;
      case "BLOCKED_AUTHENTICATION" -> ValidationStatus.BLOCKED_AUTHENTICATION;
      case "BLOCKED_CAPTCHA_MFA", "BLOCKED_CAPTCHA_OR_MFA" -> ValidationStatus.BLOCKED_CAPTCHA_OR_MFA;
      case "NOT_EXECUTED_SAFETY", "SKIPPED_FOR_SAFETY" -> ValidationStatus.SKIPPED_FOR_SAFETY;
      case "FAILED" -> ValidationStatus.FAILED;
      default -> ValidationStatus.MANUAL_REVIEW_REQUIRED;
    };
  }

  private int parseConfidence(String value) {
    if (value == null) return 80;
    return switch (value.trim().toUpperCase(Locale.ROOT)) {
      case "HIGH" -> 95;
      case "LOW" -> 50;
      default -> 75;
    };
  }

  private String writeReportData(Object value, AuditRunConfiguration configuration) {
    return redact(writeJson(value == null ? Map.of() : value), configuration);
  }

  private String writeJson(Object value) {
    try { return objectMapper.writeValueAsString(value == null ? List.of() : value); }
    catch (JsonProcessingException exception) { return "[]"; }
  }

  private String redact(String value, AuditRunConfiguration configuration) {
    if (value == null || configuration == null) return value;
    String redacted = value;
    for (String secret : configuration.secretValues()) {
      redacted = redacted.replace(secret, "[REDACTED]");
    }
    return redacted;
  }

  private String buildFailureReason(Exception exception, AuditRunConfiguration configuration) {
    String message = exception instanceof com.aiwebauditor.common.ApiException ? exception.getMessage() : null;
    message = redact(message, configuration);
    if (!StringUtils.hasText(message)) return "A auditoria falhou por um erro interno inesperado.";
    return trim(message, 300);
  }

  private boolean isTerminal(AuditStatus status) {
    return status == AuditStatus.COMPLETED || status == AuditStatus.FAILED || status == AuditStatus.CANCELLED;
  }
  private int nonNegative(int value) { return Math.max(0, value); }
  private int millisToSeconds(long value) { return (int) Math.min(Integer.MAX_VALUE, Math.max(0, value / 1000)); }
  private int clamp(Integer value, int minimum, int maximum, Integer fallback) {
    return Math.max(minimum, Math.min(maximum, value == null ? fallback : value));
  }
  private int number(Map<String, Object> map, String key, Integer fallback) {
    Object value = map.get(key);
    return value instanceof Number number ? nonNegative(number.intValue()) : fallback == null ? 0 : fallback;
  }
  private String first(List<String> values) { return values == null || values.isEmpty() ? null : values.getFirst(); }
  private String firstText(String primary, String fallback) { return StringUtils.hasText(primary) ? primary : fallback; }
  private String defaultText(String value, String fallback) { return StringUtils.hasText(value) ? value : fallback; }
  private String trim(String value, int limit) {
    if (value == null) return null;
    String normalized = value.trim();
    return normalized.length() <= limit ? normalized : normalized.substring(0, limit);
  }
}
