export default function Loading() {
  return (
    <div role="status" aria-label="Carregando painel" className="space-y-6">
      <div className="skeleton h-10 w-64" />
      <div className="grid grid-cols-3 gap-5">
        {[1, 2, 3].map((n) => (
          <div key={n} className="skeleton h-28" />
        ))}
      </div>
      <div className="skeleton h-80" />
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
