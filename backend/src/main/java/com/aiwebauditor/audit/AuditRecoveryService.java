package com.aiwebauditor.audit;

import com.aiwebauditor.common.ApiException;
import com.aiwebauditor.config.AppProperties;
import com.aiwebauditor.model.Audit;
import com.aiwebauditor.model.AuditStatus;
import com.aiwebauditor.repository.AuditRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class AuditRecoveryService {
  private static final Logger log = LoggerFactory.getLogger(AuditRecoveryService.class);
  private final AuditRepository auditRepository;
  private final AuditExecutionService executionService;
  private final AuditStateService stateService;
  private final ObjectMapper objectMapper;
  private final AppProperties properties;

  public AuditRecoveryService(
      AuditRepository auditRepository,
      AuditExecutionService executionService,
      AuditStateService stateService,
      ObjectMapper objectMapper,
      AppProperties properties
  ) {
    this.auditRepository = auditRepository;
    this.executionService = executionService;
    this.stateService = stateService;
    this.objectMapper = objectMapper;
    this.properties = properties;
  }

  @EventListener(ApplicationReadyEvent.class)
  public void recoverAtStartup() {
    List<Audit> candidates = new ArrayList<>(auditRepository.findAllByStatus(AuditStatus.PENDING));
    candidates.addAll(auditRepository.findAllByStatus(AuditStatus.RUNNING));
    recover(candidates, true);
  }

  @Scheduled(fixedDelayString = "${app.orphan-scan-delay-ms:60000}")
  public void recoverStale() {
    OffsetDateTime cutoff = OffsetDateTime.now().minusSeconds(properties.getOrphanThresholdSeconds());
    recover(auditRepository.findByStatusInAndUpdatedAtBefore(
        List.of(AuditStatus.PENDING, AuditStatus.RUNNING), cutoff), false);
  }

  private void recover(List<Audit> audits, boolean startup) {
    for (Audit audit : audits) {
      if (audit.getStatus() == AuditStatus.RUNNING) {
        String reason = startup
            ? "A execução foi interrompida por uma reinicialização do backend. Tente novamente."
            : "A execução excedeu o período sem atualizações e foi encerrada. Tente novamente.";
        stateService.fail(audit.getId(), new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, reason), null);
        continue;
      }
      try {
        AuditRunConfiguration configuration = objectMapper.readValue(audit.getConfigJson(), AuditRunConfiguration.class);
        if (configuration.requiresEphemeralInputs()) {
          stateService.fail(audit.getId(), new ApiException(HttpStatus.CONFLICT,
              "Os dados sensíveis temporários foram descartados. Repita a auditoria e informe-os novamente."), null);
        } else {
          executionService.executeAsync(audit.getId(), configuration);
        }
      } catch (Exception exception) {
        stateService.fail(audit.getId(), new ApiException(HttpStatus.CONFLICT,
            "A configuração da auditoria não pôde ser recuperada. Tente novamente."), null);
      }
    }
    if (!audits.isEmpty()) log.info("Recuperação avaliou {} auditorias órfãs", audits.size());
  }
}
