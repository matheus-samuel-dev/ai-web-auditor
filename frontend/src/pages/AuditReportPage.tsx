import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileJson2,
  FileSearch,
  FileSpreadsheet,
  Link2,
  Layers3,
  LoaderCircle,
  Monitor,
  MousePointer2,
  RotateCcw,
  Search,
  ShieldAlert,
  Smartphone,
  Sparkles,
  TrendingUp,
  X,
  ZoomIn
} from "lucide-react";
import { startTransition, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { auditApi, fetchAsset } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ProgressBar } from "../components/ProgressBar";
import { ScoreRing } from "../components/ScoreRing";
import { SectionCard } from "../components/SectionCard";
import { SeverityBadge, StatusBadge } from "../components/StatusBadge";
import { useAuthorizedAsset } from "../hooks/useAuthorizedAsset";
import { usePageMeta } from "../hooks/usePageMeta";
import pageStyles from "../styles/report.module.css";
import type { AuditArtifact, AuditCoverage, AuditReport, IssueSeverity, ValidationStatus } from "../types";
import { deltaLabel, deltaTone, formatDate, translateStage } from "../utils/audit";

type FeedbackState = {
  message: string;
  tone: "error" | "success" | "info";
};

type ScreenshotPreviewState = { title: string; url: string; detail: string };

const POLLING_INTERVAL_MS = 2_500;
const POLLING_RETRY_MS = 5_000;
const POLLING_MAX_DURATION_MS = 20 * 60 * 1_000;
const POLLING_MAX_CONSECUTIVE_FAILURES = 6;

export function AuditReportPage() {
  const { auditId } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadFeedback, setDownloadFeedback] = useState<FeedbackState | null>(null);
  const [issueQuery, setIssueQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<"ALL" | IssueSeverity>("ALL");
  const [validationFilter, setValidationFilter] = useState<"ALL" | ValidationStatus>("ALL");
  const [actionLoading, setActionLoading] = useState(false);
  const [preview, setPreview] = useState<ScreenshotPreviewState | null>(null);
  const [refreshWarning, setRefreshWarning] = useState("");
  const [pollingStopped, setPollingStopped] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const reportRef = useRef<AuditReport | null>(null);

  const desktopAsset = useAuthorizedAsset(
    report?.desktopScreenshotArtifact.status === "AVAILABLE" ? report.desktopScreenshotArtifact.url : null
  );
  const mobileAsset = useAuthorizedAsset(
    report?.mobileScreenshotArtifact.status === "AVAILABLE" ? report.mobileScreenshotArtifact.url : null
  );

  usePageMeta(
    report ? `Auditoria ${report.url} | AI Web Auditor` : "Relatório da Auditoria | AI Web Auditor",
    "Relatório detalhado com progresso ao vivo, comparação histórica, IA executiva e exportações técnicas."
  );

  const runtimeItems = useMemo(
    () =>
      report
        ? [
            ...report.consoleErrors.map((entry) => ({
              key: entry.id,
              title: entry.type,
              description: entry.message,
              detail: "Console/runtime",
              href: ""
            })),
            ...(report.reportData?.networkErrors || []).map((entry, index) => ({
              key: `${entry.method}-${entry.url}-${index}`,
              title: "network",
              description: `${entry.method} ${entry.url}`,
              detail: entry.failureText,
              href: entry.url
            }))
          ]
        : [],
    [report]
  );

  const metrics = useMemo(
    () => Object.entries(report?.reportData?.lighthouse?.metrics || {}).map(([key, value]) => describeLighthouseMetric(key, value)),
    [report]
  );
  const aiSummary = report?.reportData?.summary?.ai;
  const issueSummary = report?.reportData?.issueSummary;
  const opportunities = report?.reportData?.lighthouse?.opportunities || [];
  const visualFindings = report?.reportData?.visualFindings || [];
  const coverage = useMemo(() => (report ? resolveReportCoverage(report) : null), [report]);
  const pages = report?.reportData?.pages || [];
  const actions = report?.reportData?.actions || [];
  const passiveSecurity = report?.reportData?.passiveSecurity;
  const progressLogs = report?.progressLogs || report?.reportData?.progressLogs || [];
  const quickWins = aiSummary?.quickWins || [];
  const correctionPriorities = aiSummary?.correctionPriorities || [];
  const topProblems = aiSummary?.topProblems || [];
  const technicalRecommendations = aiSummary?.technicalRecommendations || [];
  const artifactList = report
    ? [report.desktopScreenshotArtifact, report.mobileScreenshotArtifact, report.pdfArtifact, report.jsonArtifact]
    : [];
  const availableArtifacts = artifactList.filter((artifact) => artifact.status === "AVAILABLE").length;
  const filteredIssues = useMemo(() => {
    if (!report) return [];
    const query = issueQuery.trim().toLowerCase();
    return report.issues.filter((issue) => {
      const matchesQuery = !query || [issue.title, issue.description, issue.evidenceId, issue.pageUrl, issue.element]
        .filter(Boolean).join(" ").toLowerCase().includes(query);
      const matchesSeverity = severityFilter === "ALL" || issue.severity === severityFilter;
      const matchesValidation = validationFilter === "ALL" || issue.validationStatus === validationFilter;
      return matchesQuery && matchesSeverity && matchesValidation;
    });
  }, [issueQuery, report, severityFilter, validationFilter]);
  const factItems = report
    ? [
        {
          label: "Criada em",
          value: formatDate(report.createdAt),
          detail: report.startedAt ? `Início em ${formatDate(report.startedAt)}` : "Aguardando início da execução"
        },
        {
          label: report.status === "COMPLETED" ? "Concluída em" : "Etapa atual",
          value: report.status === "COMPLETED" ? formatDate(report.finishedAt) : translateStage(report.currentStage),
          detail: report.statusMessage || "Sem atualização complementar"
        },
        {
          label: "Achados priorizados",
          value: `${report.issues.length}`,
          detail: `${report.brokenLinks.length} links quebrados e ${runtimeItems.length} sinais de runtime`
        },
        {
          label: "Artefatos prontos",
          value: `${availableArtifacts}/4`,
          detail: "Desktop, mobile, JSON e PDF"
        }
      ]
    : [];

  useEffect(() => {
    if (!downloadFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => setDownloadFeedback(null), 4200);
    return () => window.clearTimeout(timeoutId);
  }, [downloadFeedback]);

  useEffect(() => {
    reportRef.current = null;
    setReport(null);
    setError("");
    setRefreshWarning("");
    setPollingStopped(false);
  }, [auditId]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;
    let controller: AbortController | null = null;
    let consecutiveFailures = 0;
    const pollingStartedAt = Date.now();

    setPollingStopped(false);
    setRefreshWarning("");
    if (!reportRef.current) setLoading(true);

    function scheduleNext(delay: number) {
      if (cancelled) return;
      if (Date.now() - pollingStartedAt >= POLLING_MAX_DURATION_MS) {
        setPollingStopped(true);
        setRefreshWarning("As atualizações automáticas foram pausadas após 20 minutos. A execução pode continuar no servidor; atualize manualmente para consultar o estado mais recente.");
        return;
      }
      timeoutId = window.setTimeout(loadReport, delay);
    }

    async function loadReport() {
      if (!auditId) {
        setError("O identificador da auditoria não foi informado.");
        setLoading(false);
        return;
      }

      try {
        controller?.abort();
        controller = new AbortController();
        const data = await auditApi.getById(auditId, { signal: controller.signal });
        if (!cancelled) {
          reportRef.current = data;
          startTransition(() => setReport(data));
          setError("");
          setRefreshWarning("");
          setPollingStopped(false);
          consecutiveFailures = 0;
          if (data.status === "RUNNING" || data.status === "PENDING") {
            scheduleNext(POLLING_INTERVAL_MS);
          }
        }
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        if (!cancelled) {
          const message = requestError instanceof Error ? requestError.message : "Não foi possível carregar a auditoria.";
          const status = requestError instanceof Error && "status" in requestError ? Number(requestError.status) : 0;
          const canRetry = status !== 401 && status !== 403 && status !== 404;
          if (reportRef.current) {
            setRefreshWarning(`O relatório permanece visível, mas a última atualização falhou: ${message}`);
          } else {
            setError(message);
          }
          consecutiveFailures += 1;
          if (canRetry && consecutiveFailures < POLLING_MAX_CONSECUTIVE_FAILURES) {
            scheduleNext(POLLING_RETRY_MS);
          } else if (canRetry) {
            setPollingStopped(true);
            setRefreshWarning("As atualizações automáticas foram pausadas após falhas repetidas de comunicação. O último relatório recebido foi preservado.");
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadReport();

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearTimeout(timeoutId);
    };
  }, [auditId, pollRevision]);

  async function downloadRemoteFile(artifact: AuditArtifact, filename: string) {
    if (artifact.status !== "AVAILABLE" || !artifact.url) {
      setDownloadFeedback({
        tone: "info",
        message: artifact.message || "O artefato ainda não está disponível para download."
      });
      return;
    }

    try {
      const blob = await fetchAsset(artifact.url);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setDownloadFeedback({
        tone: "success",
        message: `${filename} preparado para download.`
      });
    } catch (downloadError) {
      setDownloadFeedback({
        tone: "error",
        message: downloadError instanceof Error ? downloadError.message : "Não foi possível baixar o artefato."
      });
    }
  }

  function exportIssuesCsv() {
    if (!report) {
      return;
    }

    const lines = [
      ["severity", "type", "title", "source", "description", "recommendation"].join(","),
      ...report.issues.map((issue) =>
        [issue.severity, issue.type, issue.title, issue.source, issue.description, issue.recommendation]
          .map(csvCell)
          .join(",")
      )
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `audit-${report.id}-issues.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setDownloadFeedback({
      tone: "success",
      message: `audit-${report.id}-issues.csv preparado para download.`
    });
  }

  async function cancelAudit() {
    if (!report || actionLoading) return;
    setActionLoading(true);
    try {
      await auditApi.cancel(report.id);
      const updated = await auditApi.getById(report.id);
      reportRef.current = updated;
      setReport(updated);
      setDownloadFeedback({ tone: "success", message: "Cancelamento solicitado com segurança." });
    } catch (requestError) {
      setDownloadFeedback({ tone: "error", message: requestError instanceof Error ? requestError.message : "Não foi possível cancelar a auditoria." });
    } finally {
      setActionLoading(false);
    }
  }

  async function retryAudit() {
    if (!report || actionLoading) return;
    if (report.auditMode === "AUTHENTICATED" || report.auditMode === "GUIDED") {
      const params = new URLSearchParams({ url: report.url, mode: report.auditMode });
      if (report.projectId) params.set("project", report.projectId);
      navigate(`/audits/new?${params.toString()}`);
      return;
    }
    setActionLoading(true);
    try {
      const retried = await auditApi.retry(report.id);
      window.location.assign(`/audits/${retried.id}`);
    } catch (requestError) {
      setDownloadFeedback({ tone: "error", message: requestError instanceof Error ? requestError.message : "Não foi possível repetir a auditoria." });
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return <PageSkeleton message="Carregando relatório da auditoria..." />;
  }

  if (error && !report) {
    return (
      <div className={pageStyles.page}>
        <SectionCard title="Relatório indisponível" subtitle="não foi possível carregar os dados desta auditoria">
          <EmptyState
            icon={AlertTriangle}
            title="Falha ao abrir a auditoria"
            description={error}
            action={
              <button className="secondaryButton" onClick={() => window.location.reload()} type="button">
                Tentar novamente
              </button>
            }
          />
        </SectionCard>
      </div>
    );
  }

  if (!report) {
    return (
      <div className={pageStyles.page}>
        <SectionCard title="Auditoria não encontrada" subtitle="o relatório solicitado não pôde ser localizado">
          <EmptyState
            icon={FileSearch}
            title="Nenhum relatório encontrado"
            description="Verifique o histórico e abra novamente a auditoria desejada."
          />
        </SectionCard>
      </div>
    );
  }

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.headerRow}>
        <div>
          <div className={pageStyles.headerMeta}>
            <span>{report.url}</span>
            <StatusBadge status={report.status} />
          </div>
          <h2>Relatório da Auditoria</h2>
          <p>{aiSummary?.executiveSummary || report.aiSummary || "Aguarde a consolidação da auditoria automatizada."}</p>
        </div>
        <div className={pageStyles.headerActions}>
          <button
            className="secondaryButton"
            onClick={() => downloadRemoteFile(report.pdfArtifact, `audit-${report.id}.pdf`)}
            type="button"
            disabled={report.pdfArtifact.status !== "AVAILABLE" || !report.pdfArtifact.url}
          >
            <Download size={16} />
            PDF
          </button>
          <button
            className="secondaryButton"
            onClick={() => downloadRemoteFile(report.jsonArtifact, `audit-${report.id}.json`)}
            type="button"
            disabled={report.jsonArtifact.status !== "AVAILABLE" || !report.jsonArtifact.url}
          >
            <FileJson2 size={16} />
            JSON
          </button>
          <button className="secondaryButton" onClick={exportIssuesCsv} type="button" disabled={report.issues.length === 0}>
            <FileSpreadsheet size={16} />
            CSV
          </button>
          {report.status === "RUNNING" || report.status === "PENDING" ? (
            <button className="dangerButton" onClick={cancelAudit} type="button" disabled={actionLoading}>
              <Ban size={16} /> Cancelar
            </button>
          ) : null}
          {report.status === "FAILED" || report.status === "CANCELLED" ? (
            <button className="primaryButton" onClick={retryAudit} type="button" disabled={actionLoading}>
              <RotateCcw size={16} /> {report.auditMode === "AUTHENTICATED" || report.auditMode === "GUIDED" ? "Reconfigurar auditoria" : "Tentar novamente"}
            </button>
          ) : null}
        </div>
      </div>

      {downloadFeedback ? (
        <div className={feedbackClassName(downloadFeedback.tone)} aria-live="polite">
          {downloadFeedback.message}
        </div>
      ) : null}

      {refreshWarning ? (
        <div className="inlineInfo" role="status">
          <span>{refreshWarning}</span>
          <button className="secondaryButton" type="button" onClick={() => setPollRevision((value) => value + 1)}>
            Atualizar agora
          </button>
        </div>
      ) : null}

      {report.status === "RUNNING" || report.status === "PENDING" ? (
        <div className={pageStyles.runningBanner} role="status" aria-live="polite">
          {pollingStopped ? <AlertTriangle size={18} /> : <LoaderCircle size={18} className="spin" />}
          {pollingStopped
            ? "A auditoria ainda não informou um estado terminal. A atualização automática está pausada."
            : "A auditoria está em execução e o relatório é atualizado automaticamente."}
        </div>
      ) : null}

      {(report.status === "RUNNING" || report.status === "PENDING") && (
        <ProgressBar
          value={report.progressPercent}
          label={translateStage(report.currentStage)}
          hint={report.statusMessage || "Pipeline em andamento"}
        />
      )}

      {report.status === "RUNNING" || report.status === "PENDING" ? (
        <SectionCard title="Execução em tempo real" subtitle="estado persistido do pipeline — a tela nunca aguarda indefinidamente">
          <div className={pageStyles.executionGrid}>
            <ol className={pageStyles.executionTimeline}>
              {executionStages.map((stage) => {
                const currentIndex = executionStageIndex(report.currentStage);
                const stageIndex = executionStages.indexOf(stage);
                const state = currentIndex < 0 ? "pending" : stageIndex < currentIndex ? "done" : stageIndex === currentIndex ? "active" : "pending";
                return <li key={stage.ids[0]} data-state={state}><span>{state === "done" ? <CheckCircle2 size={14} /> : stageIndex + 1}</span><div><strong>{stage.label}</strong><small>{state === "active" ? report.statusMessage || "Em processamento" : state === "done" ? "Concluída" : "Aguardando"}</small></div></li>;
              })}
            </ol>
            <div className={pageStyles.executionAside}>
              <div className={pageStyles.runtimeStats}>
                <div><span>Página atual</span><strong>{report.currentPage || "Preparando"}</strong></div>
                <div><span>Ações executadas</span><strong>{report.actionsExecuted ?? coverage?.interactionsExecuted ?? 0}</strong></div>
                <div><span>Achados encontrados</span><strong>{report.findingsCount ?? report.issues.length}</strong></div>
                <div><span>Tempo</span><strong>{formatDuration(report.elapsedSeconds)}</strong></div>
                <div><span>Estimativa restante</span><strong>{formatDuration(report.estimatedRemainingSeconds)}</strong></div>
              </div>
              <div className={pageStyles.liveLog} aria-live="polite"><strong>Log resumido</strong>{progressLogs.length ? progressLogs.slice(-6).map((entry, index) => <div key={`${entry.timestamp}-${index}`}><span>{entry.level || "INFO"}</span><p>{entry.message}</p></div>) : <p>Aguardando a próxima atualização do worker.</p>}</div>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {report.status === "FAILED" ? (
        <div className="inlineError">{report.failureReason || "A auditoria falhou antes de concluir."}</div>
      ) : null}

      <div className={pageStyles.factStrip}>
        {factItems.map((item) => (
          <article key={item.label} className={pageStyles.factCard}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </article>
        ))}
      </div>

      <SectionCard title="Cobertura da auditoria" subtitle="mede o que foi exercitado — não é substituída pela pontuação Lighthouse">
        {coverage ? (
          <div className={pageStyles.coverageLayout}>
            <div className={pageStyles.coverageScore}>
              <strong>{Math.round(coverage.functionalCoveragePercent)}%</strong><span>Cobertura funcional</span>
              <div className={pageStyles.coverageTrack} aria-label={`${coverage.functionalCoveragePercent}% de cobertura`} role="progressbar" aria-valuenow={coverage.functionalCoveragePercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(100, coverage.functionalCoveragePercent))}%` }} /></div>
              <small>{coverage.devices.length || report.reportData?.responsive ? "Desktop e mobile tratados como execuções separadas" : "Dispositivos não informados"}</small>
            </div>
            <div className={pageStyles.coverageMetrics}>
              <CoverageMetric label="Páginas visitadas" value={formatCoverageFraction(coverage.pagesVisited, coverage.pagesDiscovered)} />
              <CoverageMetric label="Links verificados" value={formatCoverageFraction(coverage.linksChecked, coverage.linksFound)} />
              <CoverageMetric label="Ações executadas" value={formatCoverageFraction(coverage.interactionsExecuted, coverage.interactionsDiscovered)} />
              <CoverageMetric label="Formulários testados" value={formatCoverageFraction(coverage.formsTested, coverage.formsFound)} />
              <CoverageMetric label="Fluxos concluídos" value={`${coverage.scenariosCompleted}`} />
              <CoverageMetric label="Ignoradas por segurança" value={coverage.interactionsSkippedSafety == null ? "Não registrado" : `${coverage.interactionsSkippedSafety}`} warning={(coverage.interactionsSkippedSafety ?? 0) > 0} />
            </div>
          </div>
        ) : (
          <EmptyState compact icon={Layers3} title="Cobertura ainda não consolidada" description={report.status === "COMPLETED" ? "Esta execução antiga não registrou cobertura funcional; os scores não comprovam fluxos testados." : "Páginas e interações aparecem assim que a descoberta começar."} />
        )}
      </SectionCard>

      <div className={pageStyles.scoreGrid}>
        <div className={pageStyles.overallCard}>
          <ScoreRing label="Pontuação geral" score={report.overallScore} />
        </div>
        <div className={pageStyles.miniScores}>
          <ScoreRing label="Performance" score={report.performanceScore} compact />
          <ScoreRing label="Acessibilidade" score={report.accessibilityScore} compact />
          <ScoreRing label="SEO" score={report.seoScore} compact />
          <ScoreRing label="Boas práticas" score={report.bestPracticesScore} compact />
        </div>
      </div>

      <div className={pageStyles.bottomGrid}>
        <SectionCard title="Leitura executiva da IA" subtitle="título, confiança, quick wins e prontidão de release">
          <div className={pageStyles.aiExecutive}>
            <div className={pageStyles.aiHeadline}>
              <Sparkles size={16} />
              <strong>{aiSummary?.executiveTitle || "Resumo executivo"}</strong>
            </div>
            <div className={pageStyles.labelRow}>
              <span className={pageStyles.signalPill}>{aiSummary?.confidenceLabel || "IA não disponível"}</span>
              <span className={pageStyles.signalPillAlt}>{aiSummary?.releaseReadiness || "Somente análise determinística"}</span>
            </div>
            <p>{aiSummary?.businessImpact || aiSummary?.userImpact || report.aiSummary || (report.status === "COMPLETED" ? "Análise técnica concluída. O resumo por IA não está disponível neste ambiente." : "Resumo executivo aguardando evidências.")}</p>
            <div className={pageStyles.dualList}>
              <ListBlock title="Quick wins" items={quickWins} emptyLabel="Sem quick wins sugeridos." />
              <ListBlock title="Prioridades" items={correctionPriorities} emptyLabel="Sem prioridades adicionais." />
            </div>
            {topProblems.length > 0 || technicalRecommendations.length > 0 ? (
              <div className={pageStyles.dualList}>
                <ListBlock title="Problemas centrais" items={topProblems} emptyLabel="Sem novos alertas estratégicos." />
                <ListBlock
                  title="Recomendações técnicas"
                  items={technicalRecommendations}
                  emptyLabel="Sem recomendações técnicas adicionais."
                />
              </div>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Comparação com a auditoria anterior" subtitle="valores anteriores, atuais e diferença para a mesma URL">
          {report.comparison ? (
            <div className={pageStyles.comparisonCard}>
              <div className={pageStyles.comparisonHero}>
                <TrendingUp size={18} />
                <div>
                  <strong>{report.comparison.trendLabel}</strong>
                  <span>{report.comparison.baseline ? "Baseline" : "Auditoria"} de {formatDate(report.comparison.previousCreatedAt)}</span>
                </div>
                <button className="secondaryButton" type="button" onClick={() => navigate(`/audits/${report.comparison?.previousAuditId}`)}>Ver anterior</button>
              </div>
              <div className={pageStyles.comparisonLegend} aria-hidden="true"><span>Métrica</span><span>Anterior</span><span>Atual</span><span>Diferença</span></div>
              <div className={pageStyles.deltaGrid}>
                <ComparisonMetric label="Geral" previous={report.comparison.previousOverallScore} current={report.comparison.currentOverallScore ?? report.overallScore} delta={report.comparison.overallDelta} />
                <ComparisonMetric label="Performance" previous={comparisonPrevious(report.comparison.previousPerformanceScore, report.comparison.currentPerformanceScore ?? report.performanceScore, report.comparison.performanceDelta)} current={report.comparison.currentPerformanceScore ?? report.performanceScore} delta={report.comparison.performanceDelta} />
                <ComparisonMetric label="Acessibilidade" previous={comparisonPrevious(report.comparison.previousAccessibilityScore, report.comparison.currentAccessibilityScore ?? report.accessibilityScore, report.comparison.accessibilityDelta)} current={report.comparison.currentAccessibilityScore ?? report.accessibilityScore} delta={report.comparison.accessibilityDelta} />
                <ComparisonMetric label="SEO" previous={comparisonPrevious(report.comparison.previousSeoScore, report.comparison.currentSeoScore ?? report.seoScore, report.comparison.seoDelta)} current={report.comparison.currentSeoScore ?? report.seoScore} delta={report.comparison.seoDelta} />
                <ComparisonMetric label="Boas práticas" previous={comparisonPrevious(report.comparison.previousBestPracticesScore, report.comparison.currentBestPracticesScore ?? report.bestPracticesScore, report.comparison.bestPracticesDelta)} current={report.comparison.currentBestPracticesScore ?? report.bestPracticesScore} delta={report.comparison.bestPracticesDelta} />
                <ComparisonMetric label="Cobertura" previous={comparisonPrevious(report.comparison.previousCoveragePercent, report.comparison.currentCoveragePercent ?? report.coverage?.coveragePercent ?? null, report.comparison.coverageDelta)} current={report.comparison.currentCoveragePercent ?? report.coverage?.coveragePercent ?? null} delta={report.comparison.coverageDelta} suffix="%" />
              </div>
            </div>
          ) : (
            <EmptyState
              compact
              icon={Clock3}
              title="Sem baseline anterior"
              description="Assim que duas auditorias concluídas existirem para a mesma URL, a comparação automática aparece aqui."
            />
          )}
        </SectionCard>
      </div>

      <div className={pageStyles.mainGrid}>
        <SectionCard
          title="Problemas encontrados"
          subtitle="itens priorizados para correção"
          action={<span className={pageStyles.sectionBadge}>{pluralizeIssues(report.issues.length)}</span>}
        >
          <div className={pageStyles.findingToolbar}>
            <label className="controlInput"><Search size={15} /><input type="search" value={issueQuery} onChange={(event) => setIssueQuery(event.target.value)} placeholder="Buscar título, página ou evidência" aria-label="Buscar achados" /></label>
            <label className="selectInput"><select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as "ALL" | IssueSeverity)} aria-label="Filtrar severidade"><option value="ALL">Todas as severidades</option><option value="CRITICAL">Crítico</option><option value="HIGH">Alto</option><option value="MEDIUM">Médio</option><option value="LOW">Baixo</option><option value="OPPORTUNITY">Oportunidade</option></select></label>
            <label className="selectInput"><select value={validationFilter} onChange={(event) => setValidationFilter(event.target.value as "ALL" | ValidationStatus)} aria-label="Filtrar estado de validação"><option value="ALL">Todos os estados</option><option value="AUTOMATICALLY_VALIDATED">Validado automaticamente</option><option value="PARTIALLY_VALIDATED">Validado parcialmente</option><option value="NOT_TESTED">Não testado</option><option value="BLOCKED_AUTHENTICATION">Bloqueado por autenticação</option><option value="BLOCKED_CAPTCHA_OR_MFA">Bloqueado por CAPTCHA/MFA</option><option value="SKIPPED_FOR_SAFETY">Ignorado por segurança</option><option value="MANUAL_REVIEW_REQUIRED">Revisão manual</option><option value="FAILED">Falhou</option></select></label>
          </div>
          <div className={pageStyles.issueList}>
            {report.issues.length === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle2}
                title={report.status === "COMPLETED" ? "Nenhum problema priorizado" : "Achados ainda não consolidados"}
                description={report.status === "COMPLETED" ? "Nenhum finding foi registrado nesta execução. Verifique a cobertura antes de interpretar isso como aprovação." : "O motor ainda está coletando evidências; ausência temporária não significa aprovação."}
              />
            ) : null}

            {report.issues.length > 0 && filteredIssues.length === 0 ? <EmptyState compact icon={Search} title="Nenhum achado corresponde aos filtros" description="Remova um filtro ou use outro termo de busca." /> : null}

            {filteredIssues.map((issue) => (
              <article key={issue.id} className={pageStyles.issueRow}>
                <div className={pageStyles.issueBody}>
                  <div className={pageStyles.issueHeader}>
                    <strong>{issue.title}</strong>
                    <SeverityBadge severity={issue.severity} />
                  </div>
                  <div className={pageStyles.issueMeta}>
                    <span>{humanizeLabel(issue.type)}</span>
                    <span>{issue.source}</span>
                    {issue.evidenceId ? <span className={pageStyles.evidenceId}>{issue.evidenceId}</span> : null}
                    {issue.validationStatus ? <span>{validationStatusLabel(issue.validationStatus)}</span> : null}
                  </div>
                  <p>{issue.description}</p>
                  {issue.pageUrl || issue.device ? <div className={pageStyles.findingContext}><span>{issue.pageUrl || "Página não informada"}</span><span>{issue.device || "Dispositivo não informado"}</span>{issue.element ? <span>{issue.element}</span> : null}</div> : null}
                  {issue.actualResult || issue.expectedResult ? <div className={pageStyles.expectedActual}><div><strong>Esperado</strong><span>{issue.expectedResult || "Não informado"}</span></div><div><strong>Encontrado</strong><span>{issue.actualResult || issue.description}</span></div></div> : null}
                  <div className={pageStyles.issueRecommendation}>
                    <strong>Recomendação</strong>
                    <span>{issue.recommendation}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Capturas da interface" subtitle="validação visual em desktop e mobile">
          <div className={pageStyles.screenshotGrid}>
            <ArtifactPreview
              title="Desktop"
              icon={<Monitor size={16} />}
              artifact={report.desktopScreenshotArtifact}
              assetUrl={desktopAsset.assetUrl}
              isLoading={desktopAsset.isLoading}
              loadError={desktopAsset.errorMessage}
              alt="Screenshot desktop da auditoria"
              onOpen={() => desktopAsset.assetUrl && setPreview({ title: "Evidência desktop", url: desktopAsset.assetUrl, detail: `1440 × 900 · ${report.url}` })}
            />
            <ArtifactPreview
              title="Mobile"
              icon={<Smartphone size={16} />}
              artifact={report.mobileScreenshotArtifact}
              assetUrl={mobileAsset.assetUrl}
              isLoading={mobileAsset.isLoading}
              loadError={mobileAsset.errorMessage}
              alt="Screenshot mobile da auditoria"
              onOpen={() => mobileAsset.assetUrl && setPreview({ title: "Evidência mobile", url: mobileAsset.assetUrl, detail: `Viewport mobile · ${report.url}` })}
            />
          </div>
        </SectionCard>
      </div>

      <div className={pageStyles.bottomGrid}>
        <SectionCard title="Jornada funcional" subtitle="ações executadas, bloqueadas ou encaminhadas para revisão manual">
          {actions.length ? <div className={pageStyles.interactionList}>{actions.slice(0, 40).map((action) => <article key={action.id}><span className={pageStyles.interactionIcon}><MousePointer2 size={15} /></span><div><div><strong>{humanizeAction(action.action)}</strong><code>{action.id}</code></div><p>{action.accessibleName || action.element || action.selector || "Elemento sem nome acessível"}</p><small>{action.url} · {action.viewportId || "viewport não informada"} · {validationStatusLabel(action.validationStatus)}</small>{action.error ? <span className={pageStyles.interactionError}>{action.error}</span> : null}</div></article>)}</div> : <EmptyState compact icon={MousePointer2} title="Nenhuma interação registrada" description={report.status === "COMPLETED" ? "A execução não exercitou controles funcionais; interprete a auditoria como cobertura parcial." : "As ações aparecerão após a descoberta dos controles."} />}
        </SectionCard>
        <SectionCard title="Páginas auditadas" subtitle="inventário real de descoberta, visita e evidência visual">
          {pages.length ? <div className={pageStyles.pageEvidenceList}>{pages.slice(0, 40).map((page) => <article key={page.id}><div><strong>{page.title || page.url}</strong><code>{page.id}</code></div><span>{page.url}</span><small>{validationStatusLabel(page.validationStatus)} · {page.viewportIds.length ? page.viewportIds.join(", ") : "viewport não informada"} · {page.interactionsFound} interações encontradas</small>{page.skipReason ? <span className={pageStyles.interactionError}>{page.skipReason}</span> : null}</article>)}</div> : <EmptyState compact icon={Layers3} title="Inventário de páginas indisponível" description={report.status === "COMPLETED" ? "Esta execução legada registrou apenas a URL inicial." : "O inventário será preenchido durante o crawl."} />}
        </SectionCard>
      </div>

      <div className={pageStyles.bottomGrid}>
        <SectionCard title="Performance e sinais técnicos" subtitle="métricas principais do Lighthouse e Core Web Vitals">
          {metrics.length > 0 ? (
            <div className={pageStyles.metricGrid}>
              {metrics.map((metric) => (
                <div key={metric.key} className={pageStyles.metricTile}>
                  <strong>{metric.label}</strong>
                  <span>{metric.value || "—"}</span>
                  <small>{metric.explanation}</small>
                  {metric.rating ? <b className={pageStyles[`metric${capitalize(metric.rating.tone)}`]}>{metric.rating.label}</b> : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon={Clock3}
              title="Métricas ainda indisponíveis"
              description={report.status === "COMPLETED" ? report.reportData?.lighthouse?.failureReason || "O Lighthouse não concluiu esta medição; nenhum valor foi presumido." : "As medições aparecem aqui quando o Lighthouse conclui a coleta."}
            />
          )}

          <div className={pageStyles.linkList}>
            {opportunities.length === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle2}
                title="Sem oportunidades destacadas"
                description="Nenhum insight prioritário de performance foi retornado nesta execução."
              />
            ) : null}

            {opportunities.slice(0, 4).map((opportunity) => (
              <div key={opportunity.id} className={pageStyles.opportunity}>
                <span>{opportunity.title}</span>
                <small>{opportunity.displayValue || "Melhoria recomendada"}</small>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Artefatos e exportações"
          subtitle="estado atual de cada saída da auditoria"
          action={<span className={pageStyles.sectionBadge}>{availableArtifacts}/4 prontos</span>}
        >
          <div className={pageStyles.artifactList}>
            <ArtifactRow label="Captura desktop" artifact={report.desktopScreenshotArtifact} />
            <ArtifactRow label="Captura mobile" artifact={report.mobileScreenshotArtifact} />
            <ArtifactRow label="Relatório em PDF" artifact={report.pdfArtifact} />
            <ArtifactRow label="Exportação JSON" artifact={report.jsonArtifact} />
          </div>
        </SectionCard>
      </div>

      <div className={pageStyles.bottomGrid}>
        <SectionCard title="Resumo operacional" subtitle="contagem de risco, cobertura e sinais de execução">
          <div className={pageStyles.metricGrid}>
            <div className={pageStyles.metricTile}>
              <strong>Achados críticos</strong>
              <span>{issueSummary?.critical ?? 0}</span>
            </div>
            <div className={pageStyles.metricTile}>
              <strong>Alta prioridade</strong>
              <span>{issueSummary?.high ?? report.issues.filter((issue) => issue.severity === "HIGH").length}</span>
            </div>
            <div className={pageStyles.metricTile}>
              <strong>Prioridade média</strong>
              <span>{issueSummary?.medium ?? 0}</span>
            </div>
            <div className={pageStyles.metricTile}>
              <strong>Links quebrados</strong>
              <span>{issueSummary?.brokenLinks ?? report.brokenLinks.length}</span>
            </div>
            <div className={pageStyles.metricTile}>
              <strong>Erros de console</strong>
              <span>{issueSummary?.consoleErrors ?? report.consoleErrors.length}</span>
            </div>
          </div>
          <div className={pageStyles.metricGrid}>
            <div className={pageStyles.metricTile}>
              <strong>HTTPS</strong>
              <span>{passiveSecurity ? passiveSecurity.https ? "Ativo" : "Ausente" : "Não medido"}</span>
            </div>
            <div className={pageStyles.metricTile}>
              <strong>Conteúdo misto</strong>
              <span>{passiveSecurity ? passiveSecurity.mixedContentRequests ?? passiveSecurity.mixedContent ?? 0 : "Não medido"}</span>
            </div>
            <div className={pageStyles.metricTile}>
              <strong>Formulários inseguros</strong>
              <span>{passiveSecurity ? passiveSecurity.insecureForms : "Não medido"}</span>
            </div>
            <div className={pageStyles.metricTile}>
              <strong>Headers ausentes</strong>
              <span>{passiveSecurity ? Object.values(passiveSecurity.headers).filter((value) => !value).length : "Não medido"}</span>
            </div>
          </div>
          <div className={pageStyles.metricGrid}>
            <div className={pageStyles.metricTile}>
              <strong>Violações axe</strong>
              <span>{report.reportData?.axe ? report.reportData.axe.violationCount : "Não medido"}</span>
            </div>
            <div className={pageStyles.metricTile}>
              <strong>Tap targets pequenos</strong>
              <span>{report.reportData?.responsive?.mobile ? report.reportData.responsive.mobile.smallTapTargets : "Não medido"}</span>
            </div>
            <div className={pageStyles.metricTile}>
              <strong>Overflow horizontal</strong>
              <span>{report.reportData?.responsive?.mobile ? report.reportData.responsive.mobile.horizontalOverflow ? "Detectado" : "Não detectado" : "Não medido"}</span>
            </div>
            <div className={pageStyles.metricTile}>
              <strong>Achados visuais</strong>
              <span>{visualFindings.length}</span>
            </div>
          </div>
          <div className={pageStyles.aiBlock}>
            <div className={pageStyles.aiHeader}>
              <Sparkles size={16} />
              <strong>Impacto no usuário</strong>
            </div>
            <p>{aiSummary?.userImpact || "Sem resumo adicional de impacto."}</p>
          </div>
        </SectionCard>

        <SectionCard title="Console e rede" subtitle="indicadores operacionais capturados na navegação">
          <div className={pageStyles.issueList}>
            {runtimeItems.length === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle2}
                title="Nenhum erro de runtime relevante"
                description="A navegação auditada não retornou sinais importantes de console ou rede."
              />
            ) : null}

            {runtimeItems.map((entry) => (
              <article key={entry.key} className={pageStyles.issueRow}>
                <div className={pageStyles.issueBody}>
                  <div className={pageStyles.issueHeader}>
                    <strong>{entry.title}</strong>
                    <span className={pageStyles.issueHint}>
                      <AlertTriangle size={14} />
                      runtime
                    </span>
                  </div>
                  <p>{entry.description}</p>
                  {entry.detail ? <span>{entry.detail}</span> : null}
                </div>
                {entry.href ? (
                  <a href={entry.href} target="_blank" rel="noreferrer" aria-label={`Abrir recurso ${entry.href}`}>
                    <ExternalLink size={14} />
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </SectionCard>
      </div>

      <div className={pageStyles.bottomGrid}>
        <SectionCard title="Links quebrados" subtitle="status HTTP problemáticos detectados">
          <div className={pageStyles.linkList}>
            {report.brokenLinks.length === 0 ? (
              <EmptyState
                compact
                icon={CheckCircle2}
                title="Nenhum link quebrado encontrado"
                description="A varredura de links não encontrou respostas problemáticas nesta auditoria."
              />
            ) : null}

            {report.brokenLinks.map((link) => (
              <div key={link.id} className={pageStyles.linkRow}>
                <div>
                  <Link2 size={16} />
                  <span>{link.url}</span>
                </div>
                <strong>{link.statusCode}</strong>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {preview ? <ScreenshotDialog preview={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

export function ScreenshotDialog({ preview, onClose }: { preview: ScreenshotPreviewState; onClose: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div className={pageStyles.screenshotModal} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className={pageStyles.screenshotModalPanel}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header>
          <div><strong id={titleId}>{preview.title}</strong><span>{preview.detail}</span></div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Fechar evidência"><X size={19} /></button>
        </header>
        <div className={pageStyles.screenshotViewport}><img src={preview.url} alt={preview.title} /></div>
        <footer>
          <ZoomIn size={15} />
          <span id={descriptionId}>Use a rolagem para inspecionar a captura em resolução legível.</span>
          <a className="secondaryButton" href={preview.url} download>Abrir original</a>
        </footer>
      </div>
    </div>
  );
}

function ArtifactPreview({
  title,
  icon,
  artifact,
  assetUrl,
  isLoading,
  loadError,
  alt,
  onOpen
}: {
  title: string;
  icon: ReactNode;
  artifact: AuditArtifact;
  assetUrl: string | null;
  isLoading: boolean;
  loadError: string | null;
  alt: string;
  onOpen?: () => void;
}) {
  return (
    <div className={pageStyles.screenshotCard}>
      <div className={pageStyles.screenshotHeader}>
        {icon}
        {title}
      </div>

      {assetUrl ? <button type="button" className={pageStyles.screenshotButton} onClick={onOpen} aria-label={`Ampliar ${title}`}><img src={assetUrl} alt={alt} loading="lazy" /><span><ZoomIn size={15} />Ampliar evidência</span></button> : null}
      {assetUrl ? <div className={pageStyles.screenshotMeta}>{artifact.message || "Captura disponível para revisão visual."}</div> : null}

      {!assetUrl ? (
        <div className={pageStyles.screenshotPlaceholder}>
          {isLoading ? (
            <div className={pageStyles.placeholderState}>
              <LoaderCircle size={18} className="spin" />
              <span>Carregando artefato...</span>
            </div>
          ) : (
            <div className={pageStyles.placeholderState}>
              <strong>{artifactStatusLabel(artifact.status)}</strong>
              <span>{loadError || artifact.message}</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ArtifactRow({ label, artifact }: { label: string; artifact: AuditArtifact }) {
  return (
    <div className={pageStyles.artifactRow}>
      <div>
        <strong>{label}</strong>
        <span>{artifact.message}</span>
      </div>
      <b className={`${pageStyles.artifactBadge} ${pageStyles[`artifact${capitalize(artifact.status.toLowerCase())}`]}`}>
        {artifactStatusLabel(artifact.status)}
      </b>
    </div>
  );
}

function ComparisonMetric({
  label,
  previous,
  current,
  delta,
  suffix = ""
}: {
  label: string;
  previous: number | null | undefined;
  current: number | null | undefined;
  delta: number | null | undefined;
  suffix?: string;
}) {
  return (
    <div className={pageStyles.deltaTile}>
      <strong>{label}</strong>
      <div className={pageStyles.comparisonValue}><small>Anterior</small><span>{formatComparisonValue(previous, suffix)}</span></div>
      <div className={pageStyles.comparisonValue}><small>Atual</small><span>{formatComparisonValue(current, suffix)}</span></div>
      <div className={pageStyles.comparisonValue}><small>Diferença</small><span className={`delta${capitalize(deltaTone(delta))}`}>{delta == null ? "N/D" : `${deltaLabel(delta)}${suffix}`}</span></div>
    </div>
  );
}

function ListBlock({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return (
    <div className={pageStyles.listBlock}>
      <strong>{title}</strong>
      {items.length === 0 ? <p>{emptyLabel}</p> : null}
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function artifactStatusLabel(status: AuditArtifact["status"]) {
  switch (status) {
    case "AVAILABLE":
      return "Disponível";
    case "GENERATING":
      return "Gerando";
    case "FAILED":
      return "Erro";
    case "CANCELLED":
      return "Cancelado";
    case "UNAVAILABLE":
      return "Inexistente";
    default:
      return status;
  }
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

function pluralizeIssues(total: number) {
  return total === 1 ? "1 achado" : `${total} achados`;
}

export function csvCell(value: string) {
  const safeValue = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function formatCoverageFraction(completed?: number | null, total?: number | null) {
  const safeCompleted = Number.isFinite(completed) && Number(completed) > 0 ? Number(completed) : 0;
  const safeTotal = Number.isFinite(total) && Number(total) > 0 ? Number(total) : 0;
  if (safeTotal > 0) return `${safeCompleted}/${safeTotal}`;
  return safeCompleted > 0 ? `${safeCompleted}/—` : "0/0";
}

function CoverageMetric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <div className={warning ? pageStyles.coverageMetricWarning : pageStyles.coverageMetric}><span>{label}</span><strong>{value}</strong></div>;
}

type ResolvedReportCoverage = Omit<AuditCoverage, "interactionsSkippedSafety"> & {
  interactionsSkippedSafety: number | null;
};

export function resolveReportCoverage(report: AuditReport): ResolvedReportCoverage | null {
  const evidenceCoverage = report.reportData?.coverage;
  if (evidenceCoverage) {
    return {
      ...evidenceCoverage,
      devices: Array.isArray(evidenceCoverage.devices) ? evidenceCoverage.devices : [],
      viewports: Array.isArray(evidenceCoverage.viewports) ? evidenceCoverage.viewports : []
    };
  }

  const persisted = report.coverage;
  if (!persisted) return null;

  return {
    pagesDiscovered: persisted.pagesDiscovered,
    pagesVisited: persisted.pagesVisited,
    pagesIgnored: persisted.pagesSkipped,
    linksFound: persisted.linksFound,
    linksChecked: persisted.linksChecked,
    interactionsDiscovered: persisted.interactionsDiscovered,
    interactionsExecuted: persisted.interactionsExecuted,
    interactionsSkippedSafety: null,
    formsFound: persisted.formsFound,
    formsTested: persisted.formsTested,
    scenariosConfigured: persisted.flowsCompleted + persisted.flowsFailed,
    scenariosCompleted: persisted.flowsCompleted,
    scenariosFailed: persisted.flowsFailed,
    blockedAuthentication: 0,
    blockedCaptchaMfa: 0,
    devices: Array.isArray(persisted.devices) ? persisted.devices : [],
    viewports: Array.isArray(persisted.viewports) ? persisted.viewports : [],
    durationMs: persisted.durationSeconds == null ? 0 : persisted.durationSeconds * 1_000,
    functionalCoveragePercent: persisted.coveragePercent
  };
}

type MetricRating = { label: string; tone: "good" | "warning" | "poor" };
type MetricDescription = { key: string; label: string; value: string; explanation: string; rating: MetricRating | null };

const metricDefinitions: Record<string, { label: string; explanation: string; good?: number; poor?: number; unit?: "ms" | "raw" }> = {
  firstContentfulPaint: { label: "First Contentful Paint (FCP)", explanation: "Tempo até o primeiro conteúdo visível.", good: 1_800, poor: 3_000, unit: "ms" },
  largestContentfulPaint: { label: "Largest Contentful Paint (LCP)", explanation: "Tempo até o maior conteúdo principal ficar visível.", good: 2_500, poor: 4_000, unit: "ms" },
  interactionToNextPaint: { label: "Interaction to Next Paint (INP)", explanation: "Latência percebida ao interagir com a página.", good: 200, poor: 500, unit: "ms" },
  totalBlockingTime: { label: "Total Blocking Time (TBT)", explanation: "Tempo em que a thread principal ficou bloqueada.", good: 200, poor: 600, unit: "ms" },
  cumulativeLayoutShift: { label: "Cumulative Layout Shift (CLS)", explanation: "Estabilidade visual durante o carregamento.", good: 0.1, poor: 0.25, unit: "raw" },
  speedIndex: { label: "Speed Index", explanation: "Velocidade com que o conteúdo visual é preenchido.", good: 3_400, poor: 5_800, unit: "ms" },
  timeToInteractive: { label: "Time to Interactive", explanation: "Tempo estimado até a página responder de forma consistente.", unit: "ms" },
  totalByteWeight: { label: "Peso total transferido", explanation: "Volume de recursos baixados durante a medição." },
  requestCount: { label: "Requisições", explanation: "Quantidade de requisições observadas pelo Lighthouse." }
};

export function describeLighthouseMetric(key: string, rawValue: unknown): MetricDescription {
  const definition = metricDefinitions[key];
  const value = rawValue == null ? "" : String(rawValue);
  const label = definition?.label || key.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());
  const explanation = definition?.explanation || "Métrica técnica coletada durante a execução do Lighthouse.";
  let rating: MetricRating | null = null;

  if (definition?.good != null && definition.poor != null) {
    const numericValue = metricNumericValue(value, definition.unit || "raw");
    if (numericValue != null) {
      rating = numericValue <= definition.good
        ? { label: "Bom", tone: "good" }
        : numericValue <= definition.poor
          ? { label: "Precisa melhorar", tone: "warning" }
          : { label: "Ruim", tone: "poor" };
    }
  }

  return { key, label, value, explanation, rating };
}

function metricNumericValue(value: string, unit: "ms" | "raw") {
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  if (!Number.isFinite(number)) return null;
  if (unit === "ms" && /\bs\b/i.test(value) && !/\bms\b/i.test(value)) return number * 1_000;
  return number;
}

function comparisonPrevious(
  explicitPrevious: number | null | undefined,
  current: number | null | undefined,
  delta: number | null | undefined
) {
  if (typeof explicitPrevious === "number") return explicitPrevious;
  if (typeof current === "number" && typeof delta === "number") return current - delta;
  return null;
}

function formatComparisonValue(value: number | null | undefined, suffix: string) {
  return typeof value === "number" ? `${value}${suffix}` : "N/D";
}

function humanizeAction(action: string) {
  const labels: Record<string, string> = {
    authenticate: "Autenticação",
    navigate: "Navegação",
    click: "Clique",
    fill: "Preenchimento",
    select: "Seleção",
    check: "Marcação",
    assert: "Verificação",
    press: "Tecla pressionada"
  };
  return labels[action.toLowerCase()] || humanizeLabel(action);
}

function validationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    AUTOMATICALLY_VALIDATED: "Validado automaticamente",
    VALIDATED_AUTOMATICALLY: "Validado automaticamente",
    PARTIALLY_VALIDATED: "Validado parcialmente",
    VALIDATED_PARTIALLY: "Validado parcialmente",
    NOT_TESTED: "Não testado",
    BLOCKED_AUTHENTICATION: "Bloqueado por autenticação",
    BLOCKED_CAPTCHA_OR_MFA: "Bloqueado por CAPTCHA/MFA",
    BLOCKED_CAPTCHA_MFA: "Bloqueado por CAPTCHA/MFA",
    SKIPPED_FOR_SAFETY: "Não executado por segurança",
    NOT_EXECUTED_SAFETY: "Não executado por segurança",
    FAILED: "Falhou",
    MANUAL_REVIEW_REQUIRED: "Requer validação manual",
    REQUIRES_MANUAL_VALIDATION: "Requer validação manual"
  };
  return labels[status] || humanizeLabel(status);
}

function formatDuration(seconds?: number | null) {
  if (seconds == null) return "Calculando";
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export const executionStages = [
  { ids: ["QUEUED"], label: "Na fila" },
  { ids: ["BOOTING_PIPELINE"], label: "Preparando pipeline" },
  { ids: ["VALIDATING_DOMAIN"], label: "Validando domínio" },
  { ids: ["BOOTING_BROWSER"], label: "Preparando navegador" },
  { ids: ["DISCOVERING_PAGES"], label: "Descobrindo páginas" },
  { ids: ["AUDITING_DESKTOP", "ANALYZING_DESKTOP"], label: "Auditando desktop" },
  { ids: ["RUNNING_AXE"], label: "Analisando acessibilidade" },
  { ids: ["AUDITING_MOBILE", "ANALYZING_MOBILE"], label: "Auditando mobile" },
  { ids: ["RUNNING_SCENARIOS"], label: "Executando fluxos" },
  { ids: ["RUNNING_LIGHTHOUSE"], label: "Executando Lighthouse" },
  { ids: ["CHECKING_NETWORK", "CHECKING_LINKS"], label: "Verificando rede e links" },
  { ids: ["GENERATING_SCREENSHOTS"], label: "Gerando screenshots" },
  { ids: ["CONSOLIDATING_EVIDENCE"], label: "Consolidando evidências" },
  { ids: ["GENERATING_AI"], label: "Gerando análise por IA" },
  { ids: ["GENERATING_REPORT", "BUILDING_JSON"], label: "Gerando dados técnicos" },
  { ids: ["BUILDING_PDF"], label: "Gerando relatório e artefatos" },
  { ids: ["COMPLETED"], label: "Concluída" }
] as const;

export function executionStageIndex(currentStage: string) {
  return executionStages.findIndex((stage) => stage.ids.some((stageId) => stageId === currentStage));
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function feedbackClassName(tone: FeedbackState["tone"]) {
  switch (tone) {
    case "success":
      return "inlineSuccess";
    case "info":
      return "inlineInfo";
    default:
      return "inlineError";
  }
}
