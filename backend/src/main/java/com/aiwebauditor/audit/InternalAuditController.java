package com.aiwebauditor.audit;

import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/internal/audits")
public class InternalAuditController {

  private final AuditExecutionService auditExecutionService;

  public InternalAuditController(AuditExecutionService auditExecutionService) {
    this.auditExecutionService = auditExecutionService;
  }

  @PostMapping("/{auditId}/progress")
  ResponseEntity<Void> updateProgress(
      @PathVariable UUID auditId,
      @Valid @RequestBody AuditProgressUpdateRequest request
  ) {
    auditExecutionService.updateProgress(auditId, request);
    return ResponseEntity.noContent().build();
  }
}
