package com.aiwebauditor.project;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {
  private final ProjectService service;
  public ProjectController(ProjectService service) { this.service = service; }

  @PostMapping @ResponseStatus(HttpStatus.CREATED)
  ProjectResponse create(@Valid @RequestBody CreateProjectRequest request, Authentication authentication) {
    return service.create(authentication.getName(), request);
  }
  @GetMapping List<ProjectResponse> list(Authentication authentication) {
    return service.list(authentication.getName());
  }
  @GetMapping("/{projectId}") ProjectResponse get(@PathVariable UUID projectId, Authentication authentication) {
    return service.get(authentication.getName(), projectId);
  }
  @PutMapping("/{projectId}") ProjectResponse update(
      @PathVariable UUID projectId, @Valid @RequestBody UpdateProjectRequest request, Authentication authentication) {
    return service.update(authentication.getName(), projectId, request);
  }
  @PatchMapping("/{projectId}/archive") ProjectResponse archive(
      @PathVariable UUID projectId, Authentication authentication) {
    return service.archive(authentication.getName(), projectId, true);
  }
  @PatchMapping("/{projectId}/restore") ProjectResponse restore(
      @PathVariable UUID projectId, Authentication authentication) {
    return service.archive(authentication.getName(), projectId, false);
  }
  @PutMapping("/{projectId}/baseline/{auditId}") ProjectResponse baseline(
      @PathVariable UUID projectId, @PathVariable UUID auditId, Authentication authentication) {
    return service.setBaseline(authentication.getName(), projectId, auditId);
  }
}
