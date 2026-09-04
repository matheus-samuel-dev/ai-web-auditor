import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NewAuditPage,
  normalizeHttpUrlInput,
  normalizeScenarioAction,
  scenarioFromText,
  viewportOptions
} from "./NewAuditPage";

const apiMocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  createAudit: vi.fn()
}));

vi.mock("../api/client", () => ({
  projectApi: { list: apiMocks.listProjects },
  auditApi: { create: apiMocks.createAudit }
}));

describe("NewAuditPage", () => {
  beforeEach(() => {
    apiMocks.listProjects.mockResolvedValue([
      {
        id: "project-1",
        name: "Portal principal",
        url: "https://portal.example.com",
        environment: "STAGING",
        archived: false,
        createdAt: "2026-07-15T12:00:00Z"
      }
    ]);
  });

  it("consome ?project=, preenche o projeto e permite avançar no wizard", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/audits/new?project=project-1"]}>
        <NewAuditPage />
      </MemoryRouter>
    );

    const urlInput = await screen.findByLabelText(/^URL do site/);
    await waitFor(() => expect(urlInput).toHaveValue("https://portal.example.com"));
    expect(screen.getByLabelText(/^Projeto/)).toHaveValue("project-1");
    expect(screen.getByLabelText(/^Nome do projeto/)).toHaveValue("Portal principal");

    await user.click(screen.getByRole("button", { name: /Continuar/i }));
    expect(screen.getByRole("heading", { name: "2. Escopo" })).toBeInTheDocument();
  });

  it("informa quando o projeto da URL não está disponível", async () => {
    apiMocks.listProjects.mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={["/audits/new?project=missing"]}>
        <NewAuditPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("não existe ou está arquivado");
  });

  it("normaliza domínio sem protocolo e preserva HTTP explícito", () => {
    expect(normalizeHttpUrlInput(" example.com/test ")).toBe("https://example.com/test");
    expect(normalizeHttpUrlInput("http://fixture:4180")).toBe("http://fixture:4180");
  });

  it("converte ações em português sem quebrar seletores que contêm vírgula", () => {
    const scenario = scenarioFromText(
      "Fluxo principal",
      "navegar | https://example.com\nclicar | button.primary, a.cta\nverificar | main | Conteúdo"
    );

    expect(scenario?.steps).toHaveLength(3);
    expect(scenario?.steps[1]).toMatchObject({ action: "click", target: "button.primary, a.cta" });
    expect(normalizeScenarioAction("Preencher")).toBe("fill");
  });

  it("mantém o contrato estruturado de viewport esperado pelo backend", () => {
    expect(viewportOptions[0].value).toEqual({
      name: "desktop",
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    });
  });
});
