package com.aiwebauditor.common;

import jakarta.validation.ConstraintViolationException;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.http.converter.HttpMessageNotReadableException;

@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(ApiException.class)
  ResponseEntity<ErrorResponse> handleApiException(ApiException exception) {
    if (exception.getStatus().is5xxServerError()) {
      log.error("Erro de API tratado: status={}, mensagem={}", exception.getStatus(), exception.getMessage(), exception);
    }

    return ResponseEntity.status(exception.getStatus())
        .body(new ErrorResponse(
            OffsetDateTime.now(),
            exception.getStatus().value(),
            exception.getStatus().getReasonPhrase(),
            exception.getMessage(),
            Map.of()));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException exception) {
    Map<String, String> fieldErrors = new LinkedHashMap<>();

    for (FieldError fieldError : exception.getBindingResult().getFieldErrors()) {
      fieldErrors.put(fieldError.getField(), fieldError.getDefaultMessage());
    }

    return ResponseEntity.badRequest()
        .body(new ErrorResponse(
            OffsetDateTime.now(),
            HttpStatus.BAD_REQUEST.value(),
            HttpStatus.BAD_REQUEST.getReasonPhrase(),
            "Dados inv\u00E1lidos. Revise os campos informados.",
            fieldErrors));
  }

  @ExceptionHandler(ConstraintViolationException.class)
  ResponseEntity<ErrorResponse> handleConstraint(ConstraintViolationException exception) {
    Map<String, String> fieldErrors = new LinkedHashMap<>();
    exception.getConstraintViolations().forEach(violation ->
        fieldErrors.put(violation.getPropertyPath().toString(), violation.getMessage()));
    return ResponseEntity.badRequest()
        .body(new ErrorResponse(
            OffsetDateTime.now(),
            HttpStatus.BAD_REQUEST.value(),
            HttpStatus.BAD_REQUEST.getReasonPhrase(),
            "Dados inválidos. Revise os valores informados.",
            fieldErrors));
  }

  @ExceptionHandler(HandlerMethodValidationException.class)
  ResponseEntity<ErrorResponse> handleMethodValidation(HandlerMethodValidationException exception) {
    return badRequest("Dados inválidos. Revise os parâmetros informados.", Map.of());
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<ErrorResponse> handleUnreadableMessage(HttpMessageNotReadableException exception) {
    return badRequest("O corpo JSON é inválido. Revise o formato e os tipos dos campos.", Map.of());
  }

  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException exception) {
    String name = exception.getName() == null ? "parâmetro" : exception.getName();
    return badRequest(
        "Um parâmetro possui formato inválido.",
        Map.of(name, "Informe um valor compatível com o tipo esperado."));
  }

  @ExceptionHandler(OptimisticLockingFailureException.class)
  ResponseEntity<ErrorResponse> handleOptimisticLock(OptimisticLockingFailureException exception) {
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(new ErrorResponse(
            OffsetDateTime.now(),
            HttpStatus.CONFLICT.value(),
            HttpStatus.CONFLICT.getReasonPhrase(),
            "A auditoria foi atualizada por outra opera\u00E7\u00E3o. Recarregue os dados e tente novamente.",
            Map.of()));
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<ErrorResponse> handleDataIntegrity(DataIntegrityViolationException exception) {
    log.warn("Conflito de integridade ao persistir dados da requisição.");
    return ResponseEntity.status(HttpStatus.CONFLICT)
        .body(new ErrorResponse(
            OffsetDateTime.now(),
            HttpStatus.CONFLICT.value(),
            HttpStatus.CONFLICT.getReasonPhrase(),
            "Os dados informados entram em conflito com um registro existente.",
            Map.of()));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<ErrorResponse> handleUnexpected(Exception exception) {
    log.error("Erro inesperado nao tratado.", exception);

    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(new ErrorResponse(
            OffsetDateTime.now(),
            HttpStatus.INTERNAL_SERVER_ERROR.value(),
            HttpStatus.INTERNAL_SERVER_ERROR.getReasonPhrase(),
            "Ocorreu um erro inesperado ao processar a requisi\u00E7\u00E3o.",
            Map.of()));
  }

  private ResponseEntity<ErrorResponse> badRequest(String message, Map<String, String> fieldErrors) {
    return ResponseEntity.badRequest()
        .body(new ErrorResponse(
            OffsetDateTime.now(),
            HttpStatus.BAD_REQUEST.value(),
            HttpStatus.BAD_REQUEST.getReasonPhrase(),
            message,
            fieldErrors));
  }

  record ErrorResponse(
      OffsetDateTime timestamp,
      int status,
      String error,
      String message,
      Map<String, String> fieldErrors
  ) {}
}
