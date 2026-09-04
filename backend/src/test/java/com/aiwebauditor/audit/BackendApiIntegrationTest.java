package com.aiwebauditor.audit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.aiwebauditor.common.ApiException;
import com.aiwebauditor.model.Audit;
import com.aiwebauditor.model.AuditIssue;
import com.aiwebauditor.model.AuditStatus;
import com.aiwebauditor.model.BrokenLink;
import com.aiwebauditor.model.ConsoleError;
import com.aiwebauditor.model.IssueSeverity;
import com.aiwebauditor.model.IssueType;
import com.aiwebauditor.model.User;
import com.aiwebauditor.repository.AuditRepository;
import com.aiwebauditor.repository.UserRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class BackendApiIntegrationTest {

  private static final Path STORAGE = Path.of("target/test-storage").toAbsolutePath().normalize();

  @Autowired MockMvc mockMvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired UserRepository userRepository;
  @Autowired AuditRepository auditRepository;
  @Autowired PasswordEncoder passwordEncoder;
  @Autowired AuditService auditService;

  @AfterEach
  void cleanStorage() throws IOException {
    if (!Files.isDirectory(STORAGE)) return;
    try (var paths = Files.walk(STORAGE)) {
      for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
        Files.deleteIfExists(path);
      }
    }
  }

  @Test
  void registersHashesPasswordAuthenticatesAndRejectsInvalidLogin() throws Exception {
    Session alice = register("Alice", "alice@example.test", "StrongPass123!");

    User persisted = userRepository.findByEmail(alice.email()).orElseThrow();
    assertThat(persisted.getPassword()).isNotEqualTo("StrongPass123!");
    assertThat(passwordEncoder.matches("StrongPass123!", persisted.getPassword())).isTrue();

    mockMvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + alice.token()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.email").value(alice.email()));

    mockMvc.perform(post("/api/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"email":"alice@example.test","password":"wrong-password"}
                """))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void isolatesProjectsAuditsAndHistoryByOwner() throws Exception {
    Session owner = register("Owner", "owner@example.test", "StrongPass123!");
    Session intruder = register("Intruder", "intruder@example.test", "StrongPass123!");

    UUID projectId = createProject(owner, "Portal principal");
    UUID auditId = createAudit(owner, projectId, "QUICK", null);

    mockMvc.perform(get("/api/projects/{id}", projectId)
            .header("Authorization", "Bearer " + intruder.token()))
        .andExpect(status().isNotFound());
    mockMvc.perform(get("/api/audits/{id}", auditId)
            .header("Authorization", "Bearer " + intruder.token()))
        .andExpect(status().isNotFound());

    Audit audit = auditRepository.findById(auditId).orElseThrow();
    audit.setStatus(AuditStatus.COMPLETED);
    audit.setOverallScore(84);
    auditRepository.flush();

    mockMvc.perform(get("/api/audits/history")
            .header("Authorization", "Bearer " + owner.token())
            .param("status", "COMPLETED")
            .param("search", "portal")
            .param("size", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(1))
        .andExpect(jsonPath("$.items[0].id").value(auditId.toString()));

    mockMvc.perform(get("/api/audits/history")
            .header("Authorization", "Bearer " + intruder.token()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.totalElements").value(0));
  }

  @Test
  void cancelsAndRetriesOnlyOwnedAuditWithConsistentStatus() throws Exception {
    Session owner = register("Owner", "status-owner@example.test", "StrongPass123!");
    UUID auditId = createAudit(owner, null, "QUICK", null);

    mockMvc.perform(post("/api/audits/{id}/cancel", auditId)
            .header("Authorization", "Bearer " + owner.token()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("CANCELLED"));

    mockMvc.perform(post("/api/audits/{id}/retry", auditId)
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));

    Audit audit = auditRepository.findById(auditId).orElseThrow();
    assertThat(audit.getAttemptCount()).isEqualTo(2);
    assertThat(audit.isCancelRequested()).isFalse();

    mockMvc.perform(post("/api/audits/{id}/retry", auditId)
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{}"))
        .andExpect(status().isConflict());
  }

  @Test
  void redactsAuthenticationAndGuidedScenarioSecretsBeforePersistenceOrResponse() throws Exception {
    Session owner = register("Owner", "secret-owner@example.test", "StrongPass123!");
    String secret = "guided-token-very-secret";
    String body = """
        {
          "url":"http://93.184.216.34",
          "auditMode":"GUIDED",
          "authorizationConfirmed":true,
          "scenarios":[{
            "name":"Fluxo privado",
            "steps":[{
              "action":"fill",
              "target":"#api-token",
              "value":"%s",
              "expected":"token accepted",
              "sensitive":true
            }]
          }]
        }
        """.formatted(secret);

    String response = mockMvc.perform(post("/api/audits")
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content(body))
        .andExpect(status().isCreated())
        .andReturn().getResponse().getContentAsString();
    UUID auditId = UUID.fromString(objectMapper.readTree(response).path("id").asText());
    Audit audit = auditRepository.findById(auditId).orElseThrow();

    assertThat(audit.getConfigJson()).doesNotContain(secret).contains("[REDACTED]");
    mockMvc.perform(get("/api/audits/{id}", auditId)
            .header("Authorization", "Bearer " + owner.token()))
        .andExpect(status().isOk())
        .andExpect(result -> assertThat(result.getResponse().getContentAsString()).doesNotContain(secret));
  }

  @Test
  void servesOnlyOwnedConfinedArtifactsAndRejectsTraversal() throws Exception {
    Session owner = register("Owner", "artifact-owner@example.test", "StrongPass123!");
    Session intruder = register("Intruder", "artifact-intruder@example.test", "StrongPass123!");
    UUID auditId = createAudit(owner, null, "QUICK", null);
    Audit audit = auditRepository.findById(auditId).orElseThrow();
    audit.setStatus(AuditStatus.COMPLETED);

    Path report = STORAGE.resolve("reports").resolve(auditId.toString()).resolve("audit-report.pdf");
    Files.createDirectories(report.getParent());
    Files.writeString(report, "safe-pdf", StandardCharsets.UTF_8);
    audit.setReportPdfPath("reports/" + auditId + "/audit-report.pdf");
    auditRepository.flush();

    assertThat(auditService.loadPdf(owner.email(), auditId).getContentAsByteArray())
        .isEqualTo("safe-pdf".getBytes(StandardCharsets.UTF_8));
    assertThatThrownBy(() -> auditService.loadPdf(intruder.email(), auditId))
        .isInstanceOf(ApiException.class)
        .extracting(error -> ((ApiException) error).getStatus().value())
        .isEqualTo(404);

    UUID otherAuditId = UUID.randomUUID();
    Path escaped = STORAGE.resolve("reports").resolve(otherAuditId.toString()).resolve("secret.pdf");
    Files.createDirectories(escaped.getParent());
    Files.writeString(escaped, "other-user-data", StandardCharsets.UTF_8);
    audit.setReportPdfPath("reports/" + auditId + "/../" + otherAuditId + "/secret.pdf");
    auditRepository.flush();

    assertThatThrownBy(() -> auditService.loadPdf(owner.email(), auditId))
        .isInstanceOf(ApiException.class)
        .extracting(error -> ((ApiException) error).getStatus().value())
        .isEqualTo(404);
  }

  @Test
  void normalizesUrlsWithoutProtocolAndBlocksPrivateTargets() throws Exception {
    Session owner = register("Owner", "url-owner@example.test", "StrongPass123!");

    String response = mockMvc.perform(post("/api/audits")
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "url":"93.184.216.34/portfolio?source=test#section",
                  "auditMode":"QUICK",
                  "authorizationConfirmed":true
                }
                """))
        .andExpect(status().isCreated())
        .andReturn().getResponse().getContentAsString();
    UUID auditId = UUID.fromString(objectMapper.readTree(response).path("id").asText());

    assertThat(auditRepository.findById(auditId).orElseThrow().getUrl())
        .isEqualTo("https://93.184.216.34/portfolio?source=test");

    mockMvc.perform(post("/api/audits")
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"url":"http://127.0.0.1/admin","auditMode":"QUICK","authorizationConfirmed":true}
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("rede privada")));
  }

  @Test
  void rejectsMismatchedProjectUrlAndEnforcesWorkerLimits() throws Exception {
    Session owner = register("Owner", "limits-owner@example.test", "StrongPass123!");
    UUID projectId = createProject(owner, "Portal principal");

    mockMvc.perform(post("/api/audits")
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "url":"93.184.216.34/another-page",
                  "projectId":"%s",
                  "auditMode":"QUICK",
                  "authorizationConfirmed":true
                }
                """.formatted(projectId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("A URL da auditoria deve corresponder à URL configurada no projeto."));

    mockMvc.perform(post("/api/audits")
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "url":"93.184.216.34",
                  "auditMode":"FULL",
                  "maxPages":31,
                  "maxDepth":6,
                  "timeoutSeconds":901,
                  "viewports":[{"name":"small","width":300,"height":300}],
                  "authorizationConfirmed":true
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.fieldErrors.maxPages").exists())
        .andExpect(jsonPath("$.fieldErrors.maxDepth").exists())
        .andExpect(jsonPath("$.fieldErrors.timeoutSeconds").exists())
        .andExpect(jsonPath("$.fieldErrors['viewports[0].width']").exists())
        .andExpect(jsonPath("$.fieldErrors['viewports[0].height']").exists());
  }

  @Test
  void returnsConsistentBadRequestForMalformedContractsAndQueryEnums() throws Exception {
    Session owner = register("Owner", "contract-owner@example.test", "StrongPass123!");

    mockMvc.perform(post("/api/audits")
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "url":"93.184.216.34",
                  "auditMode":"QUICK",
                  "viewports":["DESKTOP_1440"],
                  "authorizationConfirmed":true
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("O corpo JSON é inválido. Revise o formato e os tipos dos campos."));

    mockMvc.perform(get("/api/audits/history")
            .header("Authorization", "Bearer " + owner.token())
            .param("status", "UNKNOWN"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.fieldErrors.status").exists());
  }

  @Test
  void retryClearsPreviousResultsArtifactReferencesAndFindings() throws Exception {
    Session owner = register("Owner", "retry-cleanup@example.test", "StrongPass123!");
    UUID auditId = createAudit(owner, null, "QUICK", null);
    Audit audit = auditRepository.findById(auditId).orElseThrow();
    audit.setStatus(AuditStatus.FAILED);
    audit.setOverallScore(88);
    audit.setPerformanceScore(87);
    audit.setAccessibilityScore(86);
    audit.setSeoScore(85);
    audit.setBestPracticesScore(84);
    audit.setCoveragePercent(92);
    audit.setDesktopScreenshotPath("screenshots/" + auditId + "/desktop.png");
    audit.setMobileScreenshotPath("screenshots/" + auditId + "/mobile.png");
    audit.setReportPdfPath("reports/" + auditId + "/report.pdf");
    audit.setAiSummary("Resumo antigo");
    audit.setReportDataJson("{\"old\":true}");

    AuditIssue issue = new AuditIssue();
    issue.setAudit(audit);
    issue.setType(IssueType.ACCESSIBILITY);
    issue.setSeverity(IssueSeverity.HIGH);
    issue.setTitle("Finding antigo");
    audit.getIssues().add(issue);
    BrokenLink link = new BrokenLink();
    link.setAudit(audit);
    link.setUrl("https://example.test/missing");
    link.setStatusCode(404);
    audit.getBrokenLinks().add(link);
    ConsoleError consoleError = new ConsoleError();
    consoleError.setAudit(audit);
    consoleError.setMessage("Erro antigo");
    consoleError.setType("error");
    audit.getConsoleErrors().add(consoleError);
    auditRepository.flush();

    AuditListItemResponse response = auditService.retry(owner.email(), auditId, new RetryAuditRequest(null, null));
    auditRepository.flush();

    assertThat(response.status()).isEqualTo(AuditStatus.PENDING);
    assertThat(audit.getOverallScore()).isNull();
    assertThat(audit.getPerformanceScore()).isNull();
    assertThat(audit.getAccessibilityScore()).isNull();
    assertThat(audit.getSeoScore()).isNull();
    assertThat(audit.getBestPracticesScore()).isNull();
    assertThat(audit.getDesktopScreenshotPath()).isNull();
    assertThat(audit.getMobileScreenshotPath()).isNull();
    assertThat(audit.getReportPdfPath()).isNull();
    assertThat(audit.getAiSummary()).isNull();
    assertThat(audit.getReportDataJson()).isNull();
    assertThat(audit.getIssues()).isEmpty();
    assertThat(audit.getBrokenLinks()).isEmpty();
    assertThat(audit.getConsoleErrors()).isEmpty();
    assertThat(audit.getCoveragePercent()).isZero();
    assertThat(audit.getAttemptCount()).isEqualTo(2);
  }

  @Test
  void persistsEnumValuesIntroducedAfterLegacyHibernateConstraints() throws Exception {
    Session owner = register("Enum owner", "enum-values@example.test", "StrongPass123!");
    UUID auditId = createAudit(owner, null, "QUICK", null);
    Audit audit = auditRepository.findById(auditId).orElseThrow();
    audit.setStatus(AuditStatus.CANCELLED);

    AuditIssue issue = new AuditIssue();
    issue.setAudit(audit);
    issue.setType(IssueType.FUNCTIONAL);
    issue.setSeverity(IssueSeverity.OPPORTUNITY);
    issue.setTitle("Oportunidade de melhoria");
    audit.getIssues().add(issue);

    auditRepository.flush();
    Audit persisted = auditRepository.findById(auditId).orElseThrow();
    assertThat(persisted.getStatus()).isEqualTo(AuditStatus.CANCELLED);
    assertThat(persisted.getIssues()).singleElement()
        .satisfies(saved -> {
          assertThat(saved.getType()).isEqualTo(IssueType.FUNCTIONAL);
          assertThat(saved.getSeverity()).isEqualTo(IssueSeverity.OPPORTUNITY);
        });
  }

  @Test
  void comparesOnlyTheSameNormalizedUrlAndKeepsUnavailableDeltasNull() throws Exception {
    Session owner = register("Owner", "comparison-owner@example.test", "StrongPass123!");
    UUID previousId = createAudit(owner, null, "QUICK", null);
    UUID currentId = createAudit(owner, null, "QUICK", null);
    Audit previous = auditRepository.findById(previousId).orElseThrow();
    Audit current = auditRepository.findById(currentId).orElseThrow();
    OffsetDateTime now = OffsetDateTime.now();
    previous.setCreatedAt(now.minusMinutes(2));
    current.setCreatedAt(now.minusMinutes(1));
    previous.setStatus(AuditStatus.COMPLETED);
    previous.setOverallScore(null);
    previous.setPerformanceScore(70);
    previous.setCoveragePercent(80);
    current.setStatus(AuditStatus.COMPLETED);
    current.setOverallScore(null);
    current.setPerformanceScore(85);
    current.setCoveragePercent(70);
    auditRepository.flush();

    AuditComparisonResponse comparison = auditService.getById(owner.email(), currentId).comparison();

    assertThat(comparison).isNotNull();
    assertThat(comparison.previousAuditId()).isEqualTo(previousId);
    assertThat(comparison.previousOverallScore()).isNull();
    assertThat(comparison.currentOverallScore()).isNull();
    assertThat(comparison.overallDelta()).isNull();
    assertThat(comparison.previousPerformanceScore()).isEqualTo(70);
    assertThat(comparison.currentPerformanceScore()).isEqualTo(85);
    assertThat(comparison.performanceDelta()).isEqualTo(15);
    assertThat(comparison.coverageDelta()).isEqualTo(-10);
    assertThat(comparison.trendLabel()).isEqualTo("Melhorou");
  }

  @Test
  void comparesSameUrlAcrossDifferentProjectsWhenNoBaselineIsConfigured() throws Exception {
    Session owner = register("Cross project owner", "cross-project-comparison@example.test", "StrongPass123!");
    UUID previousProjectId = createProject(owner, "Projeto anterior");
    UUID currentProjectId = createProject(owner, "Projeto atual");
    UUID previousId = createAudit(owner, previousProjectId, "QUICK", null);
    UUID currentId = createAudit(owner, currentProjectId, "QUICK", null);
    Audit previous = auditRepository.findById(previousId).orElseThrow();
    Audit current = auditRepository.findById(currentId).orElseThrow();
    previous.setStatus(AuditStatus.COMPLETED);
    previous.setOverallScore(70);
    previous.setPerformanceScore(68);
    current.setStatus(AuditStatus.COMPLETED);
    current.setOverallScore(82);
    current.setPerformanceScore(80);
    current.setCreatedAt(OffsetDateTime.now());
    auditRepository.flush();

    AuditComparisonResponse comparison = auditService.getById(owner.email(), currentId).comparison();

    assertThat(comparison).isNotNull();
    assertThat(comparison.previousAuditId()).isEqualTo(previousId);
    assertThat(comparison.overallDelta()).isEqualTo(12);
    assertThat(comparison.performanceDelta()).isEqualTo(12);
  }

  @Test
  void normalizesLoginUrlAndReusesSafeAuthenticationConfigOnRetry() throws Exception {
    Session owner = register("Owner", "authenticated-retry@example.test", "StrongPass123!");
    String createResponse = mockMvc.perform(post("/api/audits")
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {
                  "url":"93.184.216.34",
                  "auditMode":"AUTHENTICATED",
                  "authorizationConfirmed":true,
                  "authConfig":{
                    "loginUrl":"93.184.216.34/login#form",
                    "username":"portfolio-user",
                    "password":"temporary-secret",
                    "usernameSelector":"#email",
                    "passwordSelector":"#password",
                    "submitSelector":"button[type=submit]"
                  }
                }
                """))
        .andExpect(status().isCreated())
        .andReturn().getResponse().getContentAsString();
    UUID auditId = UUID.fromString(objectMapper.readTree(createResponse).path("id").asText());
    Audit audit = auditRepository.findById(auditId).orElseThrow();
    JsonNode persistedConfig = objectMapper.readTree(audit.getConfigJson());
    assertThat(persistedConfig.path("authConfig").path("loginUrl").asText())
        .isEqualTo("https://93.184.216.34/login");
    assertThat(persistedConfig.path("authConfig").path("username").isNull()).isTrue();
    assertThat(audit.getConfigJson()).doesNotContain("temporary-secret");

    audit.setStatus(AuditStatus.FAILED);
    auditRepository.flush();
    mockMvc.perform(post("/api/audits/{id}/retry", auditId)
            .header("Authorization", "Bearer " + owner.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"authConfig":{"username":"portfolio-user","password":"another-temporary-secret"}}
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PENDING"));

    JsonNode retryConfig = objectMapper.readTree(audit.getConfigJson());
    assertThat(retryConfig.path("authConfig").path("loginUrl").asText())
        .isEqualTo("https://93.184.216.34/login");
    assertThat(audit.getConfigJson()).doesNotContain("another-temporary-secret");
  }

  private Session register(String name, String email, String password) throws Exception {
    String response = mockMvc.perform(post("/api/auth/register")
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(new Registration(name, email, password))))
        .andExpect(status().isCreated())
        .andReturn().getResponse().getContentAsString();
    JsonNode json = objectMapper.readTree(response);
    return new Session(email, json.path("token").asText());
  }

  private UUID createProject(Session session, String name) throws Exception {
    String response = mockMvc.perform(post("/api/projects")
            .header("Authorization", "Bearer " + session.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("""
                {"name":"%s","url":"http://93.184.216.34","authorizationConfirmed":true}
                """.formatted(name)))
        .andExpect(status().isCreated())
        .andReturn().getResponse().getContentAsString();
    return UUID.fromString(objectMapper.readTree(response).path("id").asText());
  }

  private UUID createAudit(Session session, UUID projectId, String mode, String extraJson) throws Exception {
    String project = projectId == null ? "" : ",\"projectId\":\"" + projectId + "\"";
    String extra = extraJson == null ? "" : "," + extraJson;
    String response = mockMvc.perform(post("/api/audits")
            .header("Authorization", "Bearer " + session.token())
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"url\":\"http://93.184.216.34\",\"auditMode\":\"" + mode
                + "\",\"authorizationConfirmed\":true" + project + extra + "}"))
        .andExpect(status().isCreated())
        .andReturn().getResponse().getContentAsString();
    return UUID.fromString(objectMapper.readTree(response).path("id").asText());
  }

  private record Registration(String name, String email, String password) {}
  private record Session(String email, String token) {}
}
