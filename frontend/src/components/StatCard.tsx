import type { LucideIcon } from "lucide-react";

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: LucideIcon;
}) {
  return (
    <article className="statCard">
      <div className="statCardIcon">
        <Icon size={18} />
      </div>
      <span className="statCardTitle">{title}</span>
      <strong className="statCardValue">{value}</strong>
      <span className="statCardSubtitle">{subtitle}</span>
    </article>
  );
}

