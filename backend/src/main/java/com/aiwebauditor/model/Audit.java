package com.aiwebauditor.model;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "audits")
public class Audit {

  @Id
  @GeneratedValue(strategy = GenerationType.UUID)
  private UUID id;

  @Version
  @Column(nullable = false)
  private long version;

  @Column(nullable = false, length = 2048)
  private String url;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 24)
  private AuditMode auditMode = AuditMode.QUICK;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false, length = 20)
  private AuditStatus status = AuditStatus.PENDING;

  private Integer overallScore;
  private Integer performanceScore;
  private Integer accessibilityScore;
  private Integer seoScore;
  private Integer bestPracticesScore;

  @Column(nullable = false)
  private Integer progressPercent = 0;
  @Column(nullable = false, length = 80)
  private String currentStage = "QUEUED";
  @Column(length = 500)
  private String statusMessage = "Na fila para iniciar a auditoria.";
  @Column(length = 2048)
  private String currentPage;
  @Column(nullable = false)
  private Integer actionsExecuted = 0;
  @Column(nullable = false)
  private Integer findingsCount = 0;
  private Integer elapsedSeconds;
  private Integer estimatedRemainingSeconds;

  @Column(nullable = false) private Integer pagesDiscovered = 0;
  @Column(nullable = false) private Integer pagesVisited = 0;
  @Column(nullable = false) private Integer pagesSkipped = 0;
  @Column(nullable = false) private Integer linksFound = 0;
  @Column(nullable = false) private Integer linksChecked = 0;
  @Column(nullable = false) private Integer interactionsDiscovered = 0;
  @Column(nullable = false) private Integer interactionsExecuted = 0;
  @Column(nullable = false) private Integer formsFound = 0;
  @Column(nullable = false) private Integer formsTested = 0;
  @Column(nullable = false) private Integer flowsCompleted = 0;
  @Column(nullable = false) private Integer flowsFailed = 0;
  @Column(nullable = false) private Integer coveragePercent = 0;
  private Integer durationSeconds;

  @Column(columnDefinition = "TEXT") private String devicesJson;
  @Column(columnDefinition = "TEXT") private String viewportsJson;
  @Column(columnDefinition = "TEXT") private String configJson;

  @Column(length = 1024) private String desktopScreenshotPath;
  @Column(length = 1024) private String mobileScreenshotPath;
  @Column(length = 1024) private String reportPdfPath;
  @Column(columnDefinition = "TEXT") private String aiSummary;
  @Column(columnDefinition = "TEXT") private String reportDataJson;
  @Column(length = 1024) private String failureReason;

  @Column(nullable = false) private Integer attemptCount = 1;
  @Column(nullable = false) private boolean cancelRequested;
  @Column(nullable = false) private OffsetDateTime createdAt;
  @Column(nullable = false) private OffsetDateTime updatedAt;
  private OffsetDateTime startedAt;
  private OffsetDateTime finishedAt;

  @ManyToOne(optional = false, fetch = FetchType.LAZY)
  @JoinColumn(name = "user_id", nullable = false)
  private User user;

  @ManyToOne(fetch = FetchType.LAZY)
  @JoinColumn(name = "project_id")
  private AuditProject project;

  @OneToMany(mappedBy = "audit", cascade = CascadeType.ALL, orphanRemoval = true)
  private List<AuditIssue> issues = new ArrayList<>();
  @OneToMany(mappedBy = "audit", cascade = CascadeType.ALL, orphanRemoval = true)
  private List<BrokenLink> brokenLinks = new ArrayList<>();
  @OneToMany(mappedBy = "audit", cascade = CascadeType.ALL, orphanRemoval = true)
  private List<ConsoleError> consoleErrors = new ArrayList<>();

  @PrePersist
  void onCreate() {
    OffsetDateTime now = OffsetDateTime.now();
    if (createdAt == null) createdAt = now;
    updatedAt = now;
  }

  @PreUpdate
  void onUpdate() {
    updatedAt = OffsetDateTime.now();
  }

  public UUID getId() { return id; }
  public void setId(UUID id) { this.id = id; }
  public long getVersion() { return version; }
  public void setVersion(long value) { version = value; }
  public String getUrl() { return url; }
  public void setUrl(String url) { this.url = url; }
  public AuditMode getAuditMode() { return auditMode; }
  public void setAuditMode(AuditMode auditMode) { this.auditMode = auditMode; }
  public AuditStatus getStatus() { return status; }
  public void setStatus(AuditStatus status) { this.status = status; }
  public Integer getOverallScore() { return overallScore; }
  public void setOverallScore(Integer value) { overallScore = value; }
  public Integer getPerformanceScore() { return performanceScore; }
  public void setPerformanceScore(Integer value) { performanceScore = value; }
  public Integer getAccessibilityScore() { return accessibilityScore; }
  public void setAccessibilityScore(Integer value) { accessibilityScore = value; }
  public Integer getSeoScore() { return seoScore; }
  public void setSeoScore(Integer value) { seoScore = value; }
  public Integer getBestPracticesScore() { return bestPracticesScore; }
  public void setBestPracticesScore(Integer value) { bestPracticesScore = value; }
  public Integer getProgressPercent() { return progressPercent; }
  public void setProgressPercent(Integer value) { progressPercent = value; }
  public String getCurrentStage() { return currentStage; }
  public void setCurrentStage(String value) { currentStage = value; }
  public String getStatusMessage() { return statusMessage; }
  public void setStatusMessage(String value) { statusMessage = value; }
  public String getCurrentPage() { return currentPage; }
  public void setCurrentPage(String value) { currentPage = value; }
  public Integer getActionsExecuted() { return actionsExecuted; }
  public void setActionsExecuted(Integer value) { actionsExecuted = value; }
  public Integer getFindingsCount() { return findingsCount; }
  public void setFindingsCount(Integer value) { findingsCount = value; }
  public Integer getElapsedSeconds() { return elapsedSeconds; }
  public void setElapsedSeconds(Integer value) { elapsedSeconds = value; }
  public Integer getEstimatedRemainingSeconds() { return estimatedRemainingSeconds; }
  public void setEstimatedRemainingSeconds(Integer value) { estimatedRemainingSeconds = value; }
  public Integer getPagesDiscovered() { return pagesDiscovered; }
  public void setPagesDiscovered(Integer value) { pagesDiscovered = value; }
  public Integer getPagesVisited() { return pagesVisited; }
  public void setPagesVisited(Integer value) { pagesVisited = value; }
  public Integer getPagesSkipped() { return pagesSkipped; }
  public void setPagesSkipped(Integer value) { pagesSkipped = value; }
  public Integer getLinksFound() { return linksFound; }
  public void setLinksFound(Integer value) { linksFound = value; }
  public Integer getLinksChecked() { return linksChecked; }
  public void setLinksChecked(Integer value) { linksChecked = value; }
  public Integer getInteractionsDiscovered() { return interactionsDiscovered; }
  public void setInteractionsDiscovered(Integer value) { interactionsDiscovered = value; }
  public Integer getInteractionsExecuted() { return interactionsExecuted; }
  public void setInteractionsExecuted(Integer value) { interactionsExecuted = value; }
  public Integer getFormsFound() { return formsFound; }
  public void setFormsFound(Integer value) { formsFound = value; }
  public Integer getFormsTested() { return formsTested; }
  public void setFormsTested(Integer value) { formsTested = value; }
  public Integer getFlowsCompleted() { return flowsCompleted; }
  public void setFlowsCompleted(Integer value) { flowsCompleted = value; }
  public Integer getFlowsFailed() { return flowsFailed; }
  public void setFlowsFailed(Integer value) { flowsFailed = value; }
  public Integer getCoveragePercent() { return coveragePercent; }
  public void setCoveragePercent(Integer value) { coveragePercent = value; }
  public Integer getDurationSeconds() { return durationSeconds; }
  public void setDurationSeconds(Integer value) { durationSeconds = value; }
  public String getDevicesJson() { return devicesJson; }
  public void setDevicesJson(String value) { devicesJson = value; }
  public String getViewportsJson() { return viewportsJson; }
  public void setViewportsJson(String value) { viewportsJson = value; }
  public String getConfigJson() { return configJson; }
  public void setConfigJson(String value) { configJson = value; }
  public String getDesktopScreenshotPath() { return desktopScreenshotPath; }
  public void setDesktopScreenshotPath(String value) { desktopScreenshotPath = value; }
  public String getMobileScreenshotPath() { return mobileScreenshotPath; }
  public void setMobileScreenshotPath(String value) { mobileScreenshotPath = value; }
  public String getReportPdfPath() { return reportPdfPath; }
  public void setReportPdfPath(String value) { reportPdfPath = value; }
  public String getAiSummary() { return aiSummary; }
  public void setAiSummary(String value) { aiSummary = value; }
  public String getReportDataJson() { return reportDataJson; }
  public void setReportDataJson(String value) { reportDataJson = value; }
  public String getFailureReason() { return failureReason; }
  public void setFailureReason(String value) { failureReason = value; }
  public Integer getAttemptCount() { return attemptCount; }
  public void setAttemptCount(Integer value) { attemptCount = value; }
  public boolean isCancelRequested() { return cancelRequested; }
  public void setCancelRequested(boolean value) { cancelRequested = value; }
  public OffsetDateTime getCreatedAt() { return createdAt; }
  public void setCreatedAt(OffsetDateTime value) { createdAt = value; }
  public OffsetDateTime getUpdatedAt() { return updatedAt; }
  public void setUpdatedAt(OffsetDateTime value) { updatedAt = value; }
  public OffsetDateTime getStartedAt() { return startedAt; }
  public void setStartedAt(OffsetDateTime value) { startedAt = value; }
  public OffsetDateTime getFinishedAt() { return finishedAt; }
  public void setFinishedAt(OffsetDateTime value) { finishedAt = value; }
  public User getUser() { return user; }
  public void setUser(User value) { user = value; }
  public AuditProject getProject() { return project; }
  public void setProject(AuditProject value) { project = value; }
  public List<AuditIssue> getIssues() { return issues; }
  public void setIssues(List<AuditIssue> value) { issues = value; }
  public List<BrokenLink> getBrokenLinks() { return brokenLinks; }
  public void setBrokenLinks(List<BrokenLink> value) { brokenLinks = value; }
  public List<ConsoleError> getConsoleErrors() { return consoleErrors; }
  public void setConsoleErrors(List<ConsoleError> value) { consoleErrors = value; }
}
