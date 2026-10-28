"use client";
import { useState } from "react";
import { assignLead } from "@/app/actions/leads";
import { availabilityLabels, type Employee } from "@/domain/types";
import { ActionForm } from "./action-form";
import { SelectField } from "./fields";
import { AvailabilityBadge } from "./status";

type Destination = Pick<Employee, "id" | "name" | "availability">;
export function AssignmentForm({
  leadId,
  currentEmployeeId,
  employees,
}: {
  leadId: string;
  currentEmployeeId: string | null;
  employees: Destination[];
}) {
  const [employeeId, setEmployeeId] = useState("");
  const selected = employees.find((employee) => employee.id === employeeId);
  const transfer = currentEmployeeId !== null;
  return (
    <div onReset={() => setEmployeeId("")}>
      <ActionForm
        action={assignLead}
        label={transfer ? "Transferir lead" : "Atribuir lead"}
      >
        <input type="hidden" name="lead_id" value={leadId} />
        <input
          type="hidden"
          name="expected_employee_id"
          value={currentEmployeeId ?? ""}
        />
        <SelectField
          name="employee_id"
          label="Funcionários compatíveis"
          required
          value={employeeId}
          onChange={(event) => setEmployeeId(event.target.value)}
        >
          <option value="" disabled>
            Selecione o responsável
          </option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name} — {availabilityLabels[employee.availability]}
            </option>
          ))}
        </SelectField>
        {selected && <AvailabilityBadge value={selected.availability} />}
        {selected && selected.availability !== "AVAILABLE" && (
          <div
            key={selected.id + ":" + selected.availability}
            className="notice border border-amber-300 bg-amber-50 text-amber-950"
          >
            <p role="alert">
              {selected.name} está{" "}
              {availabilityLabels[selected.availability].toLocaleLowerCase(
                "pt-BR",
              )}
              . Você pode {transfer ? "transferir" : "atribuir"} este lead, mas
              precisa confirmar sua decisão.
            </p>
            <label className="mt-3 flex items-start gap-2 font-semibold">
              <input
                className="mt-1"
                type="checkbox"
                name="availability_confirmation"
                required
              />
              <span>
                Confirmo {transfer ? "transferir" : "atribuir"} o lead para{" "}
                {selected.name}, mesmo com status{" "}
                {availabilityLabels[selected.availability].toLocaleLowerCase(
                  "pt-BR",
                )}
                .
              </span>
            </label>
          </div>
        )}
        <p className="muted text-xs leading-relaxed">
          Apenas funcionários ativos e com a especialidade deste produto. A
          disponibilidade orienta sua decisão.
          {transfer
            ? " A transferência reinicia o status como Distribuído."
            : ""}
        </p>
      </ActionForm>
    </div>
  );
}
