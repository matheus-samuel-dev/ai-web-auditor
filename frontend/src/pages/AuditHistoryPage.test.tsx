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
});
