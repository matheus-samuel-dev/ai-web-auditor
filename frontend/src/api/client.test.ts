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
      message: expect.stringContaining("demorou demais")
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
});
