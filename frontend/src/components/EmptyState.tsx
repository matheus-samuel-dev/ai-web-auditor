import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "emptyCard emptyCardCompact" : "emptyCard"} role="status">
      <div className="emptyCardIcon">
        <Icon size={compact ? 18 : 20} />
      </div>
      <div className="emptyCardBody">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action ? <div className="emptyCardAction">{action}</div> : null}
    </div>
  );
}
