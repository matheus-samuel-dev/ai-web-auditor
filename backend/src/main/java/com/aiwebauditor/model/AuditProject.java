package com.aiwebauditor.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "audit_projects")
public class AuditProject {
  @Id @GeneratedValue(strategy = GenerationType.UUID) private UUID id;
  @Column(nullable = false, length = 120) private String name;
  @Column(nullable = false, length = 2048) private String url;
  @Column(nullable = false, length = 255) private String domain;
  @Column(nullable = false, length = 40) private String environment = "PRODUCTION";
  @Column(length = 40) private String frequency;
  @Column(columnDefinition = "TEXT") private String defaultConfigJson;
  @Column(nullable = false) private boolean archived;
  private UUID baselineAuditId;
  @Column(nullable = false) private OffsetDateTime createdAt;
  @Column(nullable = false) private OffsetDateTime updatedAt;
  @ManyToOne(optional = false, fetch = FetchType.LAZY)
  @JoinColumn(name = "user_id", nullable = false) private User user;
  @OneToMany(mappedBy = "project") private List<Audit> audits = new ArrayList<>();

  @PrePersist void create() { createdAt = updatedAt = OffsetDateTime.now(); }
  @PreUpdate void update() { updatedAt = OffsetDateTime.now(); }
  public UUID getId() { return id; }
  public void setId(UUID value) { id = value; }
  public String getName() { return name; }
  public void setName(String value) { name = value; }
  public String getUrl() { return url; }
  public void setUrl(String value) { url = value; }
  public String getDomain() { return domain; }
  public void setDomain(String value) { domain = value; }
  public String getEnvironment() { return environment; }
  public void setEnvironment(String value) { environment = value; }
  public String getFrequency() { return frequency; }
  public void setFrequency(String value) { frequency = value; }
  public String getDefaultConfigJson() { return defaultConfigJson; }
  public void setDefaultConfigJson(String value) { defaultConfigJson = value; }
  public boolean isArchived() { return archived; }
  public void setArchived(boolean value) { archived = value; }
  public UUID getBaselineAuditId() { return baselineAuditId; }
  public void setBaselineAuditId(UUID value) { baselineAuditId = value; }
  public OffsetDateTime getCreatedAt() { return createdAt; }
  public OffsetDateTime getUpdatedAt() { return updatedAt; }
  public User getUser() { return user; }
  public void setUser(User value) { user = value; }
  public List<Audit> getAudits() { return audits; }
}
