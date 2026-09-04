import { AlertTriangle, ArrowLeft, ArrowRight, PlusCircle, Search, SlidersHorizontal } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { auditApi } from "../api/client";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { SectionCard } from "../components/SectionCard";
import { StatusBadge } from "../components/StatusBadge";
import { usePageMeta } from "../hooks/usePageMeta";
import pageStyles from "../styles/dashboard.module.css";
import type { AuditListItem } from "../types";
import { formatDate, translateStage } from "../utils/audit";

const PAGE_SIZE = 8;

export function AuditHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedProjectId = searchParams.get("project");
  const [audits, setAudits] = useState<AuditListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [sortOrder, setSortOrder] = useState("NEWEST");
  const [currentPage, setCurrentPage] = useState(1);
  const deferredQuery = useDeferredValue(query);

  usePageMeta(
    "Histórico de Auditorias | AI Web Auditor",
    "Explore o histórico de auditorias, filtre por status e reabra relatórios antigos com rapidez."
  );

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError("");

    auditApi
      .list({ signal: controller.signal })
      .then(setAudits)
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }

        setError(requestError instanceof Error ? requestError.message : "Falha ao carregar histórico.");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredQuery, sortOrder, statusFilter]);

  const filteredAudits = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return audits.filter((audit) => {
      const matchesStatus = statusFilter === "ALL" || audit.status === statusFilter;
      const matchesQuery = normalizedQuery.length === 0 || audit.url.toLowerCase().includes(normalizedQuery);
      const matchesProject = !requestedProjectId || audit.projectId === requestedProjectId;
      return matchesStatus && matchesQuery && matchesProject;
    });
  }, [audits, deferredQuery, requestedProjectId, statusFilter]);

  const sortedAudits = useMemo(() => {
    const ordered = [...filteredAudits];

    switch (sortOrder) {
      case "OLDEST":
        return ordered.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
      case "SCORE_DESC":
        return ordered.sort((left, right) => (right.overallScore ?? -1) - (left.overallScore ?? -1));
      case "SCORE_ASC":
        return ordered.sort((left, right) => (left.overallScore ?? 101) - (right.overallScore ?? 101));
      case "ISSUES_DESC":
        return ordered.sort((left, right) => right.totalIssues - left.totalIssues);
      default:
        return ordered.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    }
  }, [filteredAudits, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(sortedAudits.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const visibleAudits = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return sortedAudits.slice(start, start + PAGE_SIZE);
  }, [currentPage, sortedAudits]);

  const statusCounts = useMemo(
    () =>
      audits.reduce<Record<string, number>>((counts, audit) => {
        counts[audit.status] = (counts[audit.status] || 0) + 1;
        return counts;
      }, {}),
    [audits]
  );

  const selectedProjectName = requestedProjectId
    ? audits.find((audit) => audit.projectId === requestedProjectId)?.projectName || "projeto selecionado"
    : null;
  const filtersActive = Boolean(requestedProjectId) || query.trim().length > 0 || statusFilter !== "ALL" || sortOrder !== "NEWEST";

  function clearFilters() {
    setQuery("");
    setStatusFilter("ALL");
    setSortOrder("NEWEST");
    if (requestedProjectId) {
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("project");
      setSearchParams(nextSearchParams, { replace: true });
    }
  }

  if (loading) {
    return <PageSkeleton message="Carregando histórico de auditorias..." />;
  }

  return (
    <div className={pageStyles.page}>
      <div className={pageStyles.heroRow}>
        <div className={pageStyles.heroCopy}>
          <span className="eyebrow">Histórico operacional</span>
          <h2>Filtros rápidos, ordenação útil e reabertura imediata dos relatórios.</h2>
          <p>
            Encontre auditorias por URL, destaque scores mais altos ou execuções com mais achados e navegue por páginas
            sem perder o contexto da fila.
          </p>
          {selectedProjectName ? <div className="inlineInfo">Filtrando execuções de <strong>{selectedProjectName}</strong>.</div> : null}
          <div className={pageStyles.heroActions}>
            <Link className="primaryButton" to="/audits/new">
              <PlusCircle size={16} />
              Nova auditoria
            </Link>
          </div>
        </div>

        <article className={pageStyles.heroPanel} aria-label="Resumo do histórico">
          <span className={pageStyles.heroPanelLabel}>{filtersActive ? "Resultados atuais" : "Base histórica"}</span>
          <strong className={pageStyles.heroPanelValue}>{sortedAudits.length}</strong>
          <div className={pageStyles.heroPanelMeta}>
            <span className="badge badgeCOMPLETED">{statusCounts.COMPLETED || 0} concluídas</span>
            <span>{statusCounts.RUNNING || 0} em execução</span>
          </div>
          <p className={pageStyles.heroPanelUrl}>
            {filtersActive
              ? "Os filtros aplicados reduzem a lista para o conjunto mais relevante agora."
              : "A listagem permanece pronta para reabertura de relatórios e comparação histórica."}
          </p>
        </article>
      </div>

      <div className={pageStyles.summaryGrid}>
        <article className={pageStyles.summaryCard}>
          <span>Total registrado</span>
          <strong>{audits.length}</strong>
          <p>Base completa de auditorias disponíveis para consulta.</p>
        </article>
        <article className={pageStyles.summaryCard}>
          <span>Concluídas</span>
          <strong>{statusCounts.COMPLETED || 0}</strong>
          <p>{statusCounts.RUNNING ? `${statusCounts.RUNNING} ainda em execução.` : "Nenhuma execução ativa agora."}</p>
        </article>
        <article className={pageStyles.summaryCard}>
          <span>Falhas e pendências</span>
          <strong>{(statusCounts.FAILED || 0) + (statusCounts.PENDING || 0)}</strong>
          <p>Use os filtros para priorizar retomadas e investigações.</p>
        </article>
      </div>

      <SectionCard title="Histórico de auditorias" subtitle="filtre por status, ordene por impacto e navegue por páginas">
        <div className={pageStyles.toolbar}>
          <label className="controlInput">
            <Search size={16} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por URL"
              aria-label="Buscar auditoria por URL"
              aria-describedby="history-results-summary"
            />
          </label>

          <label className="selectInput">
            <SlidersHorizontal size={16} />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filtrar por status"
              aria-describedby="history-results-summary"
            >
              <option value="ALL">Todos os status</option>
              <option value="PENDING">Em fila</option>
              <option value="RUNNING">Processando</option>
              <option value="COMPLETED">Concluída</option>
              <option value="FAILED">Falhou</option>
              <option value="CANCELLED">Cancelada</option>
            </select>
          </label>

          <label className="selectInput">
            <SlidersHorizontal size={16} />
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              aria-label="Ordenar auditorias"
              aria-describedby="history-results-summary"
            >
              <option value="NEWEST">Mais recentes</option>
              <option value="OLDEST">Mais antigas</option>
              <option value="SCORE_DESC">Maior score</option>
              <option value="SCORE_ASC">Menor score</option>
              <option value="ISSUES_DESC">Mais achados</option>
            </select>
          </label>
        </div>

        <div className={pageStyles.toolbarMeta} id="history-results-summary" aria-live="polite">
          <span>
            {sortedAudits.length === audits.length
              ? `${audits.length} auditorias disponíveis`
              : `${sortedAudits.length} de ${audits.length} auditorias correspondem aos filtros atuais`}
          </span>
          {filtersActive ? (
            <button
              className="secondaryButton"
              onClick={clearFilters}
              type="button"
            >
              Limpar filtros
            </button>
          ) : null}
        </div>

        {error ? <div className="inlineError">{error}</div> : null}

        {audits.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title={error ? "Não foi possível carregar o histórico" : "Seu histórico ainda está vazio"}
            description={
              error
                ? "A lista de auditorias não pôde ser carregada agora. Tente novamente em instantes."
                : "Crie a primeira auditoria para começar a comparar scores, status e evolução técnica."
            }
            action={
              error ? (
                <button className="secondaryButton" onClick={() => window.location.reload()} type="button">
                  Recarregar página
                </button>
              ) : (
                <Link className="secondaryButton" to="/audits/new">
                  Criar primeira auditoria
                </Link>
              )
            }
          />
        ) : null}

        {audits.length > 0 ? (
          <div className={pageStyles.historyTable} role="table" aria-label="Tabela de histórico de auditorias">
            <div className={pageStyles.historyHead} role="row">
              <span role="columnheader">URL</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Score</span>
              <span role="columnheader">Criada em</span>
            </div>

            {visibleAudits.map((audit) => (
              <Link key={audit.id} className={pageStyles.historyRow} role="row" to={`/audits/${audit.id}`}>
                <span role="cell">
                  <small className={pageStyles.historyCellLabel}>URL</small>
                  <strong>{audit.url}</strong>
                  <small>{audit.status === "COMPLETED" ? "Relatório disponível" : translateStage(audit.currentStage)}</small>
                </span>
                <span role="cell">
                  <small className={pageStyles.historyCellLabel}>Status</small>
                  <StatusBadge status={audit.status} />
                </span>
                <span role="cell">
                  <small className={pageStyles.historyCellLabel}>Score</small>
                  <strong className={pageStyles.historyScore}>{audit.overallScore != null ? `${audit.overallScore}/100` : `${audit.progressPercent}%`}</strong>
                  <small>{pluralizeIssues(audit.totalIssues)}</small>
                </span>
                <span role="cell">
                  <small className={pageStyles.historyCellLabel}>Criada em</small>
                  <strong>{formatDate(audit.createdAt)}</strong>
                  <small>{pluralizeCriticalIssues(audit.criticalIssues)}</small>
                </span>
              </Link>
            ))}

            {sortedAudits.length === 0 ? (
              <EmptyState
                compact
                icon={Search}
                title="Nenhuma auditoria corresponde aos filtros atuais"
                description="Ajuste a busca, troque o status ou remova a ordenação para ampliar os resultados."
                action={
                  <button
                    className="secondaryButton"
                    onClick={clearFilters}
                    type="button"
                  >
                    Limpar filtros
                  </button>
                }
              />
            ) : null}
          </div>
        ) : null}

        {sortedAudits.length > 0 ? (
          <div className={pageStyles.pagination}>
            <div className={pageStyles.paginationSummary}>
              <strong>
                Página {currentPage} de {totalPages}
              </strong>
              <span>{PAGE_SIZE} itens por página</span>
            </div>
            <div className={pageStyles.paginationActions}>
              <button
                className="secondaryButton"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                type="button"
              >
                <ArrowLeft size={16} />
                Anterior
              </button>
              <button
                className="secondaryButton"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                type="button"
              >
                Próxima
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

function pluralizeIssues(total: number) {
  return total === 1 ? "1 achado" : `${total} achados`;
}

function pluralizeCriticalIssues(total: number) {
  return total === 1 ? "1 crítico" : `${total} críticos`;
}
