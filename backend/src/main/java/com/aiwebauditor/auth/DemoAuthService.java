package com.aiwebauditor.auth;

import com.aiwebauditor.common.ApiException;
import com.aiwebauditor.model.User;
import com.aiwebauditor.repository.UserRepository;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Shared portfolio account; credentials never leave the server. */
@Service
public class DemoAuthService implements ApplicationRunner {
  public static final String EMAIL = "demo@demo.ai-web-auditor.example";
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final AuthService auth;
  private final boolean enabled;
  private final String password = UUID.randomUUID().toString();

  public DemoAuthService(UserRepository users, PasswordEncoder encoder, AuthService auth,
      @Value("${app.demo-enabled:false}") boolean enabled) {
    this.users = users;
    this.encoder = encoder;
    this.auth = auth;
    this.enabled = enabled;
  }

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    if (!enabled) return;
    User user = users.findByEmail(EMAIL).orElseGet(() -> {
      User created = new User();
      created.setName("Usuário demo");
      created.setEmail(EMAIL);
      return created;
    });
    user.setPassword(encoder.encode(password));
    users.save(user);
  }

  public AuthResponse login() {
    if (!enabled) throw new ApiException(HttpStatus.NOT_FOUND, "O acesso demo não está habilitado.");
    return auth.login(new LoginRequest(EMAIL, password));
  }
}
