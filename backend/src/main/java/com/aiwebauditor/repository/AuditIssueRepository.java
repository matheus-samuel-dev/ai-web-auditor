package com.aiwebauditor.repository;

import com.aiwebauditor.model.AuditIssue;
import com.aiwebauditor.model.IssueType;
import java.util.Optional;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AuditIssueRepository extends JpaRepository<AuditIssue, UUID> {
  Optional<AuditIssue> findByIdAndAuditIdAndAuditUserId(UUID id, UUID auditId, UUID userId);

  interface AuditIssueCountProjection {
    UUID getAuditId();
    Long getTotalIssues();
    Long getCriticalIssues();
  }

  interface IssueTypeCountProjection {
    IssueType getType();
    Long getTotal();
  }

  @Query("""
      select i.audit.id as auditId,
             count(i.id) as totalIssues,
             sum(case when i.severity = com.aiwebauditor.model.IssueSeverity.CRITICAL then 1 else 0 end) as criticalIssues
      from AuditIssue i
      where i.audit.id in :auditIds
      group by i.audit.id
      """)
  List<AuditIssueCountProjection> countByAuditIds(@Param("auditIds") List<UUID> auditIds);

  @Query("""
      select i.type as type, count(i.id) as total
      from AuditIssue i
      where i.audit.user.id = :userId
      group by i.type
      order by count(i.id) desc
      """)
  List<IssueTypeCountProjection> countByTypeForUser(@Param("userId") UUID userId);
}
