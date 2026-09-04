package com.aiwebauditor.audit;

import com.aiwebauditor.common.ApiException;
import com.aiwebauditor.config.AppProperties;
import com.aiwebauditor.model.AuditMode;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import javax.net.ssl.SSLException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Component
public class AuditorClient {
  private static final Logger log = LoggerFactory.getLogger(AuditorClient.class);
  private final RestClient restClient;
  private final AppProperties properties;
  private final ObjectMapper objectMapper;

  public AuditorClient(RestClient auditorRestClient, AppProperties properties, ObjectMapper objectMapper) {
    this.restClient = auditorRestClient;
    this.properties = properties;
    this.objectMapper = objectMapper;
  }

  AuditorRunResponse runAudit(UUID auditId, String url, AuditRunConfiguration configuration) {
    try {
      log.info("Solicitando execução da auditoria {} ao auditor-service", auditId);
      AuditorRunResponse response = restClient.post()
          .uri("/api/audits/run")
          .contentType(MediaType.APPLICATION_JSON)
          .header(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
          .header("X-Auditor-Api-Token", properties.getAuditorApiToken())
          .body(AuditorRunRequest.from(
              auditId, url, buildCallbackUrl(auditId), properties.getAuditorCallbackToken(), configuration))
          .retrieve()
          .body(AuditorRunResponse.class);
      if (response == null) {
        throw new ApiException(HttpStatus.BAD_GATEWAY, "O serviço de auditoria retornou uma resposta vazia.");
      }
      log.info("auditor-service concluiu a chamada da auditoria {}", auditId);
      return response;
    } catch (RestClientResponseException exception) {
      log.error("auditor-service respondeu com erro para a auditoria {}: status={}", auditId, exception.getStatusCode());
      throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          friendlyWorkerFailure(exception, configuration));
    } catch (RestClientException exception) {
      log.error("Falha de comunicação com o auditor-service para a auditoria {}", auditId, exception);
      throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          friendlyCommunicationFailure(exception));
    }
  }

  void cancelAudit(UUID auditId) {
    try {
      restClient.post()
          .uri("/api/audits/{auditId}/cancel", auditId)
          .header("X-Auditor-Api-Token", properties.getAuditorApiToken())
          .retrieve()
          .toBodilessEntity();
    } catch (RestClientException exception) {
      // The local state is authoritative; cancellation remains requested and completion is discarded.
      log.warn("Não foi possível sinalizar cancelamento ao auditor-service para a auditoria {}", auditId);
    }
  }

  private String buildCallbackUrl(UUID auditId) {
    String base = properties.getInternalCallbackBaseUrl();
    if (base == null || base.isBlank()) return null;
    return base.replaceAll("/+$", "") + "/api/internal/audits/" + auditId + "/progress";
  }

  private String friendlyWorkerFailure(
      RestClientResponseException exception,
      AuditRunConfiguration configuration
  ) {
    String message = extractWorkerMessage(exception);
    if (message != null && configuration != null) {
      for (String secret : configuration.secretValues()) message = message.replace(secret, "[REDACTED]");
    }
    String normalized = message == null ? "" : message.replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", " ")
        .replaceAll("\\s+", " ").trim().toLowerCase(Locale.ROOT);
    int status = exception.getStatusCode().value();

    if (status == 408 || containsAny(normalized, "timeout", "timed out", "tempo limite", "demorou demais")) {
      return "A página demorou mais que o limite configurado para responder. Tente novamente ou aumente o timeout.";
    }
    if (containsAny(normalized, "enotfound", "name_not_resolved", "name not resolved", "dns", "resolver o domínio")) {
      return "Não foi possível localizar o domínio informado. Confira o endereço e tente novamente.";
    }
    if (containsAny(normalized, "ssl", "certificate", "certificado", "cert_")) {
      return "O site apresentou um problema de certificado SSL e não pôde ser auditado com segurança.";
    }
    if (containsAny(normalized, "rede privada", "reservad", "loopback", "metadata", "ssrf", "não permitid")) {
      return "A URL foi recusada pelas regras de segurança porque aponta para um endereço não permitido.";
    }
    if (status == 499 || containsAny(normalized, "cancelad")) {
      return "A execução foi cancelada antes da conclusão.";
    }
    if (status == 429) {
      return "O serviço de auditoria está ocupado no momento. Aguarde alguns instantes e tente novamente.";
    }
    if (containsAny(normalized, "lighthouse")) {
      return "O Lighthouse não conseguiu analisar a página. Os demais resultados disponíveis foram preservados.";
    }
    if (containsAny(normalized, "playwright", "chromium", "chrome", "browser", "navegador")) {
      return "O navegador automatizado não conseguiu processar a página. Tente novamente em alguns instantes.";
    }
    if (status == 400) {
      return "O serviço de auditoria recusou a configuração enviada. Revise a URL e as opções da auditoria.";
    }
    if (status == 409) {
      return "Já existe uma execução ativa para esta auditoria. Aguarde a conclusão antes de tentar novamente.";
    }
    if (status == 422) {
      return "A página não pôde ser auditada. Verifique se ela está disponível e permite acesso automatizado.";
    }
    return status >= 500
        ? "O serviço de auditoria encontrou um erro interno. Tente novamente em alguns instantes."
        : "Não foi possível concluir a auditoria com a configuração informada.";
  }

  private String friendlyCommunicationFailure(RestClientException exception) {
    if (hasCause(exception, SocketTimeoutException.class)) {
      return "O serviço de auditoria excedeu o tempo limite de resposta. A execução foi encerrada com segurança.";
    }
    if (hasCause(exception, SSLException.class)) {
      return "Não foi possível estabelecer uma conexão segura com o serviço de auditoria.";
    }
    if (hasCause(exception, ConnectException.class)) {
      return "O serviço de auditoria está offline ou recusou a conexão. Tente novamente em alguns instantes.";
    }
    return "O serviço de auditoria está indisponível no momento. Tente novamente em alguns instantes.";
  }

  private String extractWorkerMessage(RestClientResponseException exception) {
    String body = exception.getResponseBodyAsString();
    if (body == null || body.isBlank()) return null;
    try {
      JsonNode json = objectMapper.readTree(body.substring(0, Math.min(body.length(), 4_096)));
      String message = json.path("message").asText(null);
      return message == null || message.isBlank() ? null : message.substring(0, Math.min(message.length(), 500));
    } catch (Exception ignored) {
      return null;
    }
  }

  private boolean containsAny(String value, String... terms) {
    for (String term : terms) if (value.contains(term)) return true;
    return false;
  }

  private boolean hasCause(Throwable error, Class<? extends Throwable> type) {
    Throwable current = error;
    for (int depth = 0; current != null && depth < 12; depth++) {
      if (type.isInstance(current)) return true;
      current = current.getCause();
    }
    return false;
  }
}

record AuditorRunRequest(
    UUID auditId,
    String url,
    String callbackUrl,
    String callbackToken,
    AuditorServiceConfiguration config
) {
  static AuditorRunRequest from(
      UUID auditId,
      String url,
      String callbackUrl,
      String callbackToken,
      AuditRunConfiguration configuration
  ) {
    List<AuditorViewport> viewports = configuration.viewports().stream()
        .map(viewport -> new AuditorViewport(
            viewport.name(), viewport.name(), viewport.width(), viewport.height(),
            viewport.mobile() != null ? viewport.mobile() : viewport.width() < 900))
        .toList();
    return new AuditorRunRequest(
        auditId,
        url,
        callbackUrl,
        callbackToken,
        new AuditorServiceConfiguration(
            configuration.auditMode(), configuration.maxPages(), configuration.maxDepth(),
            configuration.timeoutSeconds(), configuration.includePatterns(), configuration.excludePatterns(),
            viewports, configuration.authorizationConfirmed(), configuration.testEnvironment(),
            configuration.allowDestructiveActions(), configuration.aiEnabled(), configuration.authConfig(),
            configuration.scenarios()));
  }
}

record AuditorServiceConfiguration(
    AuditMode auditMode,
    int maxPages,
    int maxDepth,
    int timeoutSeconds,
    List<String> include,
    List<String> exclude,
    List<AuditorViewport> viewports,
    boolean authorizationConfirmed,
    boolean testEnvironment,
    boolean allowDestructiveActions,
    boolean aiEnabled,
    AuthConfigRequest authConfig,
    List<AuditScenarioRequest> scenarios
) {}

record AuditorViewport(String id, String label, int width, int height, boolean isMobile) {}

record AuditorRunResponse(
    Integer overallScore,
    Integer performanceScore,
    Integer accessibilityScore,
    Integer seoScore,
    Integer bestPracticesScore,
    String desktopScreenshotPath,
    String mobileScreenshotPath,
    String reportPdfPath,
    String aiSummary,
    OffsetDateTime finishedAt,
    Map<String, Object> reportData,
    List<AuditorFinding> issues,
    List<AuditorBrokenLink> brokenLinks,
    List<AuditorConsoleError> consoleErrors
) {}

record AuditorFinding(
    String id,
    String type,
    String severity,
    String title,
    String description,
    String recommendation,
    String source,
    String confidence,
    String validationStatus,
    List<String> evidenceIds,
    String viewportId,
    String url,
    String element,
    String selector,
    String screenshotPath,
    List<String> reproductionSteps,
    String expectedResult,
    String actualResult,
    String impact,
    String effort,
    String technicalReference
) {}

record AuditorBrokenLink(String url, Integer statusCode) {}

record AuditorConsoleError(String message, String type) {}
