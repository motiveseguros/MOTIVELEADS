import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import {
  eventLabels,
  statusLabels,
  type LeadEvent,
  type Employee,
  type LeadStatus,
} from "@/domain/types";
import { dateTime } from "@/lib/utils";
export function HistoryList({
  events,
  employees,
  showLead = false,
}: {
  events: LeadEvent[];
  employees: Employee[];
  showLead?: boolean;
}) {
  if (!events.length)
    return (
      <div className="empty">
        <h3>Sem movimentações</h3>
        <p>As ações realizadas nos leads serão registradas aqui.</p>
      </div>
    );
  return (
    <ol className="timeline">
      {events.map((event) => {
        const data =
          event.data &&
          typeof event.data === "object" &&
          !Array.isArray(event.data)
            ? event.data
            : {};
        const employee = (id: unknown) =>
          employees.find((e) => e.id === id)?.name ?? "Outro funcionário";
        return (
          <li key={event.id}>
            <span className="timeline-icon">
              <Check size={13} />
            </span>
            <div>
              <strong>{eventLabels[event.action] ?? event.action}</strong>
              <p>
                {typeof data.actor_name === "string"
                  ? data.actor_name
                  : (employees.find((e) => e.profile_id === event.actor_id)
                      ?.name ?? "Equipe Motive")}{" "}
                · {dateTime(event.created_at)}
              </p>
              {typeof data.status === "string" && (
                <p>
                  Status:{" "}
                  {statusLabels[data.status as LeadStatus] ?? data.status}
                </p>
              )}
              {typeof data.employee_id === "string" && (
                <p>
                  {data.previous_employee_id && (
                    <>
                      {typeof data.previous_employee_name === "string"
                        ? data.previous_employee_name
                        : employee(data.previous_employee_id)}{" "}
                      <ArrowRight size={12} className="inline" />{" "}
                    </>
                  )}
                  {typeof data.employee_name === "string"
                    ? data.employee_name
                    : employee(data.employee_id)}
                </p>
              )}
              {showLead && (
                <Link className="text-link" href={"/leads/" + event.lead_id}>
                  Abrir lead · {event.lead_id.slice(0, 8)}
                </Link>
              )}
              {[
                "CONVERTED_FROM_CONVERSATION",
                "CONVERTED_FROM_WHATSAPP_INTAKE",
              ].includes(event.action) &&
                typeof data.conversation_id === "string" && (
                  <Link
                    className="text-link"
                    href={"/conversations/" + data.conversation_id}
                  >
                    Abrir conversa de origem →
                  </Link>
                )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
