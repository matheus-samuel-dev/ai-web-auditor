import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditItem } from "../test/fixtures";
import { AuditHistoryPage } from "./AuditHistoryPage";

const apiMocks = vi.hoisted(() => ({ listAudits: vi.fn() }));

vi.mock("../api/client", () => ({
  auditApi: { list: apiMocks.listAudits }
}));

describe("AuditHistoryPage", () => {
  beforeEach(() => {
    apiMocks.listAudits.mockResolvedValue([
      auditItem({ id: "audit-p1", url: "https://one.example.com", projectId: "project-1", projectName: "Projeto um" }),
      auditItem({ id: "audit-p2", url: "https://two.example.com", projectId: "project-2", projectName: "Projeto dois" })
    ]);
  });

  it("filtra pelo projeto informado na URL e permite limpar o contexto", async () => {
    render(
      <MemoryRouter initialEntries={["/audits/history?project=project-1"]}>
        <AuditHistoryPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("https://one.example.com")).toBeInTheDocument();
    expect(screen.queryByText("https://two.example.com")).not.toBeInTheDocument();
    expect(screen.getByText("Projeto um")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    expect(await screen.findByText("https://two.example.com")).toBeInTheDocument();
  });

  it("não apresenta progresso como score quando Lighthouse não mediu", async () => {
    apiMocks.listAudits.mockResolvedValue([auditItem({ status: "COMPLETED", overallScore: null, progressPercent: 100 })]);
    render(<MemoryRouter><AuditHistoryPage /></MemoryRouter>);
    expect(await screen.findByText("Não medido")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("mantém scores de um a três dígitos e estados sem score na mesma composição", async () => {
    apiMocks.listAudits.mockResolvedValue([
      auditItem({ id: "score-9", url: "https://score-9.example.com", status: "COMPLETED", overallScore: 9 }),
      auditItem({ id: "score-90", url: "https://score-90.example.com", status: "RUNNING", overallScore: 90 }),
      auditItem({ id: "score-100", url: "https://score-100.example.com", status: "FAILED", overallScore: 100 }),
      auditItem({ id: "score-empty", url: "https://score-empty.example.com", status: "FAILED", overallScore: null })
    ]);

    render(<MemoryRouter><AuditHistoryPage /></MemoryRouter>);

    expect(await screen.findByText("9/100")).toBeInTheDocument();
    expect(screen.getByText("90/100")).toBeInTheDocument();
    expect(screen.getByText("100/100")).toBeInTheDocument();
    expect(screen.getByText("Não medido")).toBeInTheDocument();
    expect(screen.getByText("Processando", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.getAllByText("Falhou", { selector: ".badge" })).toHaveLength(2);
  });
});
