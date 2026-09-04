package com.aiwebauditor.audit;

import jakarta.validation.Valid;
import java.util.List;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/audits")
public class AuditController {

  private final AuditService auditService;

  public AuditController(AuditService auditService) {
    this.auditService = auditService;
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  AuditListItemResponse create(@Valid @RequestBody CreateAuditRequest request, Authentication authentication) {
    return auditService.create(authentication.getName(), request);
  }

  @GetMapping
  List<AuditListItemResponse> list(Authentication authentication) {
    return auditService.list(authentication.getName());
  }

  @GetMapping("/history")
  AuditHistoryPageResponse history(
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size,
      @RequestParam(required = false) String search,
      @RequestParam(required = false) com.aiwebauditor.model.AuditStatus status,
      @RequestParam(required = false) UUID projectId,
      @RequestParam(required = false) OffsetDateTime createdFrom,
      @RequestParam(required = false) OffsetDateTime createdTo,
      @RequestParam(required = false) Integer minimumScore,
      @RequestParam(required = false) Integer maximumScore,
      @RequestParam(required = false) String device,
      @RequestParam(defaultValue = "createdAt") String sort,
      @RequestParam(defaultValue = "desc") String direction,
      Authentication authentication
  ) {
    return auditService.history(
        authentication.getName(), page, size, search, status, projectId, createdFrom, createdTo,
        minimumScore, maximumScore, device, sort, direction);
  }

  @GetMapping("/dashboard")
  DashboardSummaryResponse dashboard(Authentication authentication) {
    return auditService.dashboard(authentication.getName());
  }

  @GetMapping("/{auditId}")
  AuditReportResponse getById(@PathVariable UUID auditId, Authentication authentication) {
    return auditService.getById(authentication.getName(), auditId);
  }

  @GetMapping("/{auditId}/pdf")
  ResponseEntity<Resource> downloadPdf(@PathVariable UUID auditId, Authentication authentication) {
    Resource resource = auditService.loadPdf(authentication.getName(), auditId);
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_PDF)
        .header(HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment().filename("audit-" + auditId + ".pdf").build().toString())
        .body(resource);
  }

  @GetMapping("/{auditId}/export/json")
  ResponseEntity<byte[]> exportJson(@PathVariable UUID auditId, Authentication authentication) {
    byte[] payload = auditService.exportJsonBytes(authentication.getName(), auditId);
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_JSON)
        .header(HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment().filename("audit-" + auditId + ".json").build().toString())
        .body(payload);
  }

  @GetMapping("/{auditId}/export/csv")
  ResponseEntity<byte[]> exportCsv(@PathVariable UUID auditId, Authentication authentication) {
    byte[] payload = auditService.exportCsvBytes(authentication.getName(), auditId);
    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
        .header(HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment().filename("audit-" + auditId + ".csv").build().toString())
        .body(payload);
  }

  @PostMapping("/{auditId}/cancel")
  AuditListItemResponse cancel(@PathVariable UUID auditId, Authentication authentication) {
    return auditService.cancel(authentication.getName(), auditId);
  }

  @PostMapping("/{auditId}/retry")
  AuditListItemResponse retry(
      @PathVariable UUID auditId,
      @Valid @RequestBody(required = false) RetryAuditRequest request,
      Authentication authentication
  ) {
    return auditService.retry(authentication.getName(), auditId, request);
  }

  @DeleteMapping("/{auditId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  void delete(@PathVariable UUID auditId, Authentication authentication) {
    auditService.delete(authentication.getName(), auditId);
  }

  @PatchMapping("/{auditId}/findings/{findingId}")
  AuditIssueResponse patchFinding(
      @PathVariable UUID auditId,
      @PathVariable UUID findingId,
      @Valid @RequestBody PatchAuditIssueRequest request,
      Authentication authentication
  ) {
    return auditService.patchIssue(authentication.getName(), auditId, findingId, request);
  }

  @GetMapping("/{auditId}/screenshots/{device}")
  ResponseEntity<Resource> screenshot(
      @PathVariable UUID auditId,
      @PathVariable String device,
      Authentication authentication
  ) {
    Resource resource = auditService.loadScreenshot(authentication.getName(), auditId, device);
    return ResponseEntity.ok()
        .contentType(MediaType.IMAGE_PNG)
        .header(HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.inline().filename("audit-" + auditId + "-" + device + ".png").build().toString())
        .body(resource);
  }
}
