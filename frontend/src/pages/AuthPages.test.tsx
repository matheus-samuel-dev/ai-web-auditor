import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { LoginPage } from "./LoginPage";
import { RegisterPage } from "./RegisterPage";
import { isValidEmail } from "../utils/email";
import { passwordError } from "../utils/password";

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

it.each(["E-mail ou senha inválidos.","Não foi possível conectar ao servidor. Tente novamente em instantes."])("login exibe %s e libera novo envio", async message => {
  api.login.mockRejectedValue(new Error(message));
  render(<MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter>);
  await userEvent.type(screen.getByLabelText("Email"),"usuario@gmail.com");
  await userEvent.type(screen.getByLabelText("Senha"),"12345678");
  await userEvent.click(screen.getByRole("button",{name:"Entrar no painel"}));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.getByRole("button",{name:"Entrar no painel"})).toBeEnabled();
  expect(api.login).toHaveBeenCalledWith("usuario@gmail.com","12345678");
});

it("cadastro válido cria sessão com o token emitido pelo backend", async () => {
  api.register.mockResolvedValue({token:"registered-token",user:{id:"new",name:"Nova conta"}});
  render(<MemoryRouter><AuthProvider><RegisterPage /></AuthProvider></MemoryRouter>);
  await userEvent.type(screen.getByLabelText("Nome"),"Nova conta");
  await userEvent.type(screen.getByLabelText("Email"),"nome.sobrenome@empresa.com.br");
  await userEvent.type(screen.getByLabelText("Senha"),"12345678");
  await userEvent.click(screen.getByRole("button",{name:"Criar e entrar"}));
  await waitFor(()=>expect(localStorage.getItem("test-token")).toBe("registered-token"));
});

it("senha respeita tamanho e limite UTF-8 do BCrypt", () => {
  expect(passwordError("12345678",true)).toBeNull();
  expect(passwordError("1234567",true)).toContain("8 e 72");
  expect(passwordError("é".repeat(37),true)).toContain("72 bytes");
});

it("sessão inválida no armazenamento não impede um novo login", async () => {
  localStorage.setItem("test-token","expired");
  api.me.mockRejectedValue(new Error("expired"));
  api.login.mockResolvedValue({token:"fresh-token",user:{id:"existing",name:"Conta existente"}});
  render(<MemoryRouter><AuthProvider><Session /></AuthProvider></MemoryRouter>);
  await waitFor(()=>expect(localStorage.getItem("test-token")).toBeNull());
  await userEvent.type(screen.getByLabelText("Email"),"usuario@gmail.com");
  await userEvent.type(screen.getByLabelText("Senha"),"12345678");
  await userEvent.click(screen.getByRole("button",{name:"Entrar no painel"}));
  expect(await screen.findByText("Conta existente")).toBeVisible();
  expect(localStorage.getItem("test-token")).toBe("fresh-token");
});
