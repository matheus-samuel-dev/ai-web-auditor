export function translateStatus(status: string) {
  switch (status) {
    case "PENDING":
      return "Em fila";
    case "RUNNING":
      return "Processando";
    case "COMPLETED":
      return "Concluída";
    case "FAILED":
      return "Falhou";
    case "CANCELLED":
      return "Cancelada";
    default:
      return status;
  }
}

export function translateStage(stage?: string | null) {
  switch (stage) {
    case "QUEUED":
      return "Na fila";
    case "BOOTING_PIPELINE":
      return "Preparando pipeline";
    case "BOOTING_BROWSER":
      return "Preparando navegador";
    case "VALIDATING_DOMAIN":
      return "Validando domínio";
    case "DISCOVERING_PAGES":
      return "Descobrindo páginas";
    case "AUDITING_DESKTOP":
      return "Auditando desktop";
    case "AUDITING_MOBILE":
      return "Auditando mobile";
    case "RUNNING_SCENARIOS":
      return "Executando cenários";
    case "CHECKING_NETWORK":
      return "Verificando rede";
    case "GENERATING_SCREENSHOTS":
      return "Gerando evidências visuais";
    case "CONSOLIDATING_EVIDENCE":
      return "Consolidando evidências";
    case "GENERATING_REPORT":
      return "Gerando relatório";
    case "ANALYZING_DESKTOP":
      return "Gerando captura desktop";
    case "RUNNING_AXE":
      return "Validando acessibilidade";
    case "ANALYZING_MOBILE":
      return "Gerando captura mobile";
    case "RUNNING_LIGHTHOUSE":
      return "Executando Lighthouse";
    case "CHECKING_LINKS":
      return "Verificando links";
    case "GENERATING_AI":
      return "Gerando análise da IA";
    case "BUILDING_PDF":
      return "Gerando PDF";
    case "BUILDING_JSON":
      return "Gerando dados técnicos";
    case "COMPLETED":
      return "Concluída";
    case "FAILED":
      return "Falhou";
    case "CANCELLED":
      return "Cancelada";
    default:
      return "Em processamento";
  }
}

export function formatDate(value?: string | null) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit"
  }).format(new Date(value));
}

export function deltaLabel(delta?: number | null) {
  if (delta == null) {
    return "N/D";
  }
  if (delta === 0) {
    return "0";
  }

  return `${delta > 0 ? "+" : ""}${delta}`;
}

export function deltaTone(delta?: number | null) {
  if (delta == null || delta === 0) {
    return "neutral";
  }
  return delta > 0 ? "positive" : "negative";
}
