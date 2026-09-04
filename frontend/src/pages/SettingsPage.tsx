import { Bell, Bot, Database, KeyRound, Languages, LockKeyhole, Moon, Save, Settings2, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { SectionCard } from "../components/SectionCard";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";
import pageStyles from "../styles/dashboard.module.css";

type Tab = "ACCOUNT" | "SECURITY" | "PREFERENCES" | "AUDIT" | "AI" | "RETENTION" | "APPEARANCE" | "NOTIFICATIONS";
const tabs: Array<[Tab, string, LucideIcon]> = [
  ["ACCOUNT", "Conta", UserRound], ["SECURITY", "Segurança", LockKeyhole], ["PREFERENCES", "Preferências", Languages],
  ["AUDIT", "Auditoria", Settings2], ["AI", "IA", Bot], ["RETENTION", "Retenção", Database],
  ["APPEARANCE", "Aparência", Moon], ["NOTIFICATIONS", "Notificações", Bell]
];

export function SettingsPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("ACCOUNT");
  const initial = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("aiwa-preferences") || "{}"); } catch { return {}; }
  }, []);
  const [preferences, setPreferences] = useState({ language: "pt-BR", theme: "dark", maxPages: 8, timeoutSeconds: 300, retentionDays: 30, defaultDevices: ["DESKTOP_1440", "MOBILE_390"], aiProvider: "OPENAI", aiModel: "gpt-4.1-mini", aiKey: "", emailNotifications: false, failureNotifications: true, ...initial });
  const [feedback, setFeedback] = useState("");

  usePageMeta("Configurações | AI Web Auditor", "Preferências de conta, auditoria, IA, retenção, aparência e notificações.");
  function update(key: string, value: unknown) { setPreferences((current: typeof preferences) => ({ ...current, [key]: value })); setFeedback(""); }
  function save() { const safe = { ...preferences, aiKey: "" }; localStorage.setItem("aiwa-preferences", JSON.stringify(safe)); setFeedback("Preferências locais salvas. Segredos dependem da configuração segura do servidor."); }

  return <div className={pageStyles.page}>
    <div className={pageStyles.settingsLayout}>
      <nav className={pageStyles.settingsNav} aria-label="Seções de configurações">{tabs.map(([id, label, Icon]) => <button type="button" key={id} className={tab === id ? pageStyles.settingsTabActive : pageStyles.settingsTab} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}</nav>
      <SectionCard title={tabs.find(([id]) => id === tab)?.[1] || "Configurações"} subtitle="preferências visíveis e limites operacionais">
        {tab === "ACCOUNT" ? <div className={pageStyles.stack}><div className={pageStyles.settingsList}><div><strong>Nome</strong><span>{user?.name}</span></div><div><strong>E-mail</strong><span>{user?.email}</span></div><div><strong>Membro desde</strong><span>{user?.createdAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(user.createdAt)) : "—"}</span></div></div><div className="inlineInfo">Alteração de perfil e e-mail requer confirmação no servidor e não é simulada nesta interface.</div></div> : null}
        {tab === "SECURITY" ? <div className={pageStyles.stack}><div className={pageStyles.featureList}><div><ShieldCheck size={18} />JWT protege a sessão e todos os artefatos exigem propriedade da auditoria.</div><div><KeyRound size={18} />Credenciais de sites auditados são temporárias e nunca aparecem em relatórios.</div><div><LockKeyhole size={18} />CAPTCHA, MFA e proteções de acesso são respeitados; nenhum bypass é tentado.</div></div><button className="secondaryButton" onClick={logout} type="button">Encerrar esta sessão</button></div> : null}
        {tab === "PREFERENCES" ? <div className={pageStyles.formGrid}><Setting label="Idioma"><select value={preferences.language} onChange={(event) => update("language", event.target.value)}><option value="pt-BR">Português (Brasil)</option><option value="en-US">English</option></select></Setting><Setting label="Formato de data"><input value="Local do navegador" disabled /></Setting></div> : null}
        {tab === "AUDIT" ? <div className={pageStyles.formGrid}><Setting label="Limite padrão de páginas"><input type="number" min={1} max={25} value={preferences.maxPages} onChange={(event) => update("maxPages", Number(event.target.value))} /></Setting><Setting label="Timeout global padrão (s)"><input type="number" min={60} max={900} value={preferences.timeoutSeconds} onChange={(event) => update("timeoutSeconds", Number(event.target.value))} /></Setting><div className="inlineInfo">Cada wizard pode sobrescrever estes padrões. Limites maiores aumentam custo e duração.</div></div> : null}
        {tab === "AI" ? <div className={pageStyles.formGrid}><Setting label="Provider"><select value={preferences.aiProvider} onChange={(event) => update("aiProvider", event.target.value)}><option>OPENAI</option><option disabled>Outro provider (não configurado)</option></select></Setting><Setting label="Modelo"><input value={preferences.aiModel} onChange={(event) => update("aiModel", event.target.value)} /></Setting><Setting label="Chave de API" hint="A chave completa nunca é recuperada nem salva pelo navegador."><input type="password" value={preferences.aiKey} onChange={(event) => update("aiKey", event.target.value)} placeholder="••••••••••••••••" autoComplete="off" /></Setting><div className="inlineInfo">A análise determinística não depende de IA. O servidor mostra “IA indisponível” quando não houver chave.</div></div> : null}
        {tab === "RETENTION" ? <div className={pageStyles.formGrid}><Setting label="Retenção de artefatos (dias)"><input type="number" min={1} max={365} value={preferences.retentionDays} onChange={(event) => update("retentionDays", Number(event.target.value))} /></Setting><div className="inlineInfo">A exclusão efetiva é aplicada pelo worker de retenção do servidor; este valor local é apenas um padrão de criação.</div></div> : null}
        {tab === "APPEARANCE" ? <div className={pageStyles.formGrid}><Setting label="Tema"><select value={preferences.theme} onChange={(event) => update("theme", event.target.value)}><option value="dark">Escuro profissional</option><option disabled value="light">Claro (em desenvolvimento)</option></select></Setting><div className="inlineInfo">Contraste, foco visível e redução de movimento seguem as preferências do sistema.</div></div> : null}
        {tab === "NOTIFICATIONS" ? <div className={pageStyles.stack}><Toggle label="Falhas de auditoria" checked={preferences.failureNotifications} onChange={(value) => update("failureNotifications", value)} /><Toggle label="Resumo por e-mail" checked={preferences.emailNotifications} onChange={(value) => update("emailNotifications", value)} /><div className="inlineInfo">Notificações externas dependem de um provider configurado no backend; a interface não afirma que mensagens foram enviadas.</div></div> : null}
        {feedback ? <div className="inlineSuccess" role="status">{feedback}</div> : null}
        {tab !== "ACCOUNT" && tab !== "SECURITY" ? <div className={pageStyles.settingsFooter}><button className="primaryButton" type="button" onClick={save}><Save size={16} />Salvar preferências locais</button></div> : null}
      </SectionCard>
    </div>
  </div>;
}

function Setting({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className={pageStyles.field}><span>{label}</span><div className={pageStyles.fieldControl}>{children}</div>{hint ? <small>{hint}</small> : null}</label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className={pageStyles.switchRow}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong><small>{checked ? "Ativado" : "Desativado"}</small></span></label>; }
