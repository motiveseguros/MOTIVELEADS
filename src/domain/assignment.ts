import type { Employee, EmployeeProduct } from "./types";
// UI options only. assign_lead remains authoritative for authorization and eligibility.
export function assignmentCandidates(
  employees: Employee[],
  specialties: EmployeeProduct[],
  productId: string,
  currentEmployeeId: string | null,
) {
  return employees
    .filter(
      (employee) =>
        employee.active &&
        employee.id !== currentEmployeeId &&
        specialties.some(
          (s) => s.employee_id === employee.id && s.product_id === productId,
        ),
    )
    .sort(
      (a, b) =>
        Number(b.availability === "AVAILABLE") -
          Number(a.availability === "AVAILABLE") ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
}
