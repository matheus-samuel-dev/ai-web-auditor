import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Crosshair,
  FileCheck2,
  Gauge,
  Globe2,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MonitorSmartphone,
  Route,
  ShieldCheck
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auditApi, projectApi } from "../api/client";
import { SectionCard } from "../components/SectionCard";
import { usePageMeta } from "../hooks/usePageMeta";
import pageStyles from "../styles/dashboard.module.css";
import type { ApiError, AuditMode, AuditProject, AuditViewport, CreateAuditPayload, GuidedScenario, GuidedScenarioAction } from "../types";

const steps = [
  ["Site", Globe2],
  ["Escopo", Crosshair],
  ["Dispositivos", MonitorSmartphone],
  ["Autenticação", KeyRound],
  ["Cenários", Route],
  ["Segurança", ShieldCheck],
  ["Revisão", FileCheck2],
  ["Iniciar", Gauge]
] as const;

export const viewportOptions: Array<{ label: string; detail: string; value: AuditViewport }> = [
  { label: "Desktop", detail: "1440 × 900", value: { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1, mobile: false } },
  { label: "Tablet", detail: "768 × 1024", value: { name: "tablet", width: 768, height: 1024, deviceScaleFactor: 1, mobile: true } },
  { label: "Mobile compacto", detail: "360 × 800", value: { name: "mobile-360", width: 360, height: 800, deviceScaleFactor: 1, mobile: true } },
  { label: "Mobile padrão", detail: "390 × 844", value: { name: "mobile-390", width: 390, height: 844, deviceScaleFactor: 1, mobile: true } },
  { label: "Mobile amplo", detail: "414 × 896", value: { name: "mobile-414", width: 414, height: 896, deviceScaleFactor: 1, mobile: true } }
];

const quickViewports = () => [viewportOptions[0].value, viewportOptions[3].value].map((viewport) => ({ ...viewport }));
const allViewports = () => viewportOptions.map(({ value }) => ({ ...value }));

const modeOptions: Array<{ id: AuditMode; title: string; description: string }> = [
  { id: "QUICK", title: "Rápida", description: "Home, Lighthouse, axe, rede, console, links e duas viewports." },
  { id: "FULL", title: "Completa", description: "Crawl multipágina, interações seguras, formulários e todas as viewports." },
  { id: "AUTHENTICATED", title: "Autenticada", description: "Inclui login temporário e rotas protegidas configuradas." },
  { id: "GUIDED", title: "Guiada", description: "Combina descoberta automática com jornadas informadas por você." }
];

const initialPayload: CreateAuditPayload = {
  url: "",
  projectName: "",
  auditMode: "QUICK",
  maxPages: 3,
  maxDepth: 1,
  timeoutSeconds: 180,
  includePatterns: [],
  excludePatterns: ["/logout", "/delete", "/payment"],
  viewports: quickViewports(),
  authorizationConfirmed: false,
  testEnvironment: false,
  allowDestructiveActions: false,
  aiEnabled: true,
  scenarios: []
};

export function NewAuditPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedProjectId = searchParams.get("project");
  const requestedUrl = searchParams.get("url");
  const requestedMode = parseAuditMode(searchParams.get("mode"));
  const [activeStep, setActiveStep] = useState(0);
  const [payload, setPayload] = useState<CreateAuditPayload>(initialPayload);
  const [projects, setProjects] = useState<AuditProject[]>([]);
  const [includeText, setIncludeText] = useState("");
  const [excludeText, setExcludeText] = useState("/logout\n/delete\n/payment");
  const [scenarioName, setScenarioName] = useState("Fluxo principal");
  const [scenarioText, setScenarioText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  usePageMeta("Configurar auditoria | AI Web Auditor", "Defina escopo, dispositivos, cenários e limites seguros para uma auditoria baseada em evidências.");

  useEffect(() => {
    const controller = new AbortController();
    projectApi
      .list({ signal: controller.signal })
      .then((items) => {
        const activeProjects = items.filter((item) => !item.archived);
        setProjects(activeProjects);

        if (!requestedProjectId) {
          if (requestedUrl) {
            setPayload((current) => ({
              ...current,
              url: requestedUrl,
              auditMode: requestedMode || current.auditMode,
              maxPages: requestedMode === "QUICK" || !requestedMode ? current.maxPages : Math.max(current.maxPages, 8),
              viewports: requestedMode === "QUICK" || !requestedMode ? current.viewports : allViewports()
            }));
          }
          return;
        }
        const requestedProject = activeProjects.find((item) => item.id === requestedProjectId);
        if (!requestedProject) {
          setError("O projeto informado não existe ou está arquivado.");
          return;
        }

        setPayload((current) => ({
          ...current,
          projectId: requestedProject.id,
          projectName: requestedProject.name,
          url: requestedProject.url,
          auditMode: requestedMode || current.auditMode,
          maxPages: requestedMode === "QUICK" || !requestedMode ? current.maxPages : Math.max(current.maxPages, 8),
          viewports: requestedMode === "QUICK" || !requestedMode ? current.viewports : allViewports()
        }));
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "Não foi possível carregar os projetos disponíveis.");
      });
    return () => controller.abort();
  }, [requestedMode, requestedProjectId, requestedUrl]);

  const estimatedMinutes = useMemo(() => estimateAuditMinutes(payload), [payload]);
  const canContinue = validateStep(activeStep, payload, scenarioText);

  function update<K extends keyof CreateAuditPayload>(key: K, value: CreateAuditPayload[K]) {
    setPayload((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function selectMode(mode: AuditMode) {
    setPayload((current) => ({
      ...current,
      auditMode: mode,
      maxPages: mode === "QUICK" ? 3 : Math.max(current.maxPages, 8),
      viewports: mode === "QUICK" ? quickViewports() : allViewports()
    }));
  }

  function addScenario() {
    const scenario = scenarioFromText(scenarioName, scenarioText);
    if (!scenario) {
      setError("Use uma ação válida em cada passo: navegar, clicar, preencher, selecionar, marcar, verificar ou pressionar.");
      return false;
    }
    setPayload((current) => ({ ...current, scenarios: [...current.scenarios, scenario] }));
    setScenarioName(`Fluxo ${payload.scenarios.length + 2}`);
    setScenarioText("");
    setError("");
    return true;
  }

  function nextStep() {
    if (!canContinue) {
      setError(stepError(activeStep));
      return;
    }
    if (activeStep === 4 && scenarioText.trim() && !addScenario()) return;
    setActiveStep((step) => Math.min(7, step + 1));
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeStep < 7) {
      nextStep();
      return;
    }
    if (!payload.authorizationConfirmed) {
      setError("Confirme que você possui autorização para auditar o domínio.");
      return;
    }

    setLoading(true);
    setError("");
    const finalPayload: CreateAuditPayload = {
      ...payload,
      url: normalizeHttpUrlInput(payload.url),
      includePatterns: splitLines(includeText),
      excludePatterns: splitLines(excludeText),
      allowDestructiveActions: payload.testEnvironment && payload.allowDestructiveActions,
      authConfig: payload.authConfig
        ? { ...payload.authConfig, loginUrl: normalizeHttpUrlInput(payload.authConfig.loginUrl) }
        : undefined
    };
    try {
      const audit = await auditApi.create(finalPayload);
      navigate(`/audits/${audit.id}`);
    } catch (submitError) {
      const apiError = submitError as ApiError;
      setError(apiError.fieldErrors?.url || apiError.fieldErrors?.authorizationConfirmed || apiError.message || "Não foi possível iniciar a auditoria.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={pageStyles.page}>
      <section className={pageStyles.wizardHeader} aria-label="Progresso da configuração">
        <div><span className="eyebrow">Definição verificável</span><h2>Configure uma execução que sabe o próprio limite.</h2><p>Cada escolha afeta a cobertura, a duração e as ações que o agente pode executar.</p></div>
        <div className={pageStyles.estimateCard}><Clock3 size={18} /><div><span>Estimativa</span><strong>{estimatedMinutes.min}–{estimatedMinutes.max} min</strong><small>{payload.maxPages} páginas · {payload.viewports.length} viewports</small></div></div>
      </section>

      <ol className={pageStyles.stepper}>
        {steps.map(([label, Icon], index) => (
          <li key={label} className={index === activeStep ? pageStyles.stepActive : index < activeStep ? pageStyles.stepDone : pageStyles.step} aria-current={index === activeStep ? "step" : undefined}>
            <button type="button" onClick={() => index < activeStep && setActiveStep(index)} disabled={index > activeStep} aria-label={`${index + 1}. ${label}`}>
              <span>{index < activeStep ? <Check size={15} /> : <Icon size={15} />}</span><small>{label}</small>
            </button>
          </li>
        ))}
      </ol>

      <form onSubmit={handleSubmit} aria-busy={loading}>
        <SectionCard title={`${activeStep + 1}. ${steps[activeStep][0]}`} subtitle={stepSubtitle(activeStep)}>
          <div className={pageStyles.wizardBody}>
            {activeStep === 0 ? <SiteStep payload={payload} projects={projects} update={update} /> : null}
            {activeStep === 1 ? <ScopeStep payload={payload} update={update} selectMode={selectMode} includeText={includeText} setIncludeText={setIncludeText} excludeText={excludeText} setExcludeText={setExcludeText} /> : null}
            {activeStep === 2 ? <DeviceStep payload={payload} update={update} /> : null}
            {activeStep === 3 ? <AuthStep payload={payload} update={update} /> : null}
            {activeStep === 4 ? <ScenarioStep payload={payload} update={update} scenarioName={scenarioName} setScenarioName={setScenarioName} scenarioText={scenarioText} setScenarioText={setScenarioText} addScenario={addScenario} /> : null}
            {activeStep === 5 ? <SafetyStep payload={payload} update={update} /> : null}
            {activeStep === 6 ? <ReviewStep payload={payload} estimate={`${estimatedMinutes.min}–${estimatedMinutes.max} min`} /> : null}
            {activeStep === 7 ? <StartStep payload={payload} loading={loading} /> : null}
          </div>

          {error ? <div className="inlineError" role="alert">{error}</div> : null}
          <div className={pageStyles.wizardActions}>
            <button className="secondaryButton" type="button" disabled={activeStep === 0 || loading} onClick={() => setActiveStep((step) => Math.max(0, step - 1))}><ArrowLeft size={16} />Voltar</button>
            {activeStep < 7 ? <button className="primaryButton" type="button" onClick={nextStep} disabled={!canContinue}>Continuar<ArrowRight size={16} /></button> : <button className="primaryButton" type="submit" disabled={loading || !payload.authorizationConfirmed}>{loading ? <><LoaderCircle size={16} className="spin" />Enfileirando...</> : <><Gauge size={16} />Iniciar auditoria</>}</button>}
          </div>
        </SectionCard>
      </form>
    </div>
  );
}

type Update = <K extends keyof CreateAuditPayload>(key: K, value: CreateAuditPayload[K]) => void;

function SiteStep({ payload, projects, update }: { payload: CreateAuditPayload; projects: AuditProject[]; update: Update }) {
  return <div className={pageStyles.formGrid}>
    <Field label="URL do site" hint="Você pode omitir o protocolo; HTTPS será usado. Endereços privados são bloqueados por padrão."><input type="text" inputMode="url" value={payload.url} onChange={(e) => update("url", e.target.value)} onBlur={() => payload.url.trim() && update("url", normalizeHttpUrlInput(payload.url))} placeholder="produto.exemplo.com" autoFocus required /></Field>
    <Field label="Projeto" hint="Associe a uma baseline existente ou informe um novo nome."><select value={payload.projectId || ""} onChange={(e) => { const project = projects.find((item) => item.id === e.target.value); update("projectId", e.target.value || undefined); if (project) { update("projectName", project.name); update("url", project.url); } else { update("projectName", ""); } }}><option value="">Novo ou sem projeto</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.environment}</option>)}</select></Field>
    <Field label="Nome do projeto" hint="Usado no dashboard, histórico e exportações."><input value={payload.projectName || ""} onChange={(e) => update("projectName", e.target.value)} placeholder="Portal do cliente" maxLength={120} /></Field>
  </div>;
}

function ScopeStep({ payload, update, selectMode, includeText, setIncludeText, excludeText, setExcludeText }: { payload: CreateAuditPayload; update: Update; selectMode: (mode: AuditMode) => void; includeText: string; setIncludeText: (value: string) => void; excludeText: string; setExcludeText: (value: string) => void }) {
  return <div className={pageStyles.stack}>
    <div className={pageStyles.choiceGrid}>{modeOptions.map((mode) => <button key={mode.id} type="button" className={payload.auditMode === mode.id ? pageStyles.choiceActive : pageStyles.choice} onClick={() => selectMode(mode.id)}><strong>{mode.title}</strong><span>{mode.description}</span></button>)}</div>
    <div className={pageStyles.formGridThree}>
      <Field label="Máximo de páginas"><input type="number" min={1} max={30} value={payload.maxPages} onChange={(e) => update("maxPages", Number(e.target.value))} /></Field>
      <Field label="Profundidade"><input type="number" min={0} max={5} value={payload.maxDepth} onChange={(e) => update("maxDepth", Number(e.target.value))} /></Field>
      <Field label="Timeout global (s)"><input type="number" min={60} max={900} value={payload.timeoutSeconds} onChange={(e) => update("timeoutSeconds", Number(e.target.value))} /></Field>
    </div>
    <div className={pageStyles.formGrid}><Field label="Incluir padrões" hint="Um caminho ou glob por linha. Vazio inclui todo o domínio."><textarea rows={4} value={includeText} onChange={(e) => setIncludeText(e.target.value)} placeholder="/app/**" /></Field><Field label="Excluir padrões" hint="Rotas perigosas ou irrelevantes nunca devem entrar no crawl."><textarea rows={4} value={excludeText} onChange={(e) => setExcludeText(e.target.value)} /></Field></div>
  </div>;
}

function DeviceStep({ payload, update }: { payload: CreateAuditPayload; update: Update }) {
  return <div className={pageStyles.deviceGrid}>{viewportOptions.map((viewport) => { const checked = payload.viewports.some((item) => item.name === viewport.value.name); return <label key={viewport.value.name} className={checked ? pageStyles.deviceActive : pageStyles.device}><input type="checkbox" checked={checked} onChange={() => update("viewports", checked ? payload.viewports.filter((item) => item.name !== viewport.value.name) : [...payload.viewports, { ...viewport.value }])} /><MonitorSmartphone size={18} /><span><strong>{viewport.label}</strong><small>{viewport.detail}</small></span></label>; })}</div>;
}

function AuthStep({ payload, update }: { payload: CreateAuditPayload; update: Update }) {
  const enabled = Boolean(payload.authConfig) || payload.auditMode === "AUTHENTICATED";
  const auth = payload.authConfig || { loginUrl: payload.url, username: "", password: "" };
  return <div className={pageStyles.stack}>
    <label className={pageStyles.switchRow}><input type="checkbox" checked={enabled} onChange={(e) => update("authConfig", e.target.checked ? auth : undefined)} /><span><strong>Testar área autenticada</strong><small>Credenciais ficam somente na memória da execução e são descartadas ao finalizar.</small></span></label>
    {enabled ? <div className={pageStyles.formGrid}>
      <Field label="URL de login"><input type="text" inputMode="url" value={auth.loginUrl} onChange={(e) => update("authConfig", { ...auth, loginUrl: e.target.value })} onBlur={() => auth.loginUrl.trim() && update("authConfig", { ...auth, loginUrl: normalizeHttpUrlInput(auth.loginUrl) })} /></Field>
      <Field label="Usuário"><input value={auth.username} autoComplete="username" onChange={(e) => update("authConfig", { ...auth, username: e.target.value })} /></Field>
      <Field label="Senha temporária" hint="Nunca será exibida no relatório ou revisão."><input type="password" value={auth.password} autoComplete="current-password" onChange={(e) => update("authConfig", { ...auth, password: e.target.value })} /></Field>
      <Field label="Campo de usuário (opcional)"><input value={auth.usernameSelector || ""} onChange={(e) => update("authConfig", { ...auth, usernameSelector: e.target.value })} placeholder="role/name, label ou test id" /></Field>
      <Field label="Campo de senha (opcional)"><input value={auth.passwordSelector || ""} onChange={(e) => update("authConfig", { ...auth, passwordSelector: e.target.value })} /></Field>
      <Field label="Botão de envio (opcional)"><input value={auth.submitSelector || ""} onChange={(e) => update("authConfig", { ...auth, submitSelector: e.target.value })} placeholder="button[type='submit']" /></Field>
      <Field label="URL esperada após o login (opcional)"><input value={auth.expectedUrl || ""} onChange={(e) => update("authConfig", { ...auth, expectedUrl: e.target.value })} placeholder="/dashboard" /></Field>
      <Field label="Elemento esperado após o login (opcional)"><input value={auth.expectedSelector || ""} onChange={(e) => update("authConfig", { ...auth, expectedSelector: e.target.value })} placeholder="[data-testid='dashboard']" /></Field>
    </div> : <div className="inlineInfo">Rotas protegidas serão classificadas como bloqueadas por autenticação, nunca como aprovadas.</div>}
  </div>;
}

function ScenarioStep({ payload, update, scenarioName, setScenarioName, scenarioText, setScenarioText, addScenario }: { payload: CreateAuditPayload; update: Update; scenarioName: string; setScenarioName: (value: string) => void; scenarioText: string; setScenarioText: (value: string) => void; addScenario: () => void }) {
  return <div className={pageStyles.stack}><div className={pageStyles.formGrid}><Field label="Nome do cenário"><input value={scenarioName} onChange={(e) => setScenarioName(e.target.value)} /></Field><Field label="Passos" hint="Um por linha: ação | seletor ou URL | valor opcional. Ações: navegar, clicar, preencher, selecionar, marcar, verificar e pressionar."><textarea rows={7} value={scenarioText} onChange={(e) => setScenarioText(e.target.value)} placeholder={"navegar | https://produto.exemplo.com/login\npreencher | #email | pessoa@exemplo.com\nclicar | button[type='submit']\nverificar | main | Dashboard"} /></Field></div><button type="button" className="secondaryButton" onClick={addScenario} disabled={!scenarioText.trim()}><ListChecks size={16} />Adicionar cenário</button>{payload.scenarios.length ? <div className={pageStyles.scenarioList}>{payload.scenarios.map((scenario, index) => <article key={`${scenario.name}-${index}`}><div><strong>{scenario.name}</strong><span>{scenario.steps.length} passos</span></div><button type="button" onClick={() => update("scenarios", payload.scenarios.filter((_, itemIndex) => itemIndex !== index))}>Remover</button></article>)}</div> : <div className="inlineInfo">Sem cenário guiado, o agente usará apenas descoberta automática e ações classificadas como seguras.</div>}</div>;
}

function SafetyStep({ payload, update }: { payload: CreateAuditPayload; update: Update }) {
  return <div className={pageStyles.stack}>
    <label className={pageStyles.consentCard}><input type="checkbox" checked={payload.authorizationConfirmed} onChange={(e) => update("authorizationConfirmed", e.target.checked)} required /><ShieldCheck size={22} /><span><strong>Declaro que tenho autorização para auditar este domínio.</strong><small>A execução registra esta confirmação e aplica limites de SSRF, domínio, tempo, profundidade e downloads.</small></span></label>
    <label className={pageStyles.switchRow}><input type="checkbox" checked={payload.testEnvironment} onChange={(e) => { update("testEnvironment", e.target.checked); if (!e.target.checked) update("allowDestructiveActions", false); }} /><span><strong>Este é um ambiente de teste controlado</strong><small>Não altera a política padrão; apenas habilita a autorização explícita abaixo.</small></span></label>
    <label className={pageStyles.switchRow}><input type="checkbox" checked={payload.allowDestructiveActions} disabled={!payload.testEnvironment} onChange={(e) => update("allowDestructiveActions", e.target.checked)} /><span><strong>Autorizar ações destrutivas configuradas</strong><small>Continuam restritas ao domínio e aos cenários informados. Pagamentos, transferências e bypass nunca são executados.</small></span></label>
    <label className={pageStyles.switchRow}><input type="checkbox" checked={payload.aiEnabled} onChange={(e) => update("aiEnabled", e.target.checked)} /><span><strong>Análise por IA baseada nas evidências</strong><small>A auditoria determinística continua funcionando quando a IA não está configurada.</small></span></label>
  </div>;
}

function ReviewStep({ payload, estimate }: { payload: CreateAuditPayload; estimate: string }) {
  return <div className={pageStyles.reviewGrid}><Review label="Destino" value={payload.url} /><Review label="Modo" value={modeOptions.find((item) => item.id === payload.auditMode)?.title || payload.auditMode} /><Review label="Escopo" value={`${payload.maxPages} páginas · profundidade ${payload.maxDepth}`} /><Review label="Dispositivos" value={`${payload.viewports.length} viewports`} /><Review label="Autenticação" value={payload.authConfig ? "Configurada · senha ocultada" : "Não configurada"} /><Review label="Cenários" value={`${payload.scenarios.length} guiados`} /><Review label="Política" value={payload.allowDestructiveActions ? "Autorizada em teste" : "Somente ações seguras"} /><Review label="Estimativa" value={estimate} /></div>;
}

function StartStep({ payload, loading }: { payload: CreateAuditPayload; loading: boolean }) {
  return <div className={pageStyles.startPanel}><div className={pageStyles.startIcon}><Gauge size={25} /></div><div><h3>{loading ? "Preparando a fila segura" : "Configuração pronta para execução"}</h3><p>O relatório abrirá imediatamente e mostrará etapa, página atual, ações, erros, tempo e cobertura parcial. Falhas possuem timeout e estado terminal.</p></div><ul><li><Check size={15} />Domínio declarado como autorizado</li><li><Check size={15} />{payload.viewports.length} viewports selecionadas</li><li><Check size={15} />Ações destrutivas {payload.allowDestructiveActions ? "limitadas aos cenários autorizados" : "bloqueadas"}</li><li><Check size={15} />Resultados sem evidência serão marcados como não testados</li></ul></div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className={pageStyles.field}><span>{label}</span><div className={pageStyles.fieldControl}>{children}</div>{hint ? <small>{hint}</small> : null}</label>; }
function Review({ label, value }: { label: string; value: string }) { return <div className={pageStyles.reviewItem}><span>{label}</span><strong>{value || "Não informado"}</strong></div>; }
function splitLines(value: string) { return [...new Set(value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))]; }
export function scenarioFromText(name: string, text: string): GuidedScenario | null {
  const lines = [...new Set(text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
  if (lines.length === 0) return null;

  const steps = lines.map((line) => {
    const [rawAction, rawTarget, value, expected] = line.split("|").map((item) => item.trim());
    const action = normalizeScenarioAction(rawAction);
    if (!action) return null;
    return {
      action,
      ...(rawTarget ? { target: rawTarget } : {}),
      ...(value ? { value } : {}),
      ...(expected ? { expected } : {})
    };
  });

  if (steps.some((step) => step == null)) return null;
  return { name: name.trim() || "Fluxo guiado", steps: steps as GuidedScenario["steps"] };
}

export function normalizeScenarioAction(value: string): GuidedScenarioAction | null {
  const normalized = value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const aliases: Record<string, GuidedScenarioAction> = {
    navigate: "navigate", navegar: "navigate", acessar: "navigate", abrir: "navigate", ir: "navigate",
    click: "click", clicar: "click",
    fill: "fill", preencher: "fill", digitar: "fill",
    select: "select", selecionar: "select", escolher: "select",
    check: "check", marcar: "check",
    assert: "assert", verificar: "assert", validar: "assert",
    press: "press", pressionar: "press", teclar: "press"
  };
  return aliases[normalized] || null;
}
export function estimateAuditMinutes(payload: Pick<CreateAuditPayload, "auditMode" | "maxPages" | "viewports" | "scenarios">) { const base = payload.auditMode === "QUICK" ? 2 : 4; const units = payload.maxPages * Math.max(1, payload.viewports.length) * (payload.auditMode === "QUICK" ? .45 : .8) + payload.scenarios.reduce((sum, scenario) => sum + scenario.steps.length * .35, 0); return { min: Math.max(2, Math.ceil(base + units * .65)), max: Math.max(4, Math.ceil(base + units * 1.25)) }; }
function validateStep(step: number, payload: CreateAuditPayload, scenarioText: string) { if (step === 0) { try { return /^https?:$/.test(new URL(normalizeHttpUrlInput(payload.url)).protocol); } catch { return false; } } if (step === 1) return payload.maxPages > 0 && payload.maxPages <= 30 && payload.maxDepth >= 0 && payload.maxDepth <= 5 && payload.timeoutSeconds >= 15 && payload.timeoutSeconds <= 900; if (step === 2) return payload.viewports.length > 0; if (step === 3 && (payload.auditMode === "AUTHENTICATED" || payload.authConfig)) { try { return Boolean(payload.authConfig?.username && payload.authConfig.password && /^https?:$/.test(new URL(normalizeHttpUrlInput(payload.authConfig.loginUrl)).protocol)); } catch { return false; } } if (step === 4 && payload.auditMode === "GUIDED") return payload.scenarios.length > 0 || scenarioText.trim().length > 0; if (step === 5) return payload.authorizationConfirmed; return true; }

export function normalizeHttpUrlInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function parseAuditMode(value: string | null): AuditMode | null {
  return value === "QUICK" || value === "FULL" || value === "AUTHENTICATED" || value === "GUIDED" ? value : null;
}
function stepError(step: number) { return ["Informe uma URL HTTP(S) válida.", "Revise os limites de páginas, profundidade e tempo.", "Selecione ao menos uma viewport.", "Preencha URL de login, usuário e senha temporária.", "Adicione ao menos um cenário guiado.", "Confirme que possui autorização para auditar o domínio."][step] || "Revise os campos obrigatórios."; }
function stepSubtitle(step: number) { return ["identifique o domínio e o projeto", "escolha profundidade, modo e limites", "a auditoria funcional é repetida por viewport", "credenciais temporárias e expectativas de login", "descreva jornadas importantes sem usar seletores frágeis", "autorize o domínio e limite ações automáticas", "confira o que será e o que não será testado", "acompanhe a execução em tempo real"][step]; }
