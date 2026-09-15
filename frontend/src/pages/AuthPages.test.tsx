import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { isValidEmail } from "../utils/email";

const api = vi.hoisted(() => ({ demo: vi.fn(), register: vi.fn(), login: vi.fn(), me: vi.fn() }));
vi.mock("../api/client", () => ({
  authApi: api,
  getStoredToken: () => localStorage.getItem("test-token"),
  setStoredToken: (token: string | null) => token ? localStorage.setItem("test-token", token) : localStorage.removeItem("test-token")
}));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

it.each(["usuario@", "usuario@dominio", "@dominio.com", "usuario@@dominio.com", "usuario dominio@gmail.com"])("rejeita %s", (email) => {
  expect(isValidEmail(email)).toBe(false);
});
it.each(["usuario@gmail.com", "nome.sobrenome@empresa.com.br", "nome+tag@empresa.com"])("aceita %s", (email) => {
  expect(isValidEmail(email)).toBe(true);
});
it("mostra feedback imediato e bloqueia cadastro inválido", async () => {
  render(<MemoryRouter><AuthProvider><RegisterPage /></AuthProvider></MemoryRouter>);
  await userEvent.type(screen.getByLabelText("Email"), "usuario@dominio");
  expect(screen.getByRole("alert")).toHaveTextContent("domínio completo");
  expect(screen.getByRole("button", { name: "Criar e entrar" })).toBeDisabled();
  expect(api.register).not.toHaveBeenCalled();
});

function Session() {
  const auth = useAuth();
  return auth.user ? <><span>{auth.user.name}</span><button onClick={auth.logout}>Sair</button></> : <LoginPage />;
}
it("demo atualiza sessão, logout limpa token e permite novo login", async () => {
  api.demo.mockResolvedValue({ token: "server-issued-token", user: { id: "demo-id", name: "Usuário demo", email: "demo@example.com" } });
  render(<MemoryRouter><AuthProvider><Session /></AuthProvider></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: "Entrar como usuário demo" }));
  expect(await screen.findByText("Usuário demo")).toBeVisible();
  expect(localStorage.getItem("test-token")).toBe("server-issued-token");
  await userEvent.click(screen.getByRole("button", { name: "Sair" }));
  expect(localStorage.getItem("test-token")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Entrar como usuário demo" }));
  await waitFor(() => expect(api.demo).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Usuário demo")).toBeVisible();
});
it("trata falha do demo sem deixar o botão preso", async () => {
  api.demo.mockRejectedValue(new Error("Acesso demo indisponível."));
  render(<MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>);
  await userEvent.click(screen.getByRole("button", { name: "Entrar como usuário demo" }));
  expect(await screen.findByText("Acesso demo indisponível.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Entrar como usuário demo" })).toBeEnabled();
});
