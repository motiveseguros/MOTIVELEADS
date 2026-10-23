import { z } from "zod";
import { availabilityValues, statusValues } from "./types";
const id = z.uuid();
const name = z
  .string()
  .trim()
  .min(2, "Informe ao menos 2 caracteres.")
  .max(120);
const optionalEmail = z.union([z.email().max(254), z.literal("")]);
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(128),
});
export const leadSchema = z.object({
  name,
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{8,25}$/, "Informe um telefone válido."),
  email: optionalEmail,
  city: z.string().trim().max(120),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2})?$/, "Use a UF com duas letras."),
  product_id: id,
  notes: z.string().max(5000),
});
export const employeeSchema = z.object({
  name,
  email: z.email().max(254).toLowerCase(),
  phone: z.string().max(25),
  password: z.string().min(12, "Use pelo menos 12 caracteres.").max(128),
  products: z.array(id).min(1, "Escolha uma especialidade.").max(100),
});
export const employeeEditSchema = employeeSchema
  .omit({ email: true, password: true })
  .extend({ id, active: z.boolean() });
export const assignmentSchema = z.object({
  lead_id: id,
  employee_id: id,
  expected_employee_id: z.union([id, z.literal("")]),
});
export const transitionSchema = z.object({
  lead_id: id,
  status: z.enum(statusValues),
  expected_status: z.enum(statusValues),
});
export const availabilitySchema = z.object({
  employee_id: id,
  availability: z.enum(availabilityValues),
});
export const productSchema = z.object({
  id: z.union([id, z.literal("")]),
  name: z.string().trim().min(2).max(80),
  active: z.boolean(),
});
export type ActionState = { error?: string; success?: string };
