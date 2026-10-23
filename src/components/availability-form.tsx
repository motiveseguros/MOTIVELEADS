import { ActionForm } from "./action-form";
import { SelectField } from "./fields";
import { setAvailability } from "@/app/actions/employees";
import {
  availabilityValues,
  availabilityLabels,
  type Employee,
} from "@/domain/types";
export function AvailabilityForm({ employee }: { employee: Employee }) {
  return (
    <ActionForm action={setAvailability} label="Atualizar disponibilidade">
      <input type="hidden" name="employee_id" value={employee.id} />
      <SelectField
        name="availability"
        label="Disponibilidade"
        defaultValue={employee.availability}
      >
        {availabilityValues.map((v) => (
          <option key={v} value={v}>
            {availabilityLabels[v]}
          </option>
        ))}
      </SelectField>
    </ActionForm>
  );
}
