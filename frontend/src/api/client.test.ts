import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authApi, projectApi, REQUEST_TIMEOUT_MS } from "./client";

describe("projectApi contracts", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "project-1" })
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("usa PATCH para arquivar", async () => {
    await projectApi.archive("project-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/archive",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("envia a baseline na rota PUT aceita pelo backend", async () => {
    await projectApi.setBaseline("project-1", "audit-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-1/baseline/audit-1",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("preserva a confirmação obrigatória ao criar um projeto", async () => {
    await projectApi.create({
      name: "Portal",
      url: "https://example.com",
      environment: "STAGING",
      authorizationConfirmed: true
    });
    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toMatchObject({ authorizationConfirmed: true });
  });

  it("encerra a requisição inteira quando até o corpo da resposta fica pendente", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise(() => undefined)
    });

    const expectation = expect(authApi.me()).rejects.toMatchObject({
      status: 408,
      message: "A solicitação demorou mais que o esperado."
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await expectation;
  });

  it("propaga cancelamento do chamador sem esperar o timeout global", async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const expectation = expect(authApi.me({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

    controller.abort();

    await expectation;
  });

  it("não envia sessão antiga no login, cadastro ou demo", async () => {
    localStorage.setItem("ai-web-auditor-token", "expired-token");
    await authApi.login("usuario@gmail.com", "12345678");
    await authApi.register("Usuário", "usuario@gmail.com", "12345678");
    await authApi.demo();
    for (const [, options] of fetchMock.mock.calls) expect(options.headers.has("Authorization")).toBe(false);
    await authApi.me();
    expect(fetchMock.mock.calls.at(-1)?.[1].headers.get("Authorization")).toBe("Bearer expired-token");
  });

  it.each([
    [401, {}, "E-mail ou senha inválidos."],
    [409, {}, "Já existe uma conta com este e-mail."],
    [400, { fieldErrors: { password: "A senha deve ter entre 8 e 72 caracteres." } }, "A senha deve ter entre 8 e 72 caracteres."],
    [503, {}, "Não foi possível conectar ao servidor. Tente novamente em instantes."],
    [500, {message:"internal diagnostic"}, "Não foi possível concluir a requisição."]
  ])("trata HTTP %s na autenticação", async (status, payload, message) => {
    fetchMock.mockResolvedValue({ ok:false, status, json:async()=>payload });
    await expect(authApi.register("Usuário","usuario@gmail.com","12345678")).rejects.toMatchObject({status,message});
  });

  it("identifica resposta CORS em texto simples sem mascarar a causa", async () => {
    fetchMock.mockResolvedValue(new Response("Invalid CORS request",{status:403}));
    await expect(authApi.demo()).rejects.toThrow("O servidor recusou a origem deste site");
  });

  it("trata servidor inacessível", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(authApi.login("usuario@gmail.com","12345678")).rejects.toMatchObject({status:0,message:"Não foi possível conectar ao servidor. Tente novamente em instantes."});
  });

  it("resposta atrasada de sessão antiga não apaga um novo login", async () => {
    localStorage.setItem("ai-web-auditor-token","old-token");
    let complete!: (value: Response) => void;
    fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    const pending=expect(authApi.me()).rejects.toMatchObject({status:401});
    localStorage.setItem("ai-web-auditor-token","new-token");
    complete(new Response('{}',{status:401,headers:{'Content-Type':'application/json'}}));
    await pending;
    expect(localStorage.getItem("ai-web-auditor-token")).toBe("new-token");
  });
});
