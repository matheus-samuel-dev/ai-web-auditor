package com.aiwebauditor.model;

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
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "audit_issues")
public class AuditIssue {
  @Id @GeneratedValue(strategy = GenerationType.UUID) private UUID id;
  @Column(length = 80) private String evidenceId;
  @Enumerated(EnumType.STRING) @Column(nullable = false, length = 30) private IssueType type;
  @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private IssueSeverity severity;
  @Enumerated(EnumType.STRING) @Column(nullable = false, length = 40)
  private ValidationStatus validationStatus = ValidationStatus.AUTOMATICALLY_VALIDATED;
  private Integer confidence;
  @Column(nullable = false, length = 240) private String title;
  @Column(columnDefinition = "TEXT") private String description;
  @Column(columnDefinition = "TEXT") private String recommendation;
  @Column(length = 80) private String source;
  @Column(length = 2048) private String pageUrl;
  @Column(length = 80) private String device;
  @Column(length = 500) private String element;
  @Column(length = 500) private String selector;
  @Column(length = 1024) private String screenshotPath;
  @Column(columnDefinition = "TEXT") private String reproductionSteps;
  @Column(columnDefinition = "TEXT") private String expectedResult;
  @Column(columnDefinition = "TEXT") private String actualResult;
  @Column(columnDefinition = "TEXT") private String impact;
  @Column(length = 80) private String effort;
  @Column(length = 1024) private String technicalReference;
  @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
  private FindingResolutionStatus resolutionStatus = FindingResolutionStatus.OPEN;
  @Column(columnDefinition = "TEXT") private String resolutionComment;
  @ManyToOne(optional = false, fetch = FetchType.LAZY)
  @JoinColumn(name = "audit_id", nullable = false) private Audit audit;

  public UUID getId() { return id; }
  public void setId(UUID value) { id = value; }
  public String getEvidenceId() { return evidenceId; }
  public void setEvidenceId(String value) { evidenceId = value; }
  public IssueType getType() { return type; }
  public void setType(IssueType value) { type = value; }
  public IssueSeverity getSeverity() { return severity; }
  public void setSeverity(IssueSeverity value) { severity = value; }
  public ValidationStatus getValidationStatus() { return validationStatus; }
  public void setValidationStatus(ValidationStatus value) { validationStatus = value; }
  public Integer getConfidence() { return confidence; }
  public void setConfidence(Integer value) { confidence = value; }
  public String getTitle() { return title; }
  public void setTitle(String value) { title = value; }
  public String getDescription() { return description; }
  public void setDescription(String value) { description = value; }
  public String getRecommendation() { return recommendation; }
  public void setRecommendation(String value) { recommendation = value; }
  public String getSource() { return source; }
  public void setSource(String value) { source = value; }
  public String getPageUrl() { return pageUrl; }
  public void setPageUrl(String value) { pageUrl = value; }
  public String getDevice() { return device; }
  public void setDevice(String value) { device = value; }
  public String getElement() { return element; }
  public void setElement(String value) { element = value; }
  public String getSelector() { return selector; }
  public void setSelector(String value) { selector = value; }
  public String getScreenshotPath() { return screenshotPath; }
  public void setScreenshotPath(String value) { screenshotPath = value; }
  public String getReproductionSteps() { return reproductionSteps; }
  public void setReproductionSteps(String value) { reproductionSteps = value; }
  public String getExpectedResult() { return expectedResult; }
  public void setExpectedResult(String value) { expectedResult = value; }
  public String getActualResult() { return actualResult; }
  public void setActualResult(String value) { actualResult = value; }
  public String getImpact() { return impact; }
  public void setImpact(String value) { impact = value; }
  public String getEffort() { return effort; }
  public void setEffort(String value) { effort = value; }
  public String getTechnicalReference() { return technicalReference; }
  public void setTechnicalReference(String value) { technicalReference = value; }
  public FindingResolutionStatus getResolutionStatus() { return resolutionStatus; }
  public void setResolutionStatus(FindingResolutionStatus value) { resolutionStatus = value; }
  public String getResolutionComment() { return resolutionComment; }
  public void setResolutionComment(String value) { resolutionComment = value; }
  public Audit getAudit() { return audit; }
  public void setAudit(Audit value) { audit = value; }
}
