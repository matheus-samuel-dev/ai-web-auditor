package com.aiwebauditor.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.UUID;

record RegisterRequest(
    @NotBlank(message = "Informe seu nome.")
    @Size(min = 2, max = 120, message = "O nome deve ter entre 2 e 120 caracteres.")
    String name,

    @NotBlank(message = "Informe seu email.")
    @Email(message = "Informe um email válido.")
    @Size(max = 160, message = "O email deve ter no máximo 160 caracteres.")
    String email,

    @NotBlank(message = "Informe uma senha.")
    @Size(min = 8, max = 72, message = "A senha deve ter entre 8 e 72 caracteres.")
    String password
) {}

record LoginRequest(
    @NotBlank(message = "Informe seu email.")
    @Email(message = "Informe um email válido.")
    @Size(max = 160, message = "O email deve ter no máximo 160 caracteres.")
    String email,

    @NotBlank(message = "Informe sua senha.")
    @Size(max = 72, message = "A senha deve ter no máximo 72 caracteres.")
    String password
) {}

record AuthResponse(
    String token,
    CurrentUserResponse user
) {}

record CurrentUserResponse(
    UUID id,
    String name,
    String email,
    OffsetDateTime createdAt
) {}
