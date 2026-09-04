const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const port = Number(process.env.PORT || 4180);
const publicRoot = path.resolve(__dirname, "public");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "fixture"}`);
  setCommonHeaders(response);

  if (url.pathname === "/health") {
    return json(response, 200, { status: "ok", service: "aiwa-fixture" });
  }
  if (url.pathname === "/api/error") {
    return json(response, 500, { code: "FIXTURE_FAILURE", message: "Falha controlada para validar captura de rede." });
  }
  if (url.pathname === "/api/search") {
    const query = (url.searchParams.get("q") || "").trim();
    return json(response, 200, { query, results: query ? [{ id: 1, title: `Resultado para ${query}` }] : [] });
  }
  if (url.pathname === "/api/login" && request.method === "POST") {
    const body = await readBody(request);
    const values = request.headers["content-type"]?.includes("application/json")
      ? safeJson(body)
      : Object.fromEntries(new URLSearchParams(body));
    if (values.email === "demo@aiwa.local" && values.password === "Demo123!") {
      response.setHeader("Set-Cookie", "aiwa_fixture_session=demo; Path=/; HttpOnly; SameSite=Lax");
      return json(response, 200, { authenticated: true, redirect: "/dashboard" });
    }
    return json(response, 401, { authenticated: false, message: "Credenciais de demonstração inválidas." });
  }
  if (url.pathname === "/broken") {
    return html(response, 404, "<!doctype html><html lang=\"pt-BR\"><title>404</title><h1>Página não encontrada</h1></html>");
  }
  if (url.pathname === "/slow") {
    const timer = setTimeout(() => json(response, 200, { completed: true }), 15_000);
    request.on("close", () => clearTimeout(timer));
    return;
  }

  const routeFile = url.pathname === "/" ? "index.html" : url.pathname === "/login" ? "login.html" : url.pathname === "/dashboard" ? "dashboard.html" : url.pathname.slice(1);
  return serveFile(routeFile, response);
});

server.listen(port, "0.0.0.0", () => {
  console.info(`[fixture] Site de validação disponível na porta ${port}.`);
});

async function serveFile(relativePath, response) {
  const normalized = path.posix.normalize(`/${relativePath}`).slice(1);
  const absolutePath = path.resolve(publicRoot, normalized);
  if (!absolutePath.startsWith(`${publicRoot}${path.sep}`) && absolutePath !== publicRoot) {
    return json(response, 400, { message: "Caminho inválido." });
  }
  try {
    const body = await fs.readFile(absolutePath);
    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypes[path.extname(absolutePath)] || "application/octet-stream");
    response.end(body);
  } catch {
    return json(response, 404, { message: "Recurso não encontrado." });
  }
}

function setCommonHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Cache-Control", "no-store");
}

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", contentTypes[".json"]);
  response.end(JSON.stringify(payload));
}

function html(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", contentTypes[".html"]);
  response.end(payload);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > 32_768) {
        reject(new Error("Payload excedeu o limite do fixture."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
