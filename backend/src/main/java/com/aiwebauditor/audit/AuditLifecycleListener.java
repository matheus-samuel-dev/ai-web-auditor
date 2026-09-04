package com.aiwebauditor.audit;

import com.aiwebauditor.config.AppProperties;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.util.StringUtils;

record AuditCancellationEvent(UUID auditId) {}
record AuditDeletionEvent(UUID auditId) {}

@Component
public class AuditLifecycleListener {
  private static final Logger log = LoggerFactory.getLogger(AuditLifecycleListener.class);
  private final AuditorClient auditorClient;
  private final AppProperties properties;

  public AuditLifecycleListener(AuditorClient auditorClient, AppProperties properties) {
    this.auditorClient = auditorClient;
    this.properties = properties;
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void cancel(AuditCancellationEvent event) {
    auditorClient.cancelAudit(event.auditId());
  }

  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
  public void cleanup(AuditDeletionEvent event) {
    Path root = Path.of(StringUtils.hasText(properties.getStoragePath()) ? properties.getStoragePath() : "../storage")
        .toAbsolutePath().normalize();
    cleanupDirectory(root, root.resolve("screenshots").resolve(event.auditId().toString()).normalize());
    cleanupDirectory(root, root.resolve("reports").resolve(event.auditId().toString()).normalize());
    cleanupDirectory(root, root.resolve(event.auditId().toString()).normalize());
  }

  private void cleanupDirectory(Path root, Path directory) {
    if (!directory.startsWith(root) || !Files.isDirectory(directory)) return;
    try (var paths = Files.walk(directory)) {
      for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
        if (path.normalize().startsWith(directory)) Files.deleteIfExists(path);
      }
    } catch (IOException exception) {
      log.warn("Não foi possível remover todos os artefatos da auditoria excluída");
    }
  }
}
