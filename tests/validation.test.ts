import { describe, it, expect } from "vitest";
import {
  leadSchema,
  employeeSchema,
  availabilitySchema,
} from "../src/domain/validation";
const id = "a62cd78f-1367-4f31-9026-8239d43645af";
describe("validação de entradas no servidor", () => {
  it("normaliza nome e UF e aceita campos opcionais vazios", () => {
    const result = leadSchema.parse({
      name: "  Cliente teste  ",
      phone: "11999999999",
      email: "",
      city: "",
      state: "sp",
      product_id: id,
      notes: "",
    });
    expect(result.name).toBe("Cliente teste");
    expect(result.state).toBe("SP");
  });
  it.each([
    { phone: "abc" },
    { email: "invalido" },
    { product_id: "x" },
    { notes: "x".repeat(5001) },
  ])("recusa lead inválido", (patch) => {
    expect(
      leadSchema.safeParse({
        name: "Cliente",
        phone: "11999999999",
        email: "",
        city: "",
        state: "",
        product_id: id,
        notes: "",
        ...patch,
      }).success,
    ).toBe(false);
  });
  it("exige senha com 12 caracteres e ao menos uma especialidade", () => {
    expect(
      employeeSchema.safeParse({
        name: "Agente",
        email: "agent@example.com",
        phone: "",
        password: "123",
        products: [],
      }).success,
    ).toBe(false);
  });
  it("não aceita status de disponibilidade inventado", () => {
    expect(
      availabilitySchema.safeParse({ employee_id: id, availability: "ONLINE" })
        .success,
    ).toBe(false);
  });
});
