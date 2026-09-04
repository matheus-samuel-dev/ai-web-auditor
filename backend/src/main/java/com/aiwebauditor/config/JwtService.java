package com.aiwebauditor.config;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Service;

@Service
public class JwtService {

  private final AppProperties properties;

  public JwtService(AppProperties properties) {
    this.properties = properties;
  }

  public String generateToken(String subject) {
    Instant now = Instant.now();

    return Jwts.builder()
        .subject(subject)
        .issuedAt(Date.from(now))
        .expiration(Date.from(now.plus(properties.getJwtExpirationMinutes(), ChronoUnit.MINUTES)))
        .signWith(secretKey())
        .compact();
  }

  public String extractSubject(String token) {
    return parseClaims(token).getSubject();
  }

  public boolean isTokenValid(String token, String subject) {
    Claims claims = parseClaims(token);
    return subject.equals(claims.getSubject()) && claims.getExpiration().after(new Date());
  }

  private Claims parseClaims(String token) {
    return Jwts.parser()
        .verifyWith(secretKey())
        .build()
        .parseSignedClaims(token)
        .getPayload();
  }

  private SecretKey secretKey() {
    return Keys.hmacShaKeyFor(properties.getJwtSecret().getBytes(StandardCharsets.UTF_8));
  }
}

