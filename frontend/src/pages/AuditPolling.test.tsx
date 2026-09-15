import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuditReportPage } from "./AuditReportPage";
import { auditReport } from "../test/fixtures";
const mocks = vi.hoisted(() => ({ getById: vi.fn() }));
vi.mock("../api/client", () => ({ auditApi: { getById: mocks.getById }, fetchAsset: vi.fn() }));
vi.mock("../hooks/useAuthorizedAsset", () => ({ useAuthorizedAsset: () => ({ url: null, loading: false, error: null }) }));
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); });
const page = () => render(<MemoryRouter initialEntries={["/audits/audit-1"]}><Routes><Route path="/audits/:auditId" element={<AuditReportPage />} /></Routes></MemoryRouter>);

it.each(["COMPLETED", "FAILED"] as const)("não sobrepõe chamadas e encerra ao %s", async status => {
  let resolve!: (value: ReturnType<typeof auditReport>) => void;
  mocks.getById.mockImplementationOnce(() => new Promise(done => { resolve = done; }))
    .mockResolvedValue(auditReport({ status, failureReason: status === "FAILED" ? "Falha controlada." : null }));
  const view = page();
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(mocks.getById).toHaveBeenCalledTimes(1);
  await act(async () => resolve(auditReport({ status: "RUNNING", currentStage: "AUDITING_DESKTOP", progressPercent: 38 })));
  await act(() => vi.advanceTimersByTimeAsync(2500));
  expect(mocks.getById).toHaveBeenCalledTimes(2);
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(mocks.getById).toHaveBeenCalledTimes(2);
  view.unmount();
});
it("aborta a requisição ao sair e recupera o estado do backend ao reabrir", async () => {
  mocks.getById.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(auditReport());
  const view = page();
  const signal = mocks.getById.mock.calls[0][1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  const reopened = page();
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(mocks.getById).toHaveBeenCalledTimes(2);
  reopened.unmount();
});
