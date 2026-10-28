import { describe, it, expect } from "vitest";
import { assignmentCandidates } from "../src/domain/assignment";
import type {
  Employee,
  EmployeeProduct,
  Availability,
} from "../src/domain/types";
function employee(
  id: string,
  name: string,
  availability: Availability,
  active = true,
): Employee {
  return {
    id,
    name,
    availability,
    active,
    profile_id: id,
    email: id + "@example.com",
    phone: "",
    created_at: "",
    updated_at: "",
  };
}
describe("opções de atribuição na interface", () => {
  const employees = [
    employee("busy", "Ana", "BUSY"),
    employee("offline", "Bruno", "OFFLINE"),
    employee("available2", "Zélia", "AVAILABLE"),
    employee("away", "Caio", "AWAY"),
    employee("available1", "Dora", "AVAILABLE"),
    employee("inactive", "Eva", "AVAILABLE", false),
    employee("incompatible", "Fábio", "AVAILABLE"),
    employee("current", "Gabriel", "AVAILABLE"),
  ];
  const specialties: EmployeeProduct[] = employees
    .filter((e) => e.id !== "incompatible")
    .map((e) => ({ employee_id: e.id, product_id: "product" }));
  it("lista todos os status operacionais, prioriza AVAILABLE e ordena nomes", () => {
    expect(
      assignmentCandidates(employees, specialties, "product", "current").map(
        (e) => e.id,
      ),
    ).toEqual(["available1", "available2", "busy", "offline", "away"]);
  });
  it("exclui inativo, incompatível e responsável atual", () => {
    const ids = assignmentCandidates(
      employees,
      specialties,
      "product",
      "current",
    ).map((e) => e.id);
    expect(ids).not.toContain("inactive");
    expect(ids).not.toContain("incompatible");
    expect(ids).not.toContain("current");
  });
  it("não oferece destinos sem especialidade no produto solicitado", () => {
    expect(
      assignmentCandidates(employees, specialties, "other-product", null),
    ).toEqual([]);
  });
});
