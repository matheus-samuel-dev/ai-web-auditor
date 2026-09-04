package com.aiwebauditor.repository;

import com.aiwebauditor.model.AuditProject;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditProjectRepository extends JpaRepository<AuditProject, UUID> {
  List<AuditProject> findAllByUserIdOrderByCreatedAtDesc(UUID userId);
  Optional<AuditProject> findByIdAndUserId(UUID id, UUID userId);
  long countByUserIdAndArchivedFalse(UUID userId);
}
