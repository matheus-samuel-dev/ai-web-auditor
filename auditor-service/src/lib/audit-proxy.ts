import http from "node:http";
import net from "node:net";
import { assertSafeAuditUrl, type SsrfGuardOptions } from "./ssrf-guard.js";

/** Enforces SSRF before transport, including redirects that bypass Playwright routes.
 * Connects to the validated IP, avoiding a second DNS lookup/rebinding window.
 * HTTPS uses CONNECT without terminating TLS or disabling certificate validation.
 */
export async function createAuditProxy(options: SsrfGuardOptions) {
  const sockets = new Set<net.Socket>();
  let closed = false;
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(30_000, () => socket.destroy());
    return socket;
  };
  const server = http.createServer((request, response) => {
    void (async () => {
      const target = await assertSafeAuditUrl(request.url || "", options);
      if (closed) throw new Error("Proxy encerrado.");
      if (target.url.protocol !== "http:") throw new Error("Use CONNECT para HTTPS.");
      const headers: http.OutgoingHttpHeaders = { ...request.headers, host: target.url.host };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = http.request({
        hostname: target.addresses[0].address,
        port: Number(target.url.port || 80),
        path: target.url.pathname + target.url.search,
        method: request.method, headers, agent: false, timeout: 30_000
      }, result => {
        response.writeHead(result.statusCode || 502, result.headers);
        result.pipe(response);
      });
      upstream.on("socket", track);
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () => response.destroy());
      request.on("aborted", () => upstream.destroy());
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
    })().catch(() => response.destroy());
  });
  server.on("connection", track);
  server.on("connect", (request, client, head) => {
    void (async () => {
      const target = await assertSafeAuditUrl(`https://${request.url}`, options);
      if (closed) throw new Error("Proxy encerrado.");
      const upstream = track(net.connect({ host: target.addresses[0].address, port: Number(target.url.port || 443) }));
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    })().catch(() => client.destroy());
  });
  // WebSocket upgrade requests cannot bypass URL validation by switching protocols.
  server.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
}
