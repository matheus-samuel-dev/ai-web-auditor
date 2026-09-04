package com.aiwebauditor.audit;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.ExpectedCount.once;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

import com.aiwebauditor.common.ApiException;
import com.aiwebauditor.config.AppProperties;
import com.aiwebauditor.model.AuditMode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.SocketTimeoutException;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class AuditorClientTest {
  private MockRestServiceServer server;
  private AuditorClient client;

  @BeforeEach
  void setUp() {
    RestClient.Builder builder = RestClient.builder().baseUrl("http://auditor.test");
    server = MockRestServiceServer.bindTo(builder).build();
    AppProperties properties = new AppProperties();
    properties.setAuditorApiToken("test-auditor-api-token-with-safe-length");
    properties.setAuditorCallbackToken("test-callback-token-with-safe-length");
    properties.setInternalCallbackBaseUrl("http://backend.test");
    client = new AuditorClient(builder.build(), properties, new ObjectMapper());
  }

  @Test
  void translatesWorkerTimeoutIntoAnActionableFailure() {
    server.expect(once(), requestTo("http://auditor.test/api/audits/run"))
        .andRespond(withStatus(HttpStatus.REQUEST_TIMEOUT)
            .contentType(MediaType.APPLICATION_JSON)
            .body("{\"message\":\"Navigation timeout of 30000 ms exceeded\"}"));

    assertThatThrownBy(() -> client.runAudit(UUID.randomUUID(), "https://example.test", configuration()))
        .isInstanceOf(ApiException.class)
        .hasMessage("A página demorou mais que o limite configurado para responder. Tente novamente ou aumente o timeout.");
    server.verify();
  }

  @Test
  void translatesDnsFailureWithoutLeakingWorkerDetails() {
    server.expect(once(), requestTo("http://auditor.test/api/audits/run"))
        .andRespond(withStatus(HttpStatus.UNPROCESSABLE_ENTITY)
            .contentType(MediaType.APPLICATION_JSON)
            .body("{\"message\":\"net::ERR_NAME_NOT_RESOLVED at https://private.example/path?token=secret\"}"));

    assertThatThrownBy(() -> client.runAudit(UUID.randomUUID(), "https://example.test", configuration()))
        .isInstanceOf(ApiException.class)
        .hasMessage("Não foi possível localizar o domínio informado. Confira o endereço e tente novamente.")
        .hasMessageNotContaining("private.example")
        .hasMessageNotContaining("secret");
    server.verify();
  }

  @Test
  void distinguishesCommunicationTimeoutFromAWorkerResponse() {
    server.expect(once(), requestTo("http://auditor.test/api/audits/run"))
        .andRespond(withException(new SocketTimeoutException("Read timed out")));

    assertThatThrownBy(() -> client.runAudit(UUID.randomUUID(), "https://example.test", configuration()))
        .isInstanceOf(ApiException.class)
        .hasMessage("O serviço de auditoria excedeu o tempo limite de resposta. A execução foi encerrada com segurança.");
    server.verify();
  }

  private AuditRunConfiguration configuration() {
    return new AuditRunConfiguration(
        AuditMode.QUICK,
        1,
        0,
        180,
        List.of(),
        List.of(),
        List.of(new ViewportRequest("desktop", 1440, 900, 1, false)),
        true,
        false,
        false,
        false,
        null,
        List.of());
  }
}
