import Link from "next/link";
export function Pagination({
  page,
  total,
  base,
  params = {},
}: {
  page: number;
  total: number;
  base: string;
  params?: Record<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / 25));
  const href = (n: number) =>
    base + "?" + new URLSearchParams({ ...params, page: String(n) });
  return (
    <div className="pagination">
      <span>
        {total} registros · Página {page} de {pages}
      </span>
      <div>
        {page > 1 && <Link href={href(page - 1)}>Anterior</Link>}
        {page < pages && <Link href={href(page + 1)}>Próxima →</Link>}
      </div>
    </div>
  );
}
