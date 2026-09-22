package com.aiwebauditor.audit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.aiwebauditor.model.User;
import com.aiwebauditor.repository.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(properties = "app.frontend-url=https://auditor.example.test")
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class AuthCorsIntegrationTest {
  static final String ORIGIN = "https://auditor.example.test";
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper mapper;
  @Autowired UserRepository users;
  @Autowired PasswordEncoder encoder;

  @Test void existingBcryptAccountLogsInWithHttpsOriginWithoutChangingHash() throws Exception {
    User user=new User(); user.setName("Existente"); user.setEmail("existing@example.test");
    String hash=encoder.encode("12345678"); user.setPassword(hash); users.saveAndFlush(user);
    String body=mvc.perform(post("/api/auth/login").header("Origin",ORIGIN)
        .header("Authorization","Bearer ").contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"existing@example.test\",\"password\":\"12345678\"}"))
        .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin",ORIGIN))
        .andReturn().getResponse().getContentAsString();
    String token=mapper.readTree(body).path("token").asText();
    mvc.perform(get("/api/auth/me").header("Authorization","Bearer "+token))
        .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(user.getId().toString()));
    assertThat(users.findById(user.getId()).orElseThrow().getPassword()).isEqualTo(hash);
    mvc.perform(post("/api/auth/login").header("Origin",ORIGIN).contentType(MediaType.APPLICATION_JSON)
        .content("{\"email\":\"existing@example.test\",\"password\":\"wrong-password\"}"))
        .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.message").value("E-mail ou senha inválidos."));
  }

  @Test void registerThenLoginAndDuplicateHaveCorrectStatuses() throws Exception {
    String body="{\"name\":\"Nova conta\",\"email\":\"new@example.test\",\"password\":\"12345678\"}";
    mvc.perform(post("/api/auth/register").header("Origin",ORIGIN).header("Authorization","Bearer stale")
        .contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isCreated());
    mvc.perform(post("/api/auth/login").header("Origin",ORIGIN).contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isOk()).andExpect(jsonPath("$.token").isNotEmpty());
    mvc.perform(post("/api/auth/register").header("Origin",ORIGIN).contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().isConflict()).andExpect(jsonPath("$.message").value("Já existe uma conta com este e-mail."));
    mvc.perform(post("/api/auth/login").header("Origin",ORIGIN).contentType(MediaType.APPLICATION_JSON)
        .content(body.replace("new@example.test","missing@example.test")))
        .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.message").value("E-mail ou senha inválidos."));
  }

  @Test void demoAllowsOnlyConfiguredOriginAndPrivateEndpointsRemainProtected() throws Exception {
    mvc.perform(post("/api/auth/demo").header("Origin",ORIGIN).header("Authorization","Bearer "))
        .andExpect(status().isOk()).andExpect(jsonPath("$.token").isNotEmpty());
    mvc.perform(options("/api/auth/login").header("Origin",ORIGIN).header("Access-Control-Request-Method","POST")
        .header("Access-Control-Request-Headers","content-type")).andExpect(status().isOk());
    mvc.perform(post("/api/auth/demo").header("Origin","https://untrusted.example.test"))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/auth/me")).andExpect(status().isForbidden());
    mvc.perform(get("/api/auth/me").header("Authorization","Bearer invalid-token")).andExpect(status().isForbidden());
  }
}
