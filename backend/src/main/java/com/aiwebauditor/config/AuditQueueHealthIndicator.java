package com.aiwebauditor.config;

import com.aiwebauditor.model.AuditStatus;
import com.aiwebauditor.repository.AuditRepository;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;

@Component("auditQueue")
public class AuditQueueHealthIndicator implements HealthIndicator {
  private final AuditRepository auditRepository;
  private final Executor executor;

  public AuditQueueHealthIndicator(
      AuditRepository auditRepository,
      @Qualifier("auditExecutor") Executor executor
  ) {
    this.auditRepository = auditRepository;
    this.executor = executor;
  }

  @Override
  public Health health() {
    long pending = auditRepository.countByStatus(AuditStatus.PENDING);
    long running = auditRepository.countByStatus(AuditStatus.RUNNING);
    Health.Builder health = Health.up().withDetail("pending", pending).withDetail("running", running);
    if (executor instanceof ThreadPoolTaskExecutor pool) {
      BlockingQueue<Runnable> queue = pool.getThreadPoolExecutor().getQueue();
      int queueSize = queue.size();
      int remainingCapacity = queue.remainingCapacity();
      long queueCapacity = (long) queueSize + remainingCapacity;
      int activeThreads = pool.getActiveCount();
      boolean shutdown = pool.getThreadPoolExecutor().isShutdown();
      boolean saturated = remainingCapacity == 0 && activeThreads >= pool.getMaxPoolSize();
      if (shutdown) {
        health = Health.outOfService().withDetail("reason", "audit executor is shut down");
      } else if (saturated) {
        health = Health.down().withDetail("reason", "audit queue is saturated");
      }
      health.withDetail("pending", pending)
          .withDetail("running", running)
          .withDetail("activeThreads", activeThreads)
          .withDetail("poolSize", pool.getPoolSize())
          .withDetail("maxPoolSize", pool.getMaxPoolSize())
          .withDetail("queueSize", queueSize)
          .withDetail("queueCapacity", queueCapacity)
          .withDetail("queueRemainingCapacity", remainingCapacity)
          .withDetail("saturated", saturated);
    }
    return health.build();
  }
}
