import { ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";
import authStyles from "../styles/auth.module.css";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, token } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  usePageMeta(
    "Login | AI Web Auditor",
    "Acesse a plataforma de auditoria com análise técnica, IA executiva e relatórios profissionais."
  );

  if (token) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await login(email, password);
      const requestedDestination = typeof location.state?.from === "string" ? location.state.from : "/";
      navigate(requestedDestination.startsWith("/") && !requestedDestination.startsWith("//") ? requestedDestination : "/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={authStyles.authShell}>
      <section className={authStyles.hero}>
        <div className={authStyles.brandPill}>
          <ShieldCheck size={16} />
          AI Web Auditor
        </div>
        <h1>Auditoria técnica com visão executiva e entrega premium.</h1>
        <p>
          Performance, acessibilidade, SEO, heurísticas visuais, IA generativa e PDF profissional em um fluxo único.
        </p>
        <div className={authStyles.heroStats}>
          <div>
            <strong>Playwright</strong>
            <span>captura real de experiência</span>
          </div>
          <div>
            <strong>Lighthouse + axe-core</strong>
            <span>métricas e acessibilidade confiáveis</span>
          </div>
          <div>
            <strong>PDF premium</strong>
            <span>entrega pronta para cliente ou squad</span>
          </div>
        </div>
      </section>

      <section className={authStyles.formWrap}>
        <form className={authStyles.formCard} onSubmit={handleSubmit}>
          <h2>Entrar</h2>
          <p>Use sua conta para iniciar novas auditorias e revisar histórico.</p>

          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>

          <label>
            Senha
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>

          {error ? <div className="inlineError">{error}</div> : null}

          <button className="primaryButton" disabled={loading} type="submit">
            {loading ? "Autenticando..." : "Entrar no painel"}
          </button>

          <span className={authStyles.switchText}>
            Ainda não tem conta? <Link to="/register">Criar conta</Link>
          </span>
        </form>
      </section>
    </div>
  );
}
