package com.aiwebauditor.audit;

import com.aiwebauditor.common.ApiException;
import com.aiwebauditor.config.AppProperties;
import com.aiwebauditor.model.Audit;
import com.aiwebauditor.model.AuditIssue;
import com.aiwebauditor.model.AuditMode;
import com.aiwebauditor.model.AuditProject;
import com.aiwebauditor.model.AuditStatus;
import com.aiwebauditor.model.FindingResolutionStatus;
import com.aiwebauditor.model.IssueSeverity;
import com.aiwebauditor.model.User;
import com.aiwebauditor.repository.AuditIssueRepository;
import com.aiwebauditor.repository.AuditProjectRepository;
import com.aiwebauditor.repository.AuditRepository;
import com.aiwebauditor.repository.UserRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class AuditService {
  private static final Logger log = LoggerFactory.getLogger(AuditService.class);
  private static final Pattern STORAGE_SUFFIX_PATTERN = Pattern.compile(
      "(?i)(?:^|[\\/])((?:screenshots|reports)[\\/].+)$");
  private static final String GENERATING_MESSAGE = "Este artefato ainda está sendo gerado. Aguarde alguns instantes.";
  private static final String FAILED_MESSAGE = "Não foi possível gerar este artefato. Tente executar a auditoria novamente.";

  private final AuditRepository auditRepository;
  private final AuditIssueRepository issueRepository;
  private final AuditProjectRepository projectRepository;
  private final UserRepository userRepository;
  private final ObjectMapper objectMapper;
  private final AppProperties properties;
  private final UrlSafetyValidator urlSafetyValidator;
  private final ApplicationEventPublisher events;

  public AuditService(
      AuditRepository auditRepository,
      AuditIssueRepository issueRepository,
      AuditProjectRepository projectRepository,
      UserRepository userRepository,
      ObjectMapper objectMapper,
      AppProperties properties,
      UrlSafetyValidator urlSafetyValidator,
      ApplicationEventPublisher events
  ) {
    this.auditRepository = auditRepository;
    this.issueRepository = issueRepository;
    this.projectRepository = projectRepository;
    this.userRepository = userRepository;
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.urlSafetyValidator = urlSafetyValidator;
    this.events = events;
  }

  @Transactional
  public AuditListItemResponse create(String email, CreateAuditRequest request) {
    User user = loadUser(email);
    String url = urlSafetyValidator.validateAndNormalize(request.url());
    AuditRunConfiguration configuration = validateConfiguration(AuditRunConfiguration.from(request));
    AuditProject project = resolveProject(user, request, url, configuration);

    Audit audit = new Audit();
    audit.setUrl(url);
    audit.setAuditMode(configuration.auditMode());
    audit.setStatus(AuditStatus.PENDING);
    audit.setCurrentStage("QUEUED");
    audit.setStatusMessage("Na fila para iniciar a auditoria.");
    audit.setUser(user);
    audit.setProject(project);
    audit.setConfigJson(writeConfiguration(configuration.withoutCredentials()));
    audit.setViewportsJson(writeJson(configuration.viewports()));
    audit.setDevicesJson(writeJson(configuration.viewports().stream()
        .map(viewport -> Boolean.TRUE.equals(viewport.mobile()) ? "MOBILE" : "DESKTOP")
        .distinct().toList()));
    auditRepository.save(audit);

    // The listener only dispatches after this transaction commits, eliminating the create/async race.
    events.publishEvent(new AuditDispatchEvent(audit.getId(), configuration));
    log.info("Auditoria {} criada para {}", audit.getId(), urlSafetyValidator.safeForLog(url));
    return toListItem(audit);
  }

  @Transactional(readOnly = true)
  public List<AuditListItemResponse> list(String email) {
    User user = loadUser(email);
    return toListItems(auditRepository.findAllByUserIdOrderByCreatedAtDesc(user.getId()));
  }

  @Transactional(readOnly = true)
  public AuditHistoryPageResponse history(
      String email,
      int page,
      int size,
      String search,
      AuditStatus status,
      UUID projectId,
      OffsetDateTime createdFrom,
      OffsetDateTime createdTo,
      Integer minimumScore,
      Integer maximumScore,
      String device,
      String sort,
      String direction
  ) {
    User user = loadUser(email);
    if (minimumScore != null && (minimumScore < 0 || minimumScore > 100)
        || maximumScore != null && (maximumScore < 0 || maximumScore > 100)
        || minimumScore != null && maximumScore != null && minimumScore > maximumScore) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "O intervalo de score informado é inválido.");
    }
    if (createdFrom != null && createdTo != null && createdFrom.isAfter(createdTo)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "O intervalo de datas informado é inválido.");
    }

    int safePage = Math.max(0, page);
    int safeSize = Math.max(1, Math.min(100, size));
    String sortField = switch (sort == null ? "" : sort.trim()) {
      case "url", "status", "overallScore", "coveragePercent", "durationSeconds", "createdAt" -> sort.trim();
      default -> "createdAt";
    };
    Sort.Direction sortDirection = "asc".equalsIgnoreCase(direction) ? Sort.Direction.ASC : Sort.Direction.DESC;
    String searchPattern = likePattern(search);
    String devicePattern = likePattern(device);
    Page<Audit> result = auditRepository.findAll(
        historySpecification(user.getId(), searchPattern, status, projectId, createdFrom, createdTo,
            minimumScore, maximumScore, devicePattern),
        PageRequest.of(safePage, safeSize, Sort.by(sortDirection, sortField)));

    return new AuditHistoryPageResponse(
        toListItems(result.getContent()), result.getNumber(), result.getSize(), result.getTotalElements(),
        result.getTotalPages(), result.isFirst(), result.isLast());
  }

  @Transactional(readOnly = true)
  public DashboardSummaryResponse dashboard(String email) {
    User user = loadUser(email);
    List<Audit> audits = auditRepository.findAllByUserIdOrderByCreatedAtDesc(user.getId());
    List<Audit> completed = audits.stream()
        .filter(audit -> audit.getStatus() == AuditStatus.COMPLETED && audit.getOverallScore() != null).toList();
    Map<String, Long> statusBreakdown = new LinkedHashMap<>();
    for (AuditStatus status : AuditStatus.values()) {
      statusBreakdown.put(status.name(), audits.stream().filter(audit -> audit.getStatus() == status).count());
    }
    Double averageScore = auditRepository.findAverageScoreByUserId(user.getId());
    Double averageCoverage = auditRepository.findAverageCoverageByUserId(user.getId());
    Long critical = auditRepository.countCriticalIssuesByUserId(user.getId());
    Map<UUID, IssueCounts> issueCounts = loadIssueCounts(audits);
    return new DashboardSummaryResponse(
        audits.size(),
        countStatus(audits, AuditStatus.COMPLETED),
        countStatus(audits, AuditStatus.RUNNING) + countStatus(audits, AuditStatus.PENDING),
        countStatus(audits, AuditStatus.FAILED),
        countStatus(audits, AuditStatus.CANCELLED),
        projectRepository.countByUserIdAndArchivedFalse(user.getId()),
        averageScore == null ? 0 : averageScore,
        averageCoverage == null ? 0 : averageCoverage,
        critical == null ? 0 : critical,
        audits.isEmpty() ? null : toListItem(audits.getFirst(), issueCounts.getOrDefault(audits.getFirst().getId(), IssueCounts.ZERO)),
        audits.stream().limit(8)
            .map(audit -> toListItem(audit, issueCounts.getOrDefault(audit.getId(), IssueCounts.ZERO))).toList(),
        statusBreakdown,
        buildScoreTimeline(completed),
        buildIssueTypeBreakdown(user.getId()),
        buildCategoryAverages(completed));
  }

  @Transactional(readOnly = true)
  public AuditReportResponse getById(String email, UUID auditId) {
    Audit audit = requireOwnedAudit(email, auditId);
    AuditArtifactResponse desktop = buildFileArtifact(audit, audit.getDesktopScreenshotPath(),
        buildScreenshotUrl(auditId, "desktop"), "A captura desktop");
    AuditArtifactResponse mobile = buildFileArtifact(audit, audit.getMobileScreenshotPath(),
        buildScreenshotUrl(auditId, "mobile"), "A captura mobile");
    AuditArtifactResponse pdf = buildFileArtifact(audit, audit.getReportPdfPath(), buildPdfUrl(auditId), "O relatório em PDF");
    AuditArtifactResponse json = buildJsonArtifact(audit);
    return new AuditReportResponse(
        audit.getId(), audit.getUrl(), projectId(audit), projectName(audit), audit.getAuditMode(), audit.getStatus(),
        audit.getOverallScore(), audit.getPerformanceScore(), audit.getAccessibilityScore(), audit.getSeoScore(),
        audit.getBestPracticesScore(), audit.getProgressPercent(), audit.getCurrentStage(), audit.getCurrentPage(),
        audit.getActionsExecuted(), audit.getFindingsCount(), audit.getElapsedSeconds(),
        audit.getEstimatedRemainingSeconds(), audit.getStatusMessage(), audit.getAiSummary(), audit.getFailureReason(),
        audit.getCreatedAt(), audit.getStartedAt(), audit.getFinishedAt(), buildCoverage(audit),
        desktop.url(), mobile.url(), pdf.url(), json.url(), buildCsvUrl(auditId),
        desktop, mobile, pdf, json, buildComparison(audit),
        audit.getIssues().stream().map(this::toIssueResponse).toList(),
        audit.getBrokenLinks().stream().map(link -> new BrokenLinkResponse(link.getId(), link.getUrl(), link.getStatusCode())).toList(),
        audit.getConsoleErrors().stream().map(error -> new ConsoleErrorResponse(error.getId(), error.getMessage(), error.getType())).toList(),
        readReportData(audit.getReportDataJson()));
  }

  @Transactional
  public AuditListItemResponse cancel(String email, UUID auditId) {
    Audit audit = requireOwnedAudit(email, auditId);
    if (audit.getStatus() == AuditStatus.COMPLETED || audit.getStatus() == AuditStatus.FAILED
        || audit.getStatus() == AuditStatus.CANCELLED) {
      throw new ApiException(HttpStatus.CONFLICT, "Somente auditorias pendentes ou em execução podem ser canceladas.");
    }
    audit.setCancelRequested(true);
    audit.setStatus(AuditStatus.CANCELLED);
    audit.setCurrentStage("CANCELLED");
    audit.setStatusMessage("Auditoria cancelada pelo usuário.");
    audit.setFailureReason(null);
    audit.setFinishedAt(OffsetDateTime.now());
    audit.setEstimatedRemainingSeconds(0);
    events.publishEvent(new AuditCancellationEvent(auditId));
    return toListItem(audit);
  }

  @Transactional
  public AuditListItemResponse retry(String email, UUID auditId, RetryAuditRequest request) {
    Audit audit = requireOwnedAudit(email, auditId);
    if (audit.getStatus() != AuditStatus.FAILED && audit.getStatus() != AuditStatus.CANCELLED) {
      throw new ApiException(HttpStatus.CONFLICT, "Somente auditorias com falha ou canceladas podem ser tentadas novamente.");
    }
    urlSafetyValidator.validateAndNormalize(audit.getUrl());
    AuditRunConfiguration configuration = readConfiguration(audit);
    if (configuration.requiresEphemeralCredentials()) {
      AuthConfigRequest auth = request == null ? null : request.authConfig();
      if (auth == null || !auth.hasCredentials()) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "Informe novamente as credenciais para repetir a auditoria autenticada.");
      }
      AuthConfigRequest storedAuth = configuration.authConfig();
      configuration = configuration.withAuthConfig(
          storedAuth == null ? auth : storedAuth.mergeEphemeralCredentials(auth));
    }
    if (configuration.hasRedactedScenarioSecrets()) {
      List<AuditScenarioRequest> scenarios = request == null ? null : request.scenarios();
      if (scenarios == null || scenarios.isEmpty()) {
        throw new ApiException(HttpStatus.BAD_REQUEST,
            "Informe novamente os valores sensíveis dos cenários para repetir esta auditoria.");
      }
      configuration = configuration.withScenarios(scenarios);
    }
    configuration = validateConfiguration(configuration);
    resetForRetry(audit, configuration);
    events.publishEvent(new AuditDispatchEvent(auditId, configuration));
    return toListItem(audit);
  }

  @Transactional
  public void delete(String email, UUID auditId) {
    Audit audit = requireOwnedAudit(email, auditId);
    if (audit.getStatus() == AuditStatus.PENDING || audit.getStatus() == AuditStatus.RUNNING) {
      throw new ApiException(HttpStatus.CONFLICT, "Cancele a auditoria antes de excluí-la.");
    }
    if (audit.getProject() != null && auditId.equals(audit.getProject().getBaselineAuditId())) {
      audit.getProject().setBaselineAuditId(null);
    }
    auditRepository.delete(audit);
    events.publishEvent(new AuditDeletionEvent(auditId));
  }

  @Transactional
  public AuditIssueResponse patchIssue(String email, UUID auditId, UUID issueId, PatchAuditIssueRequest request) {
    User user = loadUser(email);
    AuditIssue issue = issueRepository.findByIdAndAuditIdAndAuditUserId(issueId, auditId, user.getId())
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Finding não encontrado."));
    if (request.resolutionStatus() != null) issue.setResolutionStatus(request.resolutionStatus());
    if (request.validationStatus() != null) issue.setValidationStatus(request.validationStatus());
    if (request.resolutionComment() != null) issue.setResolutionComment(request.resolutionComment().trim());
    if (issue.getResolutionStatus() == FindingResolutionStatus.IGNORED
        && !StringUtils.hasText(issue.getResolutionComment())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Informe uma justificativa para ignorar o finding.");
    }
    return toIssueResponse(issue);
  }

  @Transactional(readOnly = true)
  public Resource loadPdf(String email, UUID auditId) {
    Audit audit = requireOwnedAudit(email, auditId);
    return loadArtifactResource(audit, audit.getReportPdfPath(), "O relatório em PDF");
  }

  @Transactional(readOnly = true)
  public Resource loadScreenshot(String email, UUID auditId, String device) {
    Audit audit = requireOwnedAudit(email, auditId);
    return switch (device == null ? "" : device.trim().toLowerCase(Locale.ROOT)) {
      case "mobile" -> loadArtifactResource(audit, audit.getMobileScreenshotPath(), "A captura mobile");
      case "desktop" -> loadArtifactResource(audit, audit.getDesktopScreenshotPath(), "A captura desktop");
      default -> throw new ApiException(HttpStatus.BAD_REQUEST, "O dispositivo informado é inválido.");
    };
  }

  @Transactional(readOnly = true)
  public byte[] exportJsonBytes(String email, UUID auditId) {
    try {
      return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(getById(email, auditId));
    } catch (IOException exception) {
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível exportar o JSON da auditoria.");
    }
  }

  @Transactional(readOnly = true)
  public byte[] exportCsvBytes(String email, UUID auditId) {
    Audit audit = requireOwnedAudit(email, auditId);
    StringBuilder csv = new StringBuilder("id,evidenceId,type,severity,validationStatus,resolutionStatus,title,page,device,impact,recommendation\r\n");
    for (AuditIssue issue : audit.getIssues()) {
      csv.append(csv(issue.getId())).append(',').append(csv(issue.getEvidenceId())).append(',')
          .append(csv(issue.getType())).append(',').append(csv(issue.getSeverity())).append(',')
          .append(csv(issue.getValidationStatus())).append(',').append(csv(issue.getResolutionStatus())).append(',')
          .append(csv(issue.getTitle())).append(',').append(csv(issue.getPageUrl())).append(',')
          .append(csv(issue.getDevice())).append(',').append(csv(issue.getImpact())).append(',')
          .append(csv(issue.getRecommendation())).append("\r\n");
    }
    return csv.toString().getBytes(StandardCharsets.UTF_8);
  }

  private AuditProject resolveProject(
      User user,
      CreateAuditRequest request,
      String url,
      AuditRunConfiguration configuration
  ) {
    if (request.projectId() != null) {
      AuditProject project = projectRepository.findByIdAndUserId(request.projectId(), user.getId())
          .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Projeto não encontrado."));
      if (project.isArchived()) throw new ApiException(HttpStatus.CONFLICT, "O projeto está arquivado.");
      if (!urlSafetyValidator.isSameTarget(project.getUrl(), url)) {
        throw new ApiException(HttpStatus.BAD_REQUEST,
            "A URL da auditoria deve corresponder à URL configurada no projeto.");
      }
      return project;
    }
    if (!StringUtils.hasText(request.projectName())) return null;
    AuditProject project = new AuditProject();
    project.setUser(user);
    project.setName(request.projectName().trim());
    project.setUrl(url);
    project.setDomain(URI.create(url).getHost().toLowerCase(Locale.ROOT));
    project.setEnvironment(Boolean.TRUE.equals(request.testEnvironment()) ? "TEST" : "PRODUCTION");
    project.setDefaultConfigJson(writeConfiguration(configuration.withoutCredentials()));
    return projectRepository.save(project);
  }

  /**
   * Builds the history filters only for parameters that are actually present.
   * This avoids PostgreSQL's untyped-null failures from the former JPQL
   * "(:parameter is null or ...)" predicates while keeping the endpoint fully
   * pageable and sortable.
   */
  private Specification<Audit> historySpecification(
      UUID userId,
      String search,
      AuditStatus status,
      UUID projectId,
      OffsetDateTime createdFrom,
      OffsetDateTime createdTo,
      Integer minimumScore,
      Integer maximumScore,
      String device
  ) {
    return (root, query, criteriaBuilder) -> {
      List<Predicate> predicates = new ArrayList<>();
      predicates.add(criteriaBuilder.equal(root.get("user").get("id"), userId));

      Join<Audit, AuditProject> project = null;
      if (search != null || projectId != null) {
        project = root.join("project", JoinType.LEFT);
      }
      if (search != null) {
        Predicate urlMatch = criteriaBuilder.like(criteriaBuilder.lower(root.<String>get("url")), search);
        Predicate projectMatch = criteriaBuilder.like(criteriaBuilder.lower(project.<String>get("name")), search);
        predicates.add(criteriaBuilder.or(urlMatch, projectMatch));
      }
      if (status != null) predicates.add(criteriaBuilder.equal(root.get("status"), status));
      if (projectId != null) predicates.add(criteriaBuilder.equal(project.get("id"), projectId));
      if (createdFrom != null) predicates.add(criteriaBuilder.greaterThanOrEqualTo(root.get("createdAt"), createdFrom));
      if (createdTo != null) predicates.add(criteriaBuilder.lessThanOrEqualTo(root.get("createdAt"), createdTo));
      if (minimumScore != null) predicates.add(criteriaBuilder.greaterThanOrEqualTo(root.get("overallScore"), minimumScore));
      if (maximumScore != null) predicates.add(criteriaBuilder.lessThanOrEqualTo(root.get("overallScore"), maximumScore));
      if (device != null) predicates.add(criteriaBuilder.like(criteriaBuilder.lower(root.<String>get("devicesJson")), device));
      return criteriaBuilder.and(predicates.toArray(Predicate[]::new));
    };
  }

  private AuditRunConfiguration validateConfiguration(AuditRunConfiguration configuration) {
    if (!configuration.authorizationConfirmed()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Confirme que possui autorização para auditar o domínio.");
    }
    if (configuration.allowDestructiveActions() && !configuration.testEnvironment()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Ações destrutivas só podem ser habilitadas em ambiente de teste.");
    }
    if (configuration.auditMode() == AuditMode.AUTHENTICATED) {
      if (configuration.authConfig() == null || !configuration.authConfig().hasCredentials()) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "Informe usuário e senha para a auditoria autenticada.");
      }
      if (!StringUtils.hasText(configuration.authConfig().loginUrl())) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "Informe a URL de login para a auditoria autenticada.");
      }
      String normalizedLoginUrl = urlSafetyValidator.validateAndNormalize(configuration.authConfig().loginUrl());
      configuration = configuration.withAuthConfig(configuration.authConfig().withLoginUrl(normalizedLoginUrl));
    }
    if (configuration.auditMode() == AuditMode.GUIDED && configuration.scenarios().isEmpty()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "Adicione pelo menos um cenário para a auditoria guiada.");
    }
    return configuration;
  }

  private void resetForRetry(Audit audit, AuditRunConfiguration configuration) {
    audit.setStatus(AuditStatus.PENDING);
    audit.setCancelRequested(false);
    audit.setOverallScore(null);
    audit.setPerformanceScore(null);
    audit.setAccessibilityScore(null);
    audit.setSeoScore(null);
    audit.setBestPracticesScore(null);
    audit.setProgressPercent(0);
    audit.setCurrentStage("QUEUED");
    audit.setStatusMessage("Nova tentativa adicionada à fila.");
    audit.setCurrentPage(null);
    audit.setActionsExecuted(0);
    audit.setFindingsCount(0);
    audit.setPagesDiscovered(0);
    audit.setPagesVisited(0);
    audit.setPagesSkipped(0);
    audit.setLinksFound(0);
    audit.setLinksChecked(0);
    audit.setInteractionsDiscovered(0);
    audit.setInteractionsExecuted(0);
    audit.setFormsFound(0);
    audit.setFormsTested(0);
    audit.setFlowsCompleted(0);
    audit.setFlowsFailed(0);
    audit.setCoveragePercent(0);
    audit.setDurationSeconds(null);
    audit.setDevicesJson(writeJson(configuration.viewports().stream()
        .map(viewport -> Boolean.TRUE.equals(viewport.mobile()) ? "MOBILE" : "DESKTOP")
        .distinct().toList()));
    audit.setViewportsJson(writeJson(configuration.viewports()));
    audit.setConfigJson(writeConfiguration(configuration.withoutCredentials()));
    audit.setDesktopScreenshotPath(null);
    audit.setMobileScreenshotPath(null);
    audit.setReportPdfPath(null);
    audit.setAiSummary(null);
    audit.setReportDataJson(null);
    audit.setFailureReason(null);
    audit.setStartedAt(null);
    audit.setFinishedAt(null);
    audit.setElapsedSeconds(null);
    audit.setEstimatedRemainingSeconds(null);
    audit.getIssues().clear();
    audit.getBrokenLinks().clear();
    audit.getConsoleErrors().clear();
    audit.setAttemptCount(audit.getAttemptCount() + 1);
  }

  private Audit requireOwnedAudit(String email, UUID auditId) {
    User user = loadUser(email);
    return auditRepository.findByIdAndUserId(auditId, user.getId())
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Auditoria não encontrada."));
  }

  private User loadUser(String email) {
    return userRepository.findByEmail(email)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Usuário não encontrado."));
  }

  private Resource loadArtifactResource(Audit audit, String rawPath, String label) {
    Path path = resolveArtifactPath(audit, rawPath);
    if (path != null && Files.isRegularFile(path)) return new FileSystemResource(path);
    if (audit.getStatus() == AuditStatus.PENDING || audit.getStatus() == AuditStatus.RUNNING) {
      throw new ApiException(HttpStatus.ACCEPTED, GENERATING_MESSAGE);
    }
    if (audit.getStatus() == AuditStatus.FAILED) throw new ApiException(HttpStatus.CONFLICT, FAILED_MESSAGE);
    throw new ApiException(HttpStatus.NOT_FOUND, label + " não está disponível para esta auditoria.");
  }

  private AuditArtifactResponse buildFileArtifact(Audit audit, String rawPath, String url, String label) {
    Path path = resolveArtifactPath(audit, rawPath);
    if (path != null && Files.isRegularFile(path)) return new AuditArtifactResponse("AVAILABLE", url, label + " está disponível.");
    if (audit.getStatus() == AuditStatus.PENDING || audit.getStatus() == AuditStatus.RUNNING) {
      return new AuditArtifactResponse("GENERATING", null, GENERATING_MESSAGE);
    }
    if (audit.getStatus() == AuditStatus.FAILED) return new AuditArtifactResponse("FAILED", null, FAILED_MESSAGE);
    if (audit.getStatus() == AuditStatus.CANCELLED) return new AuditArtifactResponse("CANCELLED", null, "A auditoria foi cancelada.");
    return new AuditArtifactResponse("UNAVAILABLE", null, label + " não está disponível para esta auditoria.");
  }

  private AuditArtifactResponse buildJsonArtifact(Audit audit) {
    if (audit.getStatus() == AuditStatus.PENDING || audit.getStatus() == AuditStatus.RUNNING) {
      return new AuditArtifactResponse("GENERATING", null, GENERATING_MESSAGE);
    }
    return new AuditArtifactResponse("AVAILABLE", buildJsonUrl(audit.getId()), "A exportação JSON está disponível.");
  }

  /** Maps legacy container paths, then confines them to type/audit-id directories below storage. */
  private Path resolveArtifactPath(Audit audit, String rawPath) {
    if (!StringUtils.hasText(rawPath)) return null;
    Path root = storageRoot();
    Path candidate;
    try {
      Path supplied = Path.of(rawPath);
      if (supplied.isAbsolute()) {
        candidate = supplied.normalize();
        if (!candidate.startsWith(root)) {
          Matcher matcher = STORAGE_SUFFIX_PATTERN.matcher(rawPath);
          if (!matcher.find()) return null;
          candidate = root.resolve(matcher.group(1).replace('\\', '/')).normalize();
        }
      } else {
        candidate = root.resolve(supplied).normalize();
      }
    } catch (RuntimeException exception) {
      return null;
    }
    String id = audit.getId().toString();
    List<Path> allowed = List.of(
        root.resolve("screenshots").resolve(id).normalize(),
        root.resolve("reports").resolve(id).normalize(),
        root.resolve(id).normalize());
    Path allowedBase = allowed.stream().filter(candidate::startsWith).findFirst().orElse(null);
    if (allowedBase == null || candidate.equals(allowedBase)) {
      log.warn("Path de artefato rejeitado para a auditoria {}", audit.getId());
      return null;
    }
    if (Files.exists(candidate)) {
      try {
        Path realRoot = root.toRealPath();
        Path realAllowedBase = allowedBase.toRealPath();
        Path realCandidate = candidate.toRealPath();
        Path expectedRealBase = realRoot.resolve(root.relativize(allowedBase)).normalize();
        if (!realAllowedBase.equals(expectedRealBase)
            || !realAllowedBase.startsWith(realRoot)
            || !realCandidate.startsWith(realAllowedBase)
            || realCandidate.equals(realAllowedBase)) {
          log.warn("Path real de artefato rejeitado para a auditoria {}", audit.getId());
          return null;
        }
        return realCandidate;
      } catch (IOException exception) {
        return null;
      }
    }
    return candidate;
  }

  private Path storageRoot() {
    String configured = StringUtils.hasText(properties.getStoragePath()) ? properties.getStoragePath() : "../storage";
    return Path.of(configured).toAbsolutePath().normalize();
  }

  private AuditListItemResponse toListItem(Audit audit) {
    IssueCounts counts = loadIssueCounts(List.of(audit)).getOrDefault(audit.getId(), IssueCounts.ZERO);
    return toListItem(audit, counts);
  }

  private AuditListItemResponse toListItem(Audit audit, IssueCounts counts) {
    return new AuditListItemResponse(
        audit.getId(), audit.getUrl(), projectId(audit), projectName(audit), audit.getAuditMode(), audit.getStatus(),
        audit.getOverallScore(), audit.getPerformanceScore(), audit.getAccessibilityScore(), audit.getSeoScore(),
        audit.getBestPracticesScore(), counts.critical(), counts.total(), audit.getProgressPercent(),
        audit.getCurrentStage(), audit.getCurrentPage(), audit.getActionsExecuted(), audit.getFindingsCount(),
        audit.getElapsedSeconds(), audit.getEstimatedRemainingSeconds(), audit.getCoveragePercent(),
        audit.getPagesVisited(), audit.getInteractionsExecuted(), audit.getStatusMessage(), audit.getCreatedAt(),
        audit.getStartedAt(), audit.getFinishedAt(), audit.getFailureReason());
  }

  private List<AuditListItemResponse> toListItems(List<Audit> audits) {
    Map<UUID, IssueCounts> counts = loadIssueCounts(audits);
    return audits.stream()
        .map(audit -> toListItem(audit, counts.getOrDefault(audit.getId(), IssueCounts.ZERO)))
        .toList();
  }

  private Map<UUID, IssueCounts> loadIssueCounts(List<Audit> audits) {
    if (audits.isEmpty()) return Map.of();
    Map<UUID, IssueCounts> result = new LinkedHashMap<>();
    issueRepository.countByAuditIds(audits.stream().map(Audit::getId).toList()).forEach(count -> result.put(
        count.getAuditId(),
        new IssueCounts(value(count.getCriticalIssues()), value(count.getTotalIssues()))));
    return result;
  }

  private AuditIssueResponse toIssueResponse(AuditIssue issue) {
    return new AuditIssueResponse(
        issue.getId(), issue.getEvidenceId(), issue.getType(), issue.getSeverity(), issue.getValidationStatus(),
        issue.getConfidence(), issue.getTitle(), issue.getDescription(), issue.getRecommendation(), issue.getSource(),
        issue.getPageUrl(), issue.getDevice(), issue.getElement(), issue.getSelector(), issue.getScreenshotPath(),
        issue.getReproductionSteps(), issue.getExpectedResult(), issue.getActualResult(), issue.getImpact(),
        issue.getEffort(), issue.getTechnicalReference(), issue.getResolutionStatus(), issue.getResolutionComment());
  }

  private AuditCoverageResponse buildCoverage(Audit audit) {
    JsonNode viewports = readJson(audit.getViewportsJson(), objectMapper.createArrayNode());
    List<String> devices = new ArrayList<>();
    JsonNode rawDevices = readJson(audit.getDevicesJson(), objectMapper.createArrayNode());
    if (rawDevices.isArray()) rawDevices.forEach(value -> devices.add(value.asText()));
    return new AuditCoverageResponse(
        value(audit.getPagesDiscovered()), value(audit.getPagesVisited()), value(audit.getPagesSkipped()),
        value(audit.getLinksFound()), value(audit.getLinksChecked()), value(audit.getInteractionsDiscovered()),
        value(audit.getInteractionsExecuted()), value(audit.getFormsFound()), value(audit.getFormsTested()),
        value(audit.getFlowsCompleted()), value(audit.getFlowsFailed()), value(audit.getFindingsCount()),
        value(audit.getCoveragePercent()), audit.getDurationSeconds(), devices, viewports);
  }

  private AuditComparisonResponse buildComparison(Audit audit) {
    Audit previous = null;
    boolean baseline = false;
    boolean validProjectTarget = audit.getProject() != null
        && urlSafetyValidator.isSameTarget(audit.getProject().getUrl(), audit.getUrl());
    if (validProjectTarget && audit.getProject().getBaselineAuditId() != null
        && !audit.getId().equals(audit.getProject().getBaselineAuditId())) {
      previous = auditRepository.findByIdAndUserId(audit.getProject().getBaselineAuditId(), audit.getUser().getId()).orElse(null);
      baseline = previous != null && previous.getProject() != null
          && previous.getStatus() == AuditStatus.COMPLETED
          && audit.getProject().getId().equals(previous.getProject().getId())
          && urlSafetyValidator.isSameTarget(audit.getUrl(), previous.getUrl());
      if (!baseline) previous = null;
    }
    if (previous == null && validProjectTarget) {
      previous = auditRepository.findTopByProjectIdAndUrlAndStatusAndIdNotAndCreatedAtBeforeOrderByCreatedAtDesc(
          audit.getProject().getId(), audit.getUrl(), AuditStatus.COMPLETED, audit.getId(), audit.getCreatedAt()).orElse(null);
    }
    // A project is useful as a preferred baseline, but it must not prevent
    // comparing two completed runs of the same normalized URL created under
    // different projects (or one with no project). URL equality remains the
    // hard safety boundary below.
    if (previous == null) {
      previous = auditRepository.findTopByUserIdAndUrlAndStatusAndIdNotAndCreatedAtBeforeOrderByCreatedAtDesc(
          audit.getUser().getId(), audit.getUrl(), AuditStatus.COMPLETED, audit.getId(), audit.getCreatedAt()).orElse(null);
    }
    if (previous == null || !urlSafetyValidator.isSameTarget(audit.getUrl(), previous.getUrl())) return null;
    Integer overallDelta = safeDelta(audit.getOverallScore(), previous.getOverallScore());
    Integer performanceDelta = safeDelta(audit.getPerformanceScore(), previous.getPerformanceScore());
    Integer accessibilityDelta = safeDelta(audit.getAccessibilityScore(), previous.getAccessibilityScore());
    Integer seoDelta = safeDelta(audit.getSeoScore(), previous.getSeoScore());
    Integer bestPracticesDelta = safeDelta(audit.getBestPracticesScore(), previous.getBestPracticesScore());
    Integer coverageDelta = safeDelta(audit.getCoveragePercent(), previous.getCoveragePercent());
    return new AuditComparisonResponse(
        previous.getId(), previous.getCreatedAt(), previous.getOverallScore(), audit.getOverallScore(), overallDelta,
        previous.getPerformanceScore(), audit.getPerformanceScore(), performanceDelta,
        previous.getAccessibilityScore(), audit.getAccessibilityScore(), accessibilityDelta,
        previous.getSeoScore(), audit.getSeoScore(), seoDelta,
        previous.getBestPracticesScore(), audit.getBestPracticesScore(), bestPracticesDelta,
        previous.getCoveragePercent(), audit.getCoveragePercent(), coverageDelta, baseline,
        trendLabel(overallDelta, performanceDelta, accessibilityDelta, seoDelta, bestPracticesDelta, coverageDelta));
  }

  private List<ScoreTimelinePointResponse> buildScoreTimeline(List<Audit> audits) {
    return audits.stream().sorted(Comparator.comparing(Audit::getCreatedAt))
        .skip(Math.max(0, audits.size() - 8L))
        .map(audit -> new ScoreTimelinePointResponse(audit.getId(),
            DateTimeFormatter.ofPattern("dd/MM").format(audit.getCreatedAt()), audit.getCreatedAt(),
            audit.getOverallScore(), audit.getPerformanceScore(), audit.getAccessibilityScore(), audit.getSeoScore(),
            audit.getBestPracticesScore())).toList();
  }

  private List<IssueTypeBreakdownResponse> buildIssueTypeBreakdown(UUID userId) {
    return issueRepository.countByTypeForUser(userId).stream().limit(8)
        .map(entry -> new IssueTypeBreakdownResponse(entry.getType().name(), value(entry.getTotal())))
        .toList();
  }

  private List<CategoryAverageScoreResponse> buildCategoryAverages(List<Audit> audits) {
    return List.of(
        new CategoryAverageScoreResponse("Performance", average(audits, Audit::getPerformanceScore)),
        new CategoryAverageScoreResponse("Acessibilidade", average(audits, Audit::getAccessibilityScore)),
        new CategoryAverageScoreResponse("SEO", average(audits, Audit::getSeoScore)),
        new CategoryAverageScoreResponse("Boas Práticas", average(audits, Audit::getBestPracticesScore)));
  }

  private double average(List<Audit> audits, java.util.function.Function<Audit, Integer> selector) {
    return audits.stream().map(selector).filter(Objects::nonNull).mapToInt(Integer::intValue).average().orElse(0);
  }

  private String writeConfiguration(AuditRunConfiguration configuration) {
    try { return objectMapper.writeValueAsString(configuration); }
    catch (JsonProcessingException exception) { throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Não foi possível salvar a configuração da auditoria."); }
  }

  private AuditRunConfiguration readConfiguration(Audit audit) {
    try { return objectMapper.readValue(audit.getConfigJson(), AuditRunConfiguration.class); }
    catch (Exception exception) { throw new ApiException(HttpStatus.CONFLICT, "A configuração desta auditoria não pode ser reutilizada."); }
  }

  private String writeJson(Object value) {
    try { return objectMapper.writeValueAsString(value); }
    catch (JsonProcessingException exception) { return "[]"; }
  }

  private JsonNode readReportData(String raw) { return readJson(raw, objectMapper.createObjectNode()); }
  private JsonNode readJson(String raw, JsonNode fallback) {
    if (!StringUtils.hasText(raw)) return fallback;
    try { return objectMapper.readTree(raw); }
    catch (JsonProcessingException exception) { return fallback; }
  }

  private String csv(Object raw) {
    String value = raw == null ? "" : String.valueOf(raw).replace("\r", " ").replace("\n", " ");
    if (!value.isEmpty() && "=+-@".indexOf(value.charAt(0)) >= 0) value = "'" + value;
    return "\"" + value.replace("\"", "\"\"") + "\"";
  }

  private long countStatus(List<Audit> audits, AuditStatus status) { return audits.stream().filter(a -> a.getStatus() == status).count(); }
  private Integer safeDelta(Integer current, Integer previous) {
    return current == null || previous == null ? null : current - previous;
  }
  private String trendLabel(Integer overallDelta, Integer... partialDeltas) {
    if (overallDelta != null) return overallDelta > 0 ? "Melhorou" : overallDelta < 0 ? "Regrediu" : "Estável";
    int available = 0;
    int total = 0;
    for (Integer delta : partialDeltas) {
      if (delta == null) continue;
      available++;
      total += delta;
    }
    if (available == 0) return "Dados insuficientes";
    return total > 0 ? "Melhorou" : total < 0 ? "Regrediu" : "Estável";
  }
  private int value(Integer value) { return value == null ? 0 : value; }
  private long value(Long value) { return value == null ? 0L : value; }
  private String likePattern(String value) {
    return StringUtils.hasText(value) ? "%" + value.trim().toLowerCase(Locale.ROOT) + "%" : null;
  }
  private UUID projectId(Audit audit) { return audit.getProject() == null ? null : audit.getProject().getId(); }
  private String projectName(Audit audit) { return audit.getProject() == null ? null : audit.getProject().getName(); }
  private String buildScreenshotUrl(UUID id, String device) { return "/api/audits/" + id + "/screenshots/" + device; }
  private String buildPdfUrl(UUID id) { return "/api/audits/" + id + "/pdf"; }
  private String buildJsonUrl(UUID id) { return "/api/audits/" + id + "/export/json"; }
  private String buildCsvUrl(UUID id) { return "/api/audits/" + id + "/export/csv"; }
  private record IssueCounts(long critical, long total) {
    private static final IssueCounts ZERO = new IssueCounts(0, 0);
  }
}
