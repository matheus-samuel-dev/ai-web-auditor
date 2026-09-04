package com.aiwebauditor.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Authenticates auditor callbacks without making the internal API public. */
@Component
public class InternalCallbackAuthenticationFilter extends OncePerRequestFilter {

  private static final String CALLBACK_HEADER = "X-Audit-Callback-Token";
  private final AppProperties properties;

  public InternalCallbackAuthenticationFilter(AppProperties properties) {
    this.properties = properties;
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return !request.getRequestURI().startsWith("/api/internal/");
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request,
      HttpServletResponse response,
      FilterChain filterChain
  ) throws ServletException, IOException {
    String supplied = request.getHeader(CALLBACK_HEADER);
    if (constantTimeEquals(properties.getAuditorCallbackToken(), supplied)) {
      UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
          "auditor-service",
          null,
          List.of(new SimpleGrantedAuthority("ROLE_AUDITOR")));
      SecurityContextHolder.getContext().setAuthentication(authentication);
    }
    filterChain.doFilter(request, response);
  }

  private boolean constantTimeEquals(String expected, String supplied) {
    if (expected == null || supplied == null) {
      return false;
    }
    return MessageDigest.isEqual(
        expected.getBytes(StandardCharsets.UTF_8),
        supplied.getBytes(StandardCharsets.UTF_8));
  }
}
