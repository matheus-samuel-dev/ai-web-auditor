package com.aiwebauditor.project;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.UUID;

record CreateProjectRequest(
    @NotBlank @Size(max = 120) String name,
    @NotBlank @Size(max = 2048) String url,
    @Size(max = 40) String environment,
    @Size(max = 40) String frequency,
    JsonNode defaultConfig,
    @NotNull(message = "Confirme que possui autorização para auditar o domínio.")
    @AssertTrue(message = "Você precisa confirmar que possui autorização para auditar o domínio.")
    Boolean authorizationConfirmed
) {}

record UpdateProjectRequest(
    @Size(min = 1, max = 120) String name,
    @Size(min = 1, max = 2048) String url,
    @Size(max = 40) String environment,
    @Size(max = 40) String frequency,
    JsonNode defaultConfig
) {}

record ProjectResponse(
    UUID id,
    String name,
    String url,
    String domain,
    String environment,
    String frequency,
    boolean archived,
    UUID baselineAuditId,
    long auditCount,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt,
    JsonNode defaultConfig
) {}
