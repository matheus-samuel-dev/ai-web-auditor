package com.aiwebauditor.config;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@ConfigurationProperties(prefix = "app")
@Validated
public class AppProperties {

  @NotBlank
  @Size(min = 32)
  private String jwtSecret;
  @Min(5)
  @Max(10_080)
  private long jwtExpirationMinutes = 1_440;
  @NotBlank
  private String auditorBaseUrl;
  @NotBlank
  @Size(min = 24)
  private String auditorApiToken;
  @Min(5)
  @Max(3_600)
  private int auditorRequestTimeoutSeconds = 300;
  private String internalCallbackBaseUrl;
  @NotBlank
  @Size(min = 24)
  private String auditorCallbackToken;
  private String storagePath;
  private String frontendUrl;
  private boolean developmentMode;
  private boolean allowLocalhostAudits;
  private List<String> auditPrivateHostAllowlist = new ArrayList<>();
  @Min(1)
  @Max(32)
  private int auditCorePoolSize = 2;
  @Min(1)
  @Max(64)
  private int auditMaxPoolSize = 4;
  @Min(0)
  @Max(10_000)
  private int auditQueueCapacity = 20;
  @Min(30)
  private int orphanThresholdSeconds = 900;

  public String getJwtSecret() {
    return jwtSecret;
  }

  public void setJwtSecret(String jwtSecret) {
    this.jwtSecret = jwtSecret;
  }

  public long getJwtExpirationMinutes() {
    return jwtExpirationMinutes;
  }

  public void setJwtExpirationMinutes(long jwtExpirationMinutes) {
    this.jwtExpirationMinutes = jwtExpirationMinutes;
  }

  public String getAuditorBaseUrl() {
    return auditorBaseUrl;
  }

  public void setAuditorBaseUrl(String auditorBaseUrl) {
    this.auditorBaseUrl = auditorBaseUrl;
  }

  public String getInternalCallbackBaseUrl() {
    return internalCallbackBaseUrl;
  }

  public void setInternalCallbackBaseUrl(String internalCallbackBaseUrl) {
    this.internalCallbackBaseUrl = internalCallbackBaseUrl;
  }

  public String getAuditorApiToken() {
    return auditorApiToken;
  }

  public void setAuditorApiToken(String auditorApiToken) {
    this.auditorApiToken = auditorApiToken;
  }

  public int getAuditorRequestTimeoutSeconds() {
    return auditorRequestTimeoutSeconds;
  }

  public void setAuditorRequestTimeoutSeconds(int auditorRequestTimeoutSeconds) {
    this.auditorRequestTimeoutSeconds = auditorRequestTimeoutSeconds;
  }

  public String getAuditorCallbackToken() {
    return auditorCallbackToken;
  }

  public void setAuditorCallbackToken(String auditorCallbackToken) {
    this.auditorCallbackToken = auditorCallbackToken;
  }

  public String getStoragePath() {
    return storagePath;
  }

  public void setStoragePath(String storagePath) {
    this.storagePath = storagePath;
  }

  public String getFrontendUrl() {
    return frontendUrl;
  }

  public void setFrontendUrl(String frontendUrl) {
    this.frontendUrl = frontendUrl;
  }

  public boolean isDevelopmentMode() {
    return developmentMode;
  }

  public void setDevelopmentMode(boolean developmentMode) {
    this.developmentMode = developmentMode;
  }

  public boolean isAllowLocalhostAudits() {
    return allowLocalhostAudits;
  }

  public void setAllowLocalhostAudits(boolean allowLocalhostAudits) {
    this.allowLocalhostAudits = allowLocalhostAudits;
  }

  /**
   * Exact hostnames that may resolve to RFC1918/unique-local addresses. This is intended for
   * explicitly configured internal fixtures; it never relaxes localhost, link-local, metadata,
   * multicast or other reserved-address protections.
   */
  public List<String> getAuditPrivateHostAllowlist() {
    return auditPrivateHostAllowlist;
  }

  public void setAuditPrivateHostAllowlist(List<String> auditPrivateHostAllowlist) {
    this.auditPrivateHostAllowlist = auditPrivateHostAllowlist == null
        ? new ArrayList<>()
        : new ArrayList<>(auditPrivateHostAllowlist);
  }

  public int getAuditCorePoolSize() {
    return auditCorePoolSize;
  }

  public void setAuditCorePoolSize(int auditCorePoolSize) {
    this.auditCorePoolSize = auditCorePoolSize;
  }

  public int getAuditMaxPoolSize() {
    return auditMaxPoolSize;
  }

  public void setAuditMaxPoolSize(int auditMaxPoolSize) {
    this.auditMaxPoolSize = auditMaxPoolSize;
  }

  public int getAuditQueueCapacity() {
    return auditQueueCapacity;
  }

  public void setAuditQueueCapacity(int auditQueueCapacity) {
    this.auditQueueCapacity = auditQueueCapacity;
  }

  public int getOrphanThresholdSeconds() {
    return orphanThresholdSeconds;
  }

  public void setOrphanThresholdSeconds(int orphanThresholdSeconds) {
    this.orphanThresholdSeconds = orphanThresholdSeconds;
  }
}
