package com.aiwebauditor.repository;

import com.aiwebauditor.model.Audit;
import com.aiwebauditor.model.AuditStatus;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuditRepository extends JpaRepository<Audit, UUID>, JpaSpecificationExecutor<Audit> {

  @EntityGraph(attributePaths = "project")
  List<Audit> findAllByUserIdOrderByCreatedAtDesc(UUID userId);

  @EntityGraph(attributePaths = "project")
  Optional<Audit> findByIdAndUserId(UUID id, UUID userId);

  Optional<Audit> findTopByUserIdOrderByCreatedAtDesc(UUID userId);

  Optional<Audit> findTopByUserIdAndStatusAndCreatedAtBeforeOrderByCreatedAtDesc(
      UUID userId,
      AuditStatus status,
      OffsetDateTime createdAt
  );

  Optional<Audit> findTopByProjectIdAndUrlAndStatusAndIdNotAndCreatedAtBeforeOrderByCreatedAtDesc(
      UUID projectId,
      String url,
      AuditStatus status,
      UUID excludedAuditId,
      OffsetDateTime createdAt
  );

  Optional<Audit> findTopByUserIdAndUrlAndStatusAndIdNotAndCreatedAtBeforeOrderByCreatedAtDesc(
      UUID userId,
      String url,
      AuditStatus status,
      UUID excludedAuditId,
      OffsetDateTime createdAt
  );

  List<Audit> findByStatusInAndUpdatedAtBefore(List<AuditStatus> statuses, OffsetDateTime cutoff);

  List<Audit> findAllByStatus(AuditStatus status);

  long countByStatus(AuditStatus status);

  long countByUserId(UUID userId);

  long countByUserIdAndStatus(UUID userId, AuditStatus status);

  long countByProjectId(UUID projectId);

  interface ProjectAuditCountProjection {
    UUID getProjectId();
    Long getAuditCount();
  }

  @Query("""
      select a.project.id as projectId, count(a.id) as auditCount
      from Audit a
      where a.project.id in :projectIds
      group by a.project.id
      """)
  List<ProjectAuditCountProjection> countByProjectIds(@Param("projectIds") List<UUID> projectIds);

  @Query("""
      select avg(a.overallScore)
      from Audit a
      where a.user.id = :userId and a.overallScore is not null
      """)
  Double findAverageScoreByUserId(@Param("userId") UUID userId);

  @Query("select avg(a.coveragePercent) from Audit a where a.user.id = :userId and a.status = com.aiwebauditor.model.AuditStatus.COMPLETED")
  Double findAverageCoverageByUserId(@Param("userId") UUID userId);

  @Query("""
      select count(i)
      from AuditIssue i
      where i.audit.user.id = :userId and i.severity = com.aiwebauditor.model.IssueSeverity.CRITICAL
      """)
  Long countCriticalIssuesByUserId(@Param("userId") UUID userId);

  @Modifying(clearAutomatically = true, flushAutomatically = true)
  @Query("""
      update Audit a
         set a.status = com.aiwebauditor.model.AuditStatus.RUNNING,
             a.version = a.version + 1,
             a.startedAt = :startedAt,
             a.updatedAt = :startedAt,
             a.failureReason = null,
             a.finishedAt = null,
             a.progressPercent = 2,
             a.currentStage = 'BOOTING_PIPELINE',
             a.statusMessage = 'Preparando o pipeline automatizado da auditoria.'
       where a.id = :auditId
         and a.status = com.aiwebauditor.model.AuditStatus.PENDING
         and a.cancelRequested = false
      """)
  int claimForExecution(@Param("auditId") UUID auditId, @Param("startedAt") OffsetDateTime startedAt);
}
