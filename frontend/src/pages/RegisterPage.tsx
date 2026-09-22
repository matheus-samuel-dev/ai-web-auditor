import { ShieldCheck } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";
import authStyles from "../styles/auth.module.css";
import { EMAIL_ERROR, isValidEmail } from "../utils/email";
import { passwordError } from "../utils/password";

export function RegisterPage() {
  const navigate = useNavigate();
  const { register, token } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  usePageMeta(
    "Cadastro | AI Web Auditor",
    "Crie sua conta para executar auditorias, acompanhar progresso em tempo real e exportar relatórios."
  );

  if (token) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!isValidEmail(email)) { setError(EMAIL_ERROR); return; }
    const invalidPassword = passwordError(password, true);
    if (invalidPassword) { setError(invalidPassword); return; }
    if (!name.trim() || name.length < 2 || name.length > 120) { setError("O nome deve ter entre 2 e 120 caracteres."); return; }
    submitting.current = true;
    setLoading(true);
    setError("");

    try {
      await register(name, email, password);
      navigate("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível criar a conta.");
    } finally {
      submitting.current = false;
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
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} required />
          </label>

          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required
              aria-invalid={email.length > 0 && !isValidEmail(email)} aria-describedby="email-feedback" />
          </label>
          {email && !isValidEmail(email) ? <div id="email-feedback" className="inlineError" role="alert">{EMAIL_ERROR}</div> : null}

          <label>
            Senha
            <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} aria-describedby="password-feedback" required />
          </label>
          <p id="password-feedback">Use de 8 a 72 caracteres (até 72 bytes em UTF-8). Não há exigência de caracteres especiais.</p>
          {password && passwordError(password, true) ? <div className="inlineError" role="alert">{passwordError(password, true)}</div> : null}

          {error ? <div className="inlineError" role="alert">{error}</div> : null}

          <button className="primaryButton" disabled={loading || !isValidEmail(email)} type="submit">
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
