import { ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";
import authStyles from "../styles/auth.module.css";

export function RegisterPage() {
  const navigate = useNavigate();
  const { register, token } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  usePageMeta(
    "Cadastro | AI Web Auditor",
    "Crie sua conta para executar auditorias, acompanhar progresso em tempo real e exportar relatórios."
  );

  if (token) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await register(name, email, password);
      navigate("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível criar a conta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={authStyles.authShell}>
      <section className={authStyles.hero}>
        <div className={authStyles.brandPill}>
          <ShieldCheck size={16} />
          Workspace premium
        </div>
        <h1>Crie sua área de auditoria e acompanhe score, risco e progresso.</h1>
        <p>
          Estrutura pensada para squads, consultorias e portfólio técnico de alto nível.
        </p>
      </section>

      <section className={authStyles.formWrap}>
        <form className={authStyles.formCard} onSubmit={handleSubmit}>
          <h2>Criar conta</h2>
          <p>Comece com login JWT e histórico persistido em PostgreSQL.</p>

          <label>
            Nome
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>

          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>

          <label>
            Senha
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
          </label>

          {error ? <div className="inlineError">{error}</div> : null}

          <button className="primaryButton" disabled={loading} type="submit">
            {loading ? "Criando conta..." : "Criar e entrar"}
          </button>

          <span className={authStyles.switchText}>
            Já possui conta? <Link to="/login">Fazer login</Link>
          </span>
        </form>
      </section>
    </div>
  );
}
