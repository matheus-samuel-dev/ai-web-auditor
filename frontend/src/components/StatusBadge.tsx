import type { AuditStatus, IssueSeverity } from "../types";

export function StatusBadge({ status }: { status: AuditStatus }) {
  const labelMap: Record<AuditStatus, string> = {
    PENDING: "Em fila",
    RUNNING: "Processando",
    COMPLETED: "Concluída",
    FAILED: "Falhou",
    CANCELLED: "Cancelada"
  };

  return <span className={`badge badge${status}`}>{labelMap[status]}</span>;
}

export function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  const labelMap: Record<IssueSeverity, string> = {
    CRITICAL: "Crítico",
    HIGH: "Alto",
    MEDIUM: "Médio",
    LOW: "Baixo",
    OPPORTUNITY: "Oportunidade",
    INFO: "Informativo"
  };

  return <span className={`badge severity${severity}`}>{labelMap[severity]}</span>;
}
