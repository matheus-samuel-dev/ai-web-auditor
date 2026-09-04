export function ProgressBar({
  value,
  label,
  hint
}: {
  value: number;
  label: string;
  hint?: string;
}) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div className="progressCard" aria-live="polite">
      <div className="progressHead">
        <div>
          <strong>{label}</strong>
          {hint ? <span>{hint}</span> : null}
        </div>
        <b>{safeValue}%</b>
      </div>
      <div
        className="progressTrack"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safeValue}
        aria-label={label}
      >
        <div className="progressFill" style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}
