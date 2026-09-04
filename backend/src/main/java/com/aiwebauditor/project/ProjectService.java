package com.aiwebauditor.project;

import com.aiwebauditor.audit.UrlSafetyValidator;
import com.aiwebauditor.common.ApiException;
import com.aiwebauditor.model.Audit;
import com.aiwebauditor.model.AuditProject;
import com.aiwebauditor.model.AuditStatus;
import com.aiwebauditor.model.User;
import com.aiwebauditor.repository.AuditProjectRepository;
import com.aiwebauditor.repository.AuditRepository;
import com.aiwebauditor.repository.UserRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class ProjectService {
  private static final Pattern SENSITIVE_KEY = Pattern.compile(
      "(?i).*(password|passwd|secret|token|credential|authorization|api.?key|username|user).*");
  private final AuditProjectRepository projectRepository;
  private final AuditRepository auditRepository;
  private final UserRepository userRepository;
  private final UrlSafetyValidator urlSafetyValidator;
  private final ObjectMapper objectMapper;

  public ProjectService(
      AuditProjectRepository projectRepository,
      AuditRepository auditRepository,
      UserRepository userRepository,
      UrlSafetyValidator urlSafetyValidator,
      ObjectMapper objectMapper
  ) {
    this.projectRepository = projectRepository;
    this.auditRepository = auditRepository;
    this.userRepository = userRepository;
    this.urlSafetyValidator = urlSafetyValidator;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public ProjectResponse create(String email, CreateProjectRequest request) {
    User user = loadUser(email);
    String url = urlSafetyValidator.validateAndNormalize(request.url());
    AuditProject project = new AuditProject();
    project.setUser(user);
    project.setName(request.name().trim());
    project.setUrl(url);
    project.setDomain(URI.create(url).getHost().toLowerCase(Locale.ROOT));
    project.setEnvironment(normalize(request.environment(), "PRODUCTION"));
    project.setFrequency(normalize(request.frequency(), null));
    project.setDefaultConfigJson(writeSafeConfig(request.defaultConfig()));
    projectRepository.save(project);
    return toResponse(project, 0);
  }

  @Transactional(readOnly = true)
  public List<ProjectResponse> list(String email) {
    User user = loadUser(email);
    List<AuditProject> projects = projectRepository.findAllByUserIdOrderByCreatedAtDesc(user.getId());
    Map<UUID, Long> auditCounts = new HashMap<>();
    if (!projects.isEmpty()) {
      auditRepository.countByProjectIds(projects.stream().map(AuditProject::getId).toList())
          .forEach(count -> auditCounts.put(count.getProjectId(), count.getAuditCount()));
    }
    return projects.stream()
        .map(project -> toResponse(project, auditCounts.getOrDefault(project.getId(), 0L)))
        .toList();
  }

  @Transactional(readOnly = true)
  public ProjectResponse get(String email, UUID projectId) {
    return toResponse(requireOwned(email, projectId));
  }

  @Transactional
  public ProjectResponse update(String email, UUID projectId, UpdateProjectRequest request) {
    AuditProject project = requireOwned(email, projectId);
    if (StringUtils.hasText(request.name())) project.setName(request.name().trim());
    if (StringUtils.hasText(request.url())) {
      String url = urlSafetyValidator.validateAndNormalize(request.url());
      project.setUrl(url);
      project.setDomain(URI.create(url).getHost().toLowerCase(Locale.ROOT));
      if (project.getBaselineAuditId() != null) {
        Audit baseline = auditRepository.findByIdAndUserId(project.getBaselineAuditId(), project.getUser().getId())
            .orElse(null);
        if (baseline == null || !urlSafetyValidator.isSameTarget(url, baseline.getUrl())) {
          project.setBaselineAuditId(null);
        }
      }
    }
    if (request.environment() != null) project.setEnvironment(normalize(request.environment(), "PRODUCTION"));
    if (request.frequency() != null) project.setFrequency(normalize(request.frequency(), null));
    if (request.defaultConfig() != null) project.setDefaultConfigJson(writeSafeConfig(request.defaultConfig()));
    return toResponse(project);
  }

  @Transactional
  public ProjectResponse archive(String email, UUID projectId, boolean archived) {
    AuditProject project = requireOwned(email, projectId);
    project.setArchived(archived);
    return toResponse(project);
  }

  @Transactional
  public ProjectResponse setBaseline(String email, UUID projectId, UUID auditId) {
    AuditProject project = requireOwned(email, projectId);
    Audit audit = auditRepository.findByIdAndUserId(auditId, project.getUser().getId())
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Auditoria não encontrada."));
    if (audit.getStatus() != AuditStatus.COMPLETED
        || audit.getProject() == null
        || !projectId.equals(audit.getProject().getId())
        || !urlSafetyValidator.isSameTarget(project.getUrl(), audit.getUrl())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "A baseline deve ser uma auditoria concluída do mesmo projeto.");
    }
    project.setBaselineAuditId(auditId);
    return toResponse(project);
  }

  private AuditProject requireOwned(String email, UUID id) {
    User user = loadUser(email);
    return projectRepository.findByIdAndUserId(id, user.getId())
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Projeto não encontrado."));
  }

  private User loadUser(String email) {
    return userRepository.findByEmail(email)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Usuário não encontrado."));
  }

  private String writeSafeConfig(JsonNode config) {
    if (config == null || config.isNull()) return "{}";
    rejectSecrets(config);
    try {
      return objectMapper.writeValueAsString(config);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "A configuração padrão do projeto é inválida.");
    }
  }

  private void rejectSecrets(JsonNode node) {
    if (node.isObject()) {
      for (Map.Entry<String, JsonNode> entry : node.properties()) {
        if (SENSITIVE_KEY.matcher(entry.getKey()).matches()) {
          throw new ApiException(HttpStatus.BAD_REQUEST, "Credenciais não podem ser salvas na configuração do projeto.");
        }
        rejectSecrets(entry.getValue());
      }
    } else if (node.isArray()) {
      node.forEach(this::rejectSecrets);
    }
  }

  private String normalize(String value, String fallback) {
    return StringUtils.hasText(value) ? value.trim().toUpperCase(Locale.ROOT) : fallback;
  }

  private ProjectResponse toResponse(AuditProject project) {
    return toResponse(project, auditRepository.countByProjectId(project.getId()));
  }

  private ProjectResponse toResponse(AuditProject project, long auditCount) {
    JsonNode config;
    try {
      config = objectMapper.readTree(project.getDefaultConfigJson() == null ? "{}" : project.getDefaultConfigJson());
    } catch (JsonProcessingException exception) {
      config = objectMapper.createObjectNode();
    }
    return new ProjectResponse(
        project.getId(), project.getName(), project.getUrl(), project.getDomain(), project.getEnvironment(),
        project.getFrequency(), project.isArchived(), project.getBaselineAuditId(),
        auditCount, project.getCreatedAt(), project.getUpdatedAt(), config);
  }
}
