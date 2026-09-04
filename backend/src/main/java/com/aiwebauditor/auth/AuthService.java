package com.aiwebauditor.auth;

import com.aiwebauditor.common.ApiException;
import com.aiwebauditor.config.JwtService;
import com.aiwebauditor.model.User;
import com.aiwebauditor.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

  private final UserRepository userRepository;
  private final PasswordEncoder passwordEncoder;
  private final JwtService jwtService;

  public AuthService(
      UserRepository userRepository,
      PasswordEncoder passwordEncoder,
      JwtService jwtService
  ) {
    this.userRepository = userRepository;
    this.passwordEncoder = passwordEncoder;
    this.jwtService = jwtService;
  }

  @Transactional
  public AuthResponse register(RegisterRequest request) {
    validateBcryptLength(request.password());
    String email = request.email().trim().toLowerCase();

    if (userRepository.existsByEmail(email)) {
      throw new ApiException(HttpStatus.CONFLICT, "Já existe uma conta com este email.");
    }

    User user = new User();
    user.setName(request.name().trim());
    user.setEmail(email);
    user.setPassword(passwordEncoder.encode(request.password()));
    userRepository.save(user);

    return authenticate(user);
  }

  @Transactional(readOnly = true)
  public AuthResponse login(LoginRequest request) {
    validateBcryptLength(request.password());
    User user = userRepository.findByEmail(request.email().trim().toLowerCase())
        .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Credenciais inválidas."));

    if (!passwordEncoder.matches(request.password(), user.getPassword())) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "Credenciais inválidas.");
    }

    return authenticate(user);
  }

  @Transactional(readOnly = true)
  public CurrentUserResponse me(String email) {
    User user = userRepository.findByEmail(email)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Usuário não encontrado."));

    return new CurrentUserResponse(user.getId(), user.getName(), user.getEmail(), user.getCreatedAt());
  }

  private AuthResponse authenticate(User user) {
    String token = jwtService.generateToken(user.getEmail());
    return new AuthResponse(token, new CurrentUserResponse(
        user.getId(),
        user.getName(),
        user.getEmail(),
        user.getCreatedAt()));
  }

  private void validateBcryptLength(String password) {
    if (password != null && password.getBytes(StandardCharsets.UTF_8).length > 72) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "A senha deve ter no máximo 72 bytes em UTF-8.");
    }
  }
}
