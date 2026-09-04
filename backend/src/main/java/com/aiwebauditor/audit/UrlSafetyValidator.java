package com.aiwebauditor.audit;

import com.aiwebauditor.common.ApiException;
import com.aiwebauditor.config.AppProperties;
import java.net.IDN;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

/** Validates the initial navigation target before it reaches the browser worker. */
@Component
public class UrlSafetyValidator {

  private static final Pattern EXPLICIT_SCHEME = Pattern.compile("^[A-Za-z][A-Za-z0-9+.-]*://.*$");

  private static final Set<String> METADATA_HOSTS = Set.of(
      "metadata.google.internal",
      "metadata.azure.internal",
      "metadata.aws.internal",
      "instance-data",
      "metadata");

  private final AppProperties properties;

  public UrlSafetyValidator(AppProperties properties) {
    this.properties = properties;
  }

  public String validateAndNormalize(String rawUrl) {
    if (!StringUtils.hasText(rawUrl)) {
      throw invalid("Informe uma URL válida para a auditoria.");
    }

    final URI uri;
    try {
      uri = new URI(withDefaultScheme(rawUrl)).normalize();
    } catch (URISyntaxException | IllegalArgumentException exception) {
      throw invalid("A URL informada é inválida.");
    }

    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if (!scheme.equals("http") && !scheme.equals("https")) {
      throw invalid("Somente URLs http:// e https:// podem ser auditadas.");
    }
    if (uri.getRawUserInfo() != null) {
      throw invalid("A URL não pode conter usuário ou senha.");
    }
    if (!StringUtils.hasText(uri.getHost())) {
      throw invalid("A URL deve possuir um host válido.");
    }
    if (uri.getPort() < -1 || uri.getPort() > 65_535) {
      throw invalid("A porta informada na URL é inválida.");
    }

    String host;
    try {
      host = IDN.toASCII(uri.getHost(), IDN.USE_STD3_ASCII_RULES)
          .toLowerCase(Locale.ROOT)
          .replaceFirst("\\.$", "");
    } catch (IllegalArgumentException exception) {
      throw invalid("O domínio informado é inválido.");
    }

    boolean localhost = host.equals("localhost") || host.endsWith(".localhost");
    if (METADATA_HOSTS.contains(host) || host.endsWith(".internal") && host.contains("metadata")) {
      throw invalid("Endpoints de metadata não podem ser auditados.");
    }

    InetAddress[] addresses;
    try {
      addresses = InetAddress.getAllByName(host);
    } catch (UnknownHostException exception) {
      throw invalid("Não foi possível resolver o domínio informado.");
    }
    if (addresses.length == 0) {
      throw invalid("O domínio informado não possui endereço resolvível.");
    }

    boolean allowLoopback = properties.isDevelopmentMode() && properties.isAllowLocalhostAudits();
    boolean allowPrivateHost = isExplicitlyAllowedPrivateHost(host);
    for (InetAddress address : addresses) {
      if (isLoopback(address) && allowLoopback && (localhost || address.isLoopbackAddress())) {
        continue;
      }
      if (allowPrivateHost && isPrivateAddress(address)) {
        continue;
      }
      if (isBlocked(address)) {
        throw invalid("A URL resolve para uma rede privada, local ou reservada e foi bloqueada.");
      }
    }

    try {
      return new URI(
          scheme,
          null,
          host,
          normalizedPort(scheme, uri.getPort()),
          normalizedPath(uri.getRawPath()),
          uri.getRawQuery(),
          null).toASCIIString();
    } catch (URISyntaxException exception) {
      throw invalid("A URL informada é inválida.");
    }
  }

  /** Compares already accepted targets without performing another DNS lookup. */
  public boolean isSameTarget(String first, String second) {
    if (!StringUtils.hasText(first) || !StringUtils.hasText(second)) return false;
    try {
      return comparableUri(first).equals(comparableUri(second));
    } catch (URISyntaxException | IllegalArgumentException exception) {
      return false;
    }
  }

  String safeForLog(String rawUrl) {
    try {
      URI uri = new URI(rawUrl);
      return new URI(uri.getScheme(), null, uri.getHost(), uri.getPort(), uri.getPath(), null, null).toString();
    } catch (Exception exception) {
      return "<url-invalid>";
    }
  }

  private URI comparableUri(String rawUrl) throws URISyntaxException {
    URI uri = new URI(withDefaultScheme(rawUrl)).normalize();
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if (!scheme.equals("http") && !scheme.equals("https")
        || uri.getRawUserInfo() != null || !StringUtils.hasText(uri.getHost())) {
      throw new URISyntaxException(rawUrl, "URL de comparação inválida");
    }
    String host = IDN.toASCII(uri.getHost(), IDN.USE_STD3_ASCII_RULES)
        .toLowerCase(Locale.ROOT)
        .replaceFirst("\\.$", "");
    return new URI(
        scheme,
        null,
        host,
        normalizedPort(scheme, uri.getPort()),
        normalizedPath(uri.getRawPath()),
        uri.getRawQuery(),
        null);
  }

  private String withDefaultScheme(String rawUrl) {
    String value = rawUrl.trim();
    if (value.startsWith("//")) return "https:" + value;
    return EXPLICIT_SCHEME.matcher(value).matches() ? value : "https://" + value;
  }

  private int normalizedPort(String scheme, int port) {
    return scheme.equals("http") && port == 80 || scheme.equals("https") && port == 443 ? -1 : port;
  }

  private String normalizedPath(String rawPath) {
    return rawPath == null || rawPath.isEmpty() || rawPath.equals("/") ? null : rawPath;
  }

  private boolean isLoopback(InetAddress address) {
    return address.isLoopbackAddress() || isIpv4(address, 127, -1, -1, -1);
  }

  private boolean isExplicitlyAllowedPrivateHost(String host) {
    return properties.getAuditPrivateHostAllowlist().stream()
        .filter(StringUtils::hasText)
        .map(String::trim)
        .map(value -> value.toLowerCase(Locale.ROOT).replaceFirst("\\.$", ""))
        .anyMatch(host::equals);
  }

  private boolean isPrivateAddress(InetAddress address) {
    byte[] bytes = address.getAddress();
    if (address instanceof Inet4Address || bytes.length == 4) {
      int first = bytes[0] & 0xff;
      int second = bytes[1] & 0xff;
      return first == 10
          || first == 172 && second >= 16 && second <= 31
          || first == 192 && second == 168;
    }
    if (address instanceof Inet6Address && bytes.length == 16) {
      if (isIpv4Mapped(bytes)) {
        return isPrivateAddress(bytes[12], bytes[13]);
      }
      return ((bytes[0] & 0xfe) == 0xfc); // unique-local fc00::/7
    }
    return false;
  }

  private boolean isPrivateAddress(byte firstByte, byte secondByte) {
    int first = firstByte & 0xff;
    int second = secondByte & 0xff;
    return first == 10
        || first == 172 && second >= 16 && second <= 31
        || first == 192 && second == 168;
  }

  private boolean isBlocked(InetAddress address) {
    if (address.isAnyLocalAddress()
        || address.isLoopbackAddress()
        || address.isLinkLocalAddress()
        || address.isSiteLocalAddress()
        || address.isMulticastAddress()) {
      return true;
    }

    byte[] bytes = address.getAddress();
    if (address instanceof Inet4Address || bytes.length == 4) {
      return isBlockedIpv4(bytes);
    }
    if (address instanceof Inet6Address && bytes.length == 16) {
      if (isIpv4Mapped(bytes)) {
        return isBlockedIpv4(new byte[]{bytes[12], bytes[13], bytes[14], bytes[15]});
      }
      int first = bytes[0] & 0xff;
      int second = bytes[1] & 0xff;
      return (first & 0xfe) == 0xfc                 // unique-local fc00::/7
          || first == 0xfe && (second & 0xc0) == 0x80 // link-local fe80::/10
          || first == 0xff                           // multicast
          || isPrefix(bytes, new int[]{0x20, 0x01, 0x0d, 0xb8}, 4) // documentation
          || isPrefix(bytes, new int[]{0x01, 0x00, 0, 0, 0, 0, 0, 0}, 8); // discard-only
    }
    return true;
  }

  private boolean isBlockedIpv4(byte[] bytes) {
    int a = bytes[0] & 0xff;
    int b = bytes[1] & 0xff;
    int c = bytes[2] & 0xff;
    return a == 0
        || a == 10
        || a == 100 && b >= 64 && b <= 127
        || a == 127
        || a == 169 && b == 254
        || a == 172 && b >= 16 && b <= 31
        || a == 192 && b == 0 && (c == 0 || c == 2)
        || a == 192 && b == 168
        || a == 198 && (b == 18 || b == 19 || b == 51 && c == 100)
        || a == 203 && b == 0 && c == 113
        || a >= 224;
  }

  private boolean isIpv4Mapped(byte[] value) {
    for (int index = 0; index < 10; index++) {
      if (value[index] != 0) {
        return false;
      }
    }
    return (value[10] & 0xff) == 0xff && (value[11] & 0xff) == 0xff;
  }

  private boolean isPrefix(byte[] value, int[] prefix, int length) {
    for (int index = 0; index < length; index++) {
      if ((value[index] & 0xff) != prefix[index]) {
        return false;
      }
    }
    return true;
  }

  private boolean isIpv4(InetAddress address, int a, int b, int c, int d) {
    byte[] value = address.getAddress();
    return value.length == 4
        && (value[0] & 0xff) == a
        && (b < 0 || (value[1] & 0xff) == b)
        && (c < 0 || (value[2] & 0xff) == c)
        && (d < 0 || (value[3] & 0xff) == d);
  }

  private ApiException invalid(String message) {
    return new ApiException(HttpStatus.BAD_REQUEST, message);
  }
}
