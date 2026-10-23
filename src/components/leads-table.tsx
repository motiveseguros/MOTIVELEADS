import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";
import type { Lead, Employee, Product } from "@/domain/types";
import { Status } from "./status";
import { dateTime } from "@/lib/utils";
export function LeadsTable({
  leads,
  products,
  employees,
}: {
  leads: Lead[];
  products: Product[];
  employees: Employee[];
}) {
  if (!leads.length)
    return (
      <div className="empty">
        <Inbox size={30} />
        <h3>Nenhum lead por aqui</h3>
        <p>
          Os leads aparecerão aqui assim que forem cadastrados ou atribuídos a
          você.
        </p>
      </div>
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Lead / contato</th>
            <th>Produto</th>
            <th>Status</th>
            <th>Responsável</th>
            <th>Entrada</th>
            <th>
              <span className="sr-only">Abrir</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id}>
              <td>
                <Link className="strong-link" href={"/leads/" + l.id}>
                  {l.name}
                </Link>
                <small>{l.phone}</small>
              </td>
              <td>
                {products.find((p) => p.id === l.product_id)?.name ??
                  "Produto indisponível"}
              </td>
              <td>
                <Status value={l.status} />
              </td>
              <td>
                {employees.find((e) => e.id === l.assigned_employee_id)?.name ??
                  "Aguardando atribuição"}
              </td>
              <td className="tabular-nums muted">{dateTime(l.created_at)}</td>
              <td>
                <Link
                  href={"/leads/" + l.id}
                  aria-label={"Abrir lead de " + l.name}
                >
                  <ArrowUpRight size={18} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
