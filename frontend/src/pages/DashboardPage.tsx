import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  Gauge,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  XCircle
} from "lucide-react";
import { startTransition, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { auditApi } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { SectionCard } from "../components/SectionCard";
import { StatusBadge } from "../components/StatusBadge";
import { StatCard } from "../components/StatCard";
import { usePageMeta } from "../hooks/usePageMeta";
import pageStyles from "../styles/dashboard.module.css";
import type { AuditListItem, DashboardSummary } from "../types";
import { formatDate, translateStage, translateStatus } from "../utils/audit";

export function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  usePageMeta(
    "Dashboard | AI Web Auditor",
    "Painel executivo com tendência de score, distribuição de issues e histórico operacional das auditorias."
  );

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");

    auditApi
      .dashboard({ signal: controller.signal })
      .then((payload) => startTransition(() => setData(payload)))
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        setError(requestError instanceof Error ? requestError.message : "Falha ao carregar o dashboard.");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [refreshTick]);

  const scoreSeries = useMemo(() => toScoreSeries(data?.scoreTimeline || []), [data]);

  const categorySeries = useMemo(
    () =>
      (data?.categoryAverages || []).map((item) => ({
        ...item,
        label: humanizeLabel(item.category)
      })),
    [data]
  );

  const statusSeries = useMemo(
    () =>
      Object.entries(data?.statusBreakdown || {}).map(([status, value]) => ({
        status,
        name: translateStatus(status),
        value
      })),
    [data]
  );

  const issueSeries = useMemo(
    () =>
      (data?.issueTypeBreakdown || []).map((item) => ({
        name: humanizeLabel(item.type),
        total: item.total
      })),
    [data]
  );

  const latestAudit = data?.latestAudit || data?.recentAudits[0] || null;
  const topIssue = data?.issueTypeBreakdown?.[0] || null;
  const completionRate = data?.totalAudits ? Math.round((data.completedAudits / data.totalAudits) * 100) : 0;

  if (loading) {
    return <PageSkeleton message="Carregando métricas executivas..." />;
  }

  if (error) {
    return (
      <div className={pageStyles.page}>
        <SectionCard title="Dashboard indisponível" subtitle="não foi possível consolidar os dados executivos agora">
          <EmptyState
            icon={AlertTriangle}
            title="Falha ao carregar o dashboard"
            description={error}
            action={
              <button className="secondaryButton" onClick={() => setRefreshTick((value) => value + 1)} type="button">
                Tentar novamente
              </button>
            }
          />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.heroRow}>
        <div className={pageStyles.heroCopy}>
          <span className="eyebrow">Inteligência de auditoria SaaS</span>
          <h2>Visão executiva do produto, risco operacional e evolução técnica.</h2>
          <p>
            O dashboard combina tendência de score, distribuição de issues, capacidade operacional e retomada rápida das
            execuções mais recentes em uma visão única.
          </p>
          <div className={pageStyles.heroActions}>
            <Link to="/audits/new" className="primaryButton">
              Iniciar nova auditoria
            </Link>
            <Link to="/audits/history" className="secondaryButton">
              Abrir histórico
            </Link>
          </div>
        </div>

        <article className={pageStyles.heroPanel} aria-label="Resumo da última auditoria">
          <span className={pageStyles.heroPanelLabel}>{latestAudit ? "Última auditoria" : "Primeiro passo"}</span>
          <strong className={pageStyles.heroPanelValue}>
            {latestAudit ? (latestAudit.overallScore != null ? `${latestAudit.overallScore}/100` : `${latestAudit.progressPercent}%`) : "Sem baseline"}
          </strong>
          <div className={pageStyles.heroPanelMeta}>
            {latestAudit ? <StatusBadge status={latestAudit.status} /> : <span className="badge badgePENDING">Em fila</span>}
            <span>{latestAudit ? formatDate(latestAudit.createdAt) : "Execute sua primeira análise"}</span>
          </div>
          <p className={pageStyles.heroPanelUrl}>
            {latestAudit
              ? latestAudit.url
              : "As primeiras métricas do painel aparecerão assim que você concluir a primeira auditoria."}
          </p>
          <Link className="secondaryButton" to={latestAudit ? `/audits/${latestAudit.id}` : "/audits/new"}>
            {latestAudit ? "Abrir relatório" : "Criar baseline"}
          </Link>
        </article>
      </div>

      <div className={pageStyles.summaryGrid}>
        <article className={pageStyles.summaryCard}>
          <span>Cadência operacional</span>
          <strong>{completionRate}% concluídas</strong>
          <p>{data?.runningAudits ? `${data.runningAudits} auditorias seguem em execução.` : "Nenhuma execução em fila agora."}</p>
        </article>
        <article className={pageStyles.summaryCard}>
          <span>Principal risco atual</span>
          <strong>{topIssue ? humanizeLabel(topIssue.type) : "Sem padrão dominante"}</strong>
          <p>
            {topIssue
              ? `${topIssue.total} ocorrências concentram a maior parte dos achados.`
              : "Ainda não há volume suficiente para detectar tendência."}
          </p>
        </article>
        <article className={pageStyles.summaryCard}>
          <span>Janela de decisão</span>
          <strong>{Math.round(data?.averageScore || 0) >= 80 ? "Pronto para apresentar" : "Exige nova rodada"}</strong>
          <p>
            {Math.round(data?.averageScore || 0) >= 80
              ? "A média atual sustenta uma apresentação comercial com espaço para refinamento técnico."
              : "Vale priorizar quick wins antes de tratar a base como benchmark de produto."}
          </p>
        </article>
      </div>

      <div className={pageStyles.statsGrid}>
        <StatCard title="Total de auditorias" value={String(data?.totalAudits || 0)} subtitle="histórico completo" icon={Gauge} />
        <StatCard title="Pontuação média" value={`${Math.round(data?.averageScore || 0)}/100`} subtitle="qualidade geral" icon={TrendingUp} />
        <StatCard title="Em andamento" value={String(data?.runningAudits || 0)} subtitle="fila operacional" icon={PlayCircle} />
        <StatCard title="Concluídas" value={String(data?.completedAudits || 0)} subtitle="análises finalizadas" icon={CheckCircle2} />
        <StatCard title="Falhas" value={String(data?.failedAudits || 0)} subtitle="necessitam atenção" icon={XCircle} />
        <StatCard title="Problemas críticos" value={String(data?.criticalIssues || 0)} subtitle="prioridade máxima" icon={AlertTriangle} />
      </div>

      <div className={pageStyles.gridTwo}>
        <SectionCard title="Evolução de score" subtitle="histórico das últimas auditorias concluídas">
          {scoreSeries.length > 0 ? (
            <div className={pageStyles.chartWrap}>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={scoreSeries}>
                  <defs>
                    <linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6C63FF" stopOpacity={0.72} />
                      <stop offset="95%" stopColor="#6C63FF" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1A2340" vertical={false} />
                  <XAxis dataKey="label" stroke="#8C97B5" tickLine={false} axisLine={false} />
                  <YAxis stroke="#8C97B5" tickLine={false} axisLine={false} domain={[0, 100]} />
                  <Tooltip />
                  <Area type="monotone" dataKey="overall" stroke="#8E87FF" fill="url(#scoreFill)" strokeWidth={3} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={pageStyles.chartState}>
              <EmptyState
                compact
                icon={TrendingUp}
                title="Sem linha do tempo ainda"
                description="Conclua a primeira auditoria para comparar a evolução de score ao longo do tempo."
              />
            </div>
          )}
        </SectionCard>

        <SectionCard title="Distribuição por status" subtitle="equilíbrio da operação">
          {statusSeries.length > 0 ? (
            <div className={pageStyles.chartWrap}>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={statusSeries} dataKey="value" nameKey="name" innerRadius={54} outerRadius={92} paddingAngle={4}>
                    {statusSeries.map((entry, index) => (
                      <Cell key={entry.name} fill={statusColor(entry.status)} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={pageStyles.chartState}>
              <EmptyState
                compact
                icon={Clock3}
                title="Sem distribuição disponível"
                description="Os status passam a aparecer aqui assim que a fila começa a receber auditorias."
              />
            </div>
          )}
        </SectionCard>
      </div>

      <div className={pageStyles.gridTwo}>
        <SectionCard title="Médias por categoria" subtitle="fotografia consolidada da qualidade técnica">
          {categorySeries.length > 0 ? (
            <div className={pageStyles.chartWrap}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={categorySeries}>
                  <CartesianGrid stroke="#1A2340" vertical={false} />
                  <XAxis dataKey="label" stroke="#8C97B5" tickLine={false} axisLine={false} />
                  <YAxis stroke="#8C97B5" tickLine={false} axisLine={false} domain={[0, 100]} />
                  <Tooltip />
                  <Bar dataKey="score" radius={[10, 10, 0, 0]} fill="#53E0A1" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={pageStyles.chartState}>
              <EmptyState
                compact
                icon={Gauge}
                title="Sem médias consolidadas"
                description="As categorias serão preenchidas quando houver pelo menos uma auditoria concluída."
              />
            </div>
          )}
        </SectionCard>

        <SectionCard title="Distribuição de issues" subtitle="onde a aplicação mais concentra risco">
          {issueSeries.length > 0 ? (
            <div className={pageStyles.chartWrap}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={issueSeries} layout="vertical">
                  <CartesianGrid stroke="#1A2340" horizontal={false} />
                  <XAxis type="number" stroke="#8C97B5" tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" stroke="#8C97B5" tickLine={false} axisLine={false} width={140} />
                  <Tooltip />
                  <Bar dataKey="total" radius={[0, 10, 10, 0]} fill="#FFB648" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className={pageStyles.chartState}>
              <EmptyState
                compact
                icon={AlertTriangle}
                title="Nenhum achado agregado"
                description="Quando as auditorias gerarem issues, esta área mostrará os temas que mais exigem atenção."
              />
            </div>
          )}
        </SectionCard>
      </div>

      <div className={pageStyles.gridTwo}>
        <SectionCard title="Últimas auditorias" subtitle="atalho rápido para reabrir relatórios">
          <div className={pageStyles.auditList}>
            {(data?.recentAudits || []).map((audit) => (
              <AuditRow key={audit.id} audit={audit} />
            ))}
            {(data?.recentAudits || []).length === 0 ? (
              <EmptyState
                compact
                icon={ShieldCheck}
                title="Nenhuma auditoria registrada ainda"
                description="Crie a primeira análise para preencher o histórico recente e os atalhos executivos."
                action={
                  <Link className="secondaryButton" to="/audits/new">
                    Criar auditoria
                  </Link>
                }
              />
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Leitura executiva" subtitle="o que o painel diz sobre o produto hoje">
          <div className={pageStyles.executiveNotes}>
            <div>
              <Sparkles size={18} />
              <div>
                <strong>Saúde geral</strong>
                <span>
                  {Math.round(data?.averageScore || 0) >= 80
                    ? "A base atual parece comercialmente apresentável, mas ainda há espaço para refinamento técnico."
                    : "A base atual precisa de reforço antes de ser tratada como benchmark comercial."}
                </span>
              </div>
            </div>
            <div>
              <BarChart3 size={18} />
              <div>
                <strong>Capacidade operacional</strong>
                <span>
                  {data?.runningAudits
                    ? `${data.runningAudits} auditorias seguem em execução e exigem acompanhamento em tempo real.`
                    : "Não há auditorias em andamento agora."}
                </span>
              </div>
            </div>
            <div>
              <AlertTriangle size={18} />
              <div>
                <strong>Principal alerta</strong>
                <span>
                  {topIssue
                    ? `O tipo de issue mais recorrente hoje é ${humanizeLabel(topIssue.type)}.`
                    : "Ainda não existem issues suficientes para formar um padrão."}
                </span>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function AuditRow({ audit }: { audit: AuditListItem }) {
  return (
    <Link className={pageStyles.auditRow} to={`/audits/${audit.id}`}>
      <div>
        <strong>{audit.url}</strong>
        <span>{formatDate(audit.createdAt)}</span>
        {audit.status !== "COMPLETED" ? <small>{translateStage(audit.currentStage)}</small> : null}
      </div>
      <div className={pageStyles.auditRowMeta}>
        <span className={pageStyles.auditScore}>{audit.overallScore != null ? `${audit.overallScore}/100` : `${audit.progressPercent}%`}</span>
        <StatusBadge status={audit.status} />
      </div>
    </Link>
  );
}

function humanizeLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => {
      if (part === "ux") {
        return "UX";
      }
      if (part === "ui") {
        return "UI";
      }
      if (part === "seo") {
        return "SEO";
      }
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    })
    .join(" ");
}

export function toScoreSeries(scoreTimeline: DashboardSummary["scoreTimeline"]) {
  return scoreTimeline.map((audit) => ({
    label: audit.label,
    overall: audit.overallScore ?? null,
    performance: audit.performanceScore ?? null,
    accessibility: audit.accessibilityScore ?? null
  }));
}

const statusColors: Record<string, string> = {
  PENDING: "#FBBF24",
  RUNNING: "#22D3EE",
  COMPLETED: "#34D399",
  FAILED: "#FB7185",
  CANCELLED: "#8295AD"
};

export function statusColor(status: string) {
  return statusColors[status] || "#7C6CF2";
}
