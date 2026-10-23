import type { Employee, Product } from "@/domain/types";
import { ActionForm } from "./action-form";
import { Field } from "./fields";
import { createEmployee, updateEmployee } from "@/app/actions/employees";
export function EmployeeForm({
  employee,
  products,
  selected = [],
}: {
  employee?: Employee;
  products: Product[];
  selected?: string[];
}) {
  return (
    <ActionForm
      action={employee ? updateEmployee : createEmployee}
      label={employee ? "Salvar funcionário" : "Cadastrar funcionário"}
    >
      {employee && <input type="hidden" name="id" value={employee.id} />}
      <div className="form-grid">
        <Field
          label="Nome completo *"
          name="name"
          defaultValue={employee?.name}
          required
          minLength={2}
          maxLength={120}
        />
        <Field
          label="Telefone"
          name="phone"
          defaultValue={employee?.phone}
          maxLength={25}
        />
        {!employee && (
          <>
            <Field
              label="E-mail de acesso *"
              name="email"
              type="email"
              required
              maxLength={254}
            />
            <Field
              label="Senha inicial *"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={128}
            />
          </>
        )}
      </div>
      {employee && (
        <p className="muted text-xs">E-mail de acesso: {employee.email}</p>
      )}
      <fieldset className="space-y-3">
        <legend className="text-xs font-semibold mb-3">Especialidades *</legend>
        <div className="check-list">
          {products
            .filter((p) => p.active || selected.includes(p.id))
            .map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  name="products"
                  value={p.id}
                  defaultChecked={selected.includes(p.id)}
                />
                {p.name}
                {!p.active ? " (inativo)" : ""}
              </label>
            ))}
        </div>
      </fieldset>
      {employee ? (
        <label className="check-list">
          <input
            type="checkbox"
            name="active"
            defaultChecked={employee.active}
          />{" "}
          Acesso ativo
        </label>
      ) : (
        <p className="notice bg-secondary">
          O funcionário será criado com perfil AGENT e disponibilidade Offline.
          Compartilhe a senha inicial por um canal seguro.
        </p>
      )}
    </ActionForm>
  );
}
