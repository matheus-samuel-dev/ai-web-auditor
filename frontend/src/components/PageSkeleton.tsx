export function PageSkeleton({ message }: { message: string }) {
  return (
    <div className="pageSkeleton" role="status" aria-live="polite">
      <span className="visuallyHidden">Carregando conteúdo</span>
      <div className="skeletonHero">
        <div className="skeletonLine wide" />
        <div className="skeletonLine medium" />
      </div>
      <div className="skeletonGrid">
        <div className="skeletonCard" />
        <div className="skeletonCard" />
        <div className="skeletonCard" />
      </div>
      <span className="skeletonMessage">{message}</span>
    </div>
  );
}
