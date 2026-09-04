import {
  Archive,
  Check,
  ExternalLink,
  Flag,
  FolderKanban,
  Gauge,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { auditApi, projectApi } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { SectionCard } from "../components/SectionCard";
import { usePageMeta } from "../hooks/usePageMeta";
import pageStyles from "../styles/dashboard.module.css";
import type { AuditListItem, AuditProject } from "../types";
import { formatDate } from "../utils/audit";

type ProjectForm = Pick<AuditProject, "name" | "url" | "environment">;
type ProjectAction = "archive" | "baseline" | "edit";

const emptyProjectForm: ProjectForm = { name: "", url: "", environment: "PRODUCTION" };

export function ProjectsPage() {
  const [projects, setProjects] = useState<AuditProject[]>([]);
  const [audits, setAudits] = useState<AuditListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [form, setForm] = useState<ProjectForm>(emptyProjectForm);
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProjectForm>(emptyProjectForm);
  const [baselineProjectId, setBaselineProjectId] = useState<string | null>(null);
  const [baselineAuditId, setBaselineAuditId] = useState("");
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<{ projectId: string; action: ProjectAction } | null>(null);

  usePageMeta(
    "Projetos monitorados | AI Web Auditor",
    "Organize domínios, ambientes, baselines e configurações de auditoria."
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [projectItems, auditItems] = await Promise.all([projectApi.list(), auditApi.list()]);
      setProjects(projectItems);
      setAudits(auditItems);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível carregar os projetos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const project = await projectApi.create({ ...form, authorizationConfirmed });
      setProjects((items) => [project, ...items]);
      setForm(emptyProjectForm);
      setAuthorizationConfirmed(false);
      setShowForm(false);
      setFeedback(`Projeto ${project.name} criado com sucesso.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível criar o projeto.");
    } finally {
      setSaving(false);
    }
  }

  function startEditing(project: AuditProject) {
    setEditingProjectId(project.id);
    setEditForm({ name: project.name, url: project.url, environment: project.environment });
    setBaselineProjectId(null);
    setPendingArchiveId(null);
    setError("");
    setFeedback("");
  }

  async function updateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProjectId) return;
    setBusyAction({ projectId: editingProjectId, action: "edit" });
    setError("");
    setFeedback("");
    try {
      const updated = await projectApi.update(editingProjectId, editForm);
      setProjects((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setEditingProjectId(null);
      setFeedback(`Projeto ${updated.name} atualizado.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível atualizar o projeto.");
    } finally {
      setBusyAction(null);
    }
  }

  function startBaseline(project: AuditProject) {
    const candidates = completedAuditsForProject(audits, project.id);
    setBaselineProjectId(project.id);
    setBaselineAuditId(
      candidates.some((audit) => audit.id === project.baselineAuditId)
        ? project.baselineAuditId || ""
        : candidates[0]?.id || ""
    );
    setEditingProjectId(null);
    setPendingArchiveId(null);
    setError("");
    setFeedback("");
  }

  async function setBaseline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!baselineProjectId || !baselineAuditId) return;
    setBusyAction({ projectId: baselineProjectId, action: "baseline" });
    setError("");
    setFeedback("");
    try {
      const updated = await projectApi.setBaseline(baselineProjectId, baselineAuditId);
      setProjects((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setBaselineProjectId(null);
      setFeedback(`Baseline de ${updated.name} atualizada.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível definir a baseline.");
    } finally {
      setBusyAction(null);
    }
  }

  async function archiveProject(project: AuditProject) {
    setBusyAction({ projectId: project.id, action: "archive" });
    setError("");
    setFeedback("");
    try {
      const updated = await projectApi.archive(project.id);
      setProjects((items) => items.map((item) => (item.id === project.id ? updated : item)));
      setPendingArchiveId(null);
      setFeedback(`Projeto ${project.name} arquivado.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível arquivar o projeto.");
    } finally {
      setBusyAction(null);
    }
  }

  const activeProjects = projects.filter((project) => !project.archived);
  const baselineProject = projects.find((project) => project.id === baselineProjectId) || null;
  const baselineCandidates = useMemo(
    () => (baselineProjectId ? completedAuditsForProject(audits, baselineProjectId) : []),
    [audits, baselineProjectId]
  );

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.heroRow}>
        <div className={pageStyles.heroCopy}>
          <span className="eyebrow">Portfólio monitorado</span>
          <h2>Um projeto concentra ambiente, baseline e histórico do mesmo produto.</h2>
          <p>
            Comparações deixam de misturar domínios diferentes e cada nova rodada pode reutilizar limites, dispositivos e
            cenários.
          </p>
          <div className={pageStyles.heroActions}>
            <button
              className="primaryButton"
              type="button"
              onClick={() => {
                setShowForm((value) => !value);
                setEditingProjectId(null);
                setBaselineProjectId(null);
              }}
            >
              <Plus size={16} />Novo projeto
            </button>
            <button className="secondaryButton" type="button" onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? "spin" : undefined} />Atualizar
            </button>
          </div>
        </div>
        <article className={pageStyles.heroPanel}>
          <span className={pageStyles.heroPanelLabel}>Projetos ativos</span>
          <strong className={pageStyles.heroPanelValue}>{activeProjects.length}</strong>
          <div className={pageStyles.heroPanelMeta}>
            <span>{activeProjects.filter((project) => project.baselineAuditId).length} com baseline</span>
            <span>{activeProjects.reduce((sum, project) => sum + (project.auditCount || 0), 0)} execuções</span>
          </div>
          <p className={pageStyles.heroPanelUrl}>
            Baselines são escolhidas entre auditorias concluídas do próprio projeto para manter comparações válidas.
          </p>
        </article>
      </div>

      {showForm ? (
        <SectionCard title="Criar projeto" subtitle="credenciais e senhas nunca são armazenadas neste cadastro">
          <form className={pageStyles.stack} onSubmit={createProject}>
            <div className={pageStyles.formGridThree}>
              <ProjectFields form={form} onChange={setForm} />
            </div>
            <label className={pageStyles.consentCard}>
              <input
                type="checkbox"
                checked={authorizationConfirmed}
                onChange={(event) => setAuthorizationConfirmed(event.target.checked)}
                required
              />
              <Check size={19} />
              <span>
                <strong>Confirmo que tenho autorização para auditar este domínio.</strong>
                <small>Esta confirmação é exigida pelo servidor e fica associada à criação do projeto.</small>
              </span>
            </label>
            <div className={pageStyles.heroActions}>
              <button className="primaryButton" disabled={saving || !authorizationConfirmed} type="submit">
                {saving ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Salvar projeto
              </button>
              <button className="secondaryButton" type="button" onClick={() => setShowForm(false)}>
                Cancelar
              </button>
            </div>
          </form>
        </SectionCard>
      ) : null}

      {editingProjectId ? (
        <SectionCard title="Editar projeto" subtitle="nome, URL e ambiente monitorado">
          <form className={pageStyles.stack} onSubmit={updateProject}>
            <div className={pageStyles.formGridThree}>
              <ProjectFields form={editForm} onChange={setEditForm} />
            </div>
            <div className={pageStyles.heroActions}>
              <button className="primaryButton" type="submit" disabled={busyAction?.action === "edit"}>
                {busyAction?.action === "edit" ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                Salvar alterações
              </button>
              <button className="secondaryButton" type="button" onClick={() => setEditingProjectId(null)}>
                Cancelar
              </button>
            </div>
          </form>
        </SectionCard>
      ) : null}

      {baselineProject ? (
        <SectionCard title={`Definir baseline · ${baselineProject.name}`} subtitle="somente auditorias concluídas deste projeto são elegíveis">
          {baselineCandidates.length ? (
            <form className={pageStyles.stack} onSubmit={setBaseline}>
              <label className={pageStyles.field}>
                <span>Auditoria de referência</span>
                <div className={pageStyles.fieldControl}>
                  <select value={baselineAuditId} onChange={(event) => setBaselineAuditId(event.target.value)} required>
                    {baselineCandidates.map((audit) => (
                      <option key={audit.id} value={audit.id}>
                        {formatDate(audit.createdAt)} · score {audit.overallScore ?? "não medido"}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
              <div className={pageStyles.heroActions}>
                <button className="primaryButton" type="submit" disabled={!baselineAuditId || busyAction?.action === "baseline"}>
                  {busyAction?.action === "baseline" ? <LoaderCircle size={16} className="spin" /> : <Flag size={16} />}
                  Definir baseline
                </button>
                <button className="secondaryButton" type="button" onClick={() => setBaselineProjectId(null)}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <EmptyState
              compact
              icon={Flag}
              title="Nenhuma auditoria elegível"
              description="Conclua uma auditoria associada a este projeto antes de escolher a baseline."
              action={<button className="secondaryButton" type="button" onClick={() => setBaselineProjectId(null)}>Fechar</button>}
            />
          )}
        </SectionCard>
      ) : null}

      {error ? <div className="inlineError" role="alert">{error}</div> : null}
      {feedback ? <div className="inlineSuccess" role="status">{feedback}</div> : null}

      <SectionCard title="Projetos" subtitle="domínios autorizados e seus baselines">
        {loading ? <div className="screenCenter"><LoaderCircle className="spin" />Carregando projetos...</div> : null}
        {!loading && activeProjects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="Nenhum projeto monitorado"
            description="Crie um projeto para organizar auditorias por domínio e manter uma baseline confiável."
            action={<button className="secondaryButton" type="button" onClick={() => setShowForm(true)}>Criar primeiro projeto</button>}
          />
        ) : null}
        <div className={pageStyles.projectGrid}>
          {activeProjects.map((project) => {
            const latestCompletedAudit = completedAuditsForProject(audits, project.id)[0];
            const archiving = busyAction?.projectId === project.id && busyAction.action === "archive";
            return (
              <article key={project.id} className={pageStyles.projectCard}>
                <div className={pageStyles.projectHead}>
                  <span className={pageStyles.projectIcon}><FolderKanban size={19} /></span>
                  <div><strong>{project.name}</strong><span>{environmentLabel(project.environment)}</span></div>
                  <button type="button" onClick={() => startEditing(project)} aria-label={`Editar ${project.name}`} title="Editar projeto">
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingArchiveId(project.id)}
                    aria-label={`Arquivar ${project.name}`}
                    title="Arquivar"
                    disabled={archiving}
                  >
                    {archiving ? <LoaderCircle size={16} className="spin" /> : <Archive size={16} />}
                  </button>
                </div>
                <a href={project.url} target="_blank" rel="noreferrer" className={pageStyles.projectUrl}>
                  {project.url}<ExternalLink size={13} />
                </a>
                <div className={pageStyles.projectStats}>
                  <div><span>Último score</span><strong>{project.latestScore ?? latestCompletedAudit?.overallScore ?? "—"}</strong></div>
                  <div><span>Execuções</span><strong>{project.auditCount || 0}</strong></div>
                  <div><span>Baseline</span><strong>{project.baselineAuditId ? "Definida" : "Pendente"}</strong></div>
                </div>
                <div className={pageStyles.projectActions}>
                  <Link className="primaryButton" to={`/audits/new?project=${project.id}`}><Gauge size={15} />Auditar</Link>
                  <Link className="secondaryButton" to={`/audits/history?project=${project.id}`}>Histórico</Link>
                  <button className="secondaryButton" type="button" onClick={() => startBaseline(project)}><Flag size={15} />Baseline</button>
                </div>
                {pendingArchiveId === project.id ? (
                  <div className={pageStyles.projectArchiveConfirm} role="alertdialog" aria-label={`Confirmar arquivamento de ${project.name}`}>
                    <span>Arquivar este projeto? O histórico será preservado.</span>
                    <div>
                      <button className="dangerButton" type="button" onClick={() => archiveProject(project)} disabled={archiving}>
                        {archiving ? <LoaderCircle size={15} className="spin" /> : <Archive size={15} />}Confirmar
                      </button>
                      <button className="secondaryButton" type="button" onClick={() => setPendingArchiveId(null)} disabled={archiving}>
                        <X size={15} />Cancelar
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}

function ProjectFields({ form, onChange }: { form: ProjectForm; onChange: (form: ProjectForm) => void }) {
  return (
    <>
      <label className={pageStyles.field}>
        <span>Nome</span>
        <div className={pageStyles.fieldControl}>
          <input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} required maxLength={120} />
        </div>
      </label>
      <label className={pageStyles.field}>
        <span>URL principal</span>
        <div className={pageStyles.fieldControl}>
          <input type="url" value={form.url} onChange={(event) => onChange({ ...form, url: event.target.value })} required />
        </div>
      </label>
      <label className={pageStyles.field}>
        <span>Ambiente</span>
        <div className={pageStyles.fieldControl}>
          <select value={form.environment} onChange={(event) => onChange({ ...form, environment: event.target.value })}>
            <option value="PRODUCTION">Produção</option>
            <option value="STAGING">Staging</option>
            <option value="DEVELOPMENT">Desenvolvimento</option>
          </select>
        </div>
      </label>
    </>
  );
}

export function completedAuditsForProject(audits: AuditListItem[], projectId: string) {
  return audits
    .filter((audit) => audit.projectId === projectId && audit.status === "COMPLETED")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function environmentLabel(environment: string) {
  const labels: Record<string, string> = {
    PRODUCTION: "Produção",
    STAGING: "Staging",
    DEVELOPMENT: "Desenvolvimento"
  };
  return labels[environment] || environment;
}
