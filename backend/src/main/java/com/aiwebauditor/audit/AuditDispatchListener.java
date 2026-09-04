package com.aiwebauditor.audit;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

record AuditDispatchEvent(UUID auditId, AuditRunConfiguration configuration) {}

@Component
public class AuditDispatchListener {
  private static final Logger log = LoggerFactory.getLogger(AuditDispatchListener.class);
  private final AuditExecutionService executionService;

  public AuditDispatchListener(AuditExecutionService executionService) {
    this.executionService = executionService;
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void dispatch(AuditDispatchEvent event) {
    try {
      executionService.executeAsync(event.auditId(), event.configuration());
    } catch (RuntimeException exception) {
      log.error("Não foi possível enfileirar a auditoria {}", event.auditId(), exception);
      executionService.failDispatch(event.auditId(), exception, event.configuration());
    }
  }
}
