import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
let db: PGlite;
const adminId = randomUUID(),
  agentId = randomUUID(),
  otherId = randomUUID();
let adminEmployee: string,
  agentEmployee: string,
  otherEmployee: string,
  product: string,
  otherProduct: string;
async function asUser<T>(id: string, sql: string, args: unknown[] = []) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  try {
    return await db.query<T>(sql, args);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}
const admin = <T>(sql: string, args: unknown[] = []) =>
  asUser<T>(adminId, sql, args);
const agent = <T>(sql: string, args: unknown[] = []) =>
  asUser<T>(agentId, sql, args);
async function createLead() {
  return (
    await admin<{ id: string }>(
      "select public.create_lead('Lead teste','11999999999','','São Paulo','SP',$1,'Teste') as id",
      [product],
    )
  ).rows[0].id;
}
async function assign(
  id: string,
  employee = agentEmployee,
  expected: string | null = null,
) {
  await admin("select public.assign_lead($1,$2,$3)", [id, employee, expected]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const file of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  const products = await db.query<{ id: string }>(
    "select id from public.products order by name",
  );
  product = products.rows[0].id;
  otherProduct = products.rows[1].id;
  for (const [id, name, role] of [
    [adminId, "Admin", "ADMIN"],
    [agentId, "Agente Um", "AGENT"],
    [otherId, "Agente Dois", "AGENT"],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    const r = await db.query<{ id: string }>(
      "select public.provision_employee($1,$2,$3,'',$4,$5) as id",
      [id, name, id + "@example.com", [product], role],
    );
    if (id === adminId) adminEmployee = r.rows[0].id;
    else if (id === agentId) agentEmployee = r.rows[0].id;
    else otherEmployee = r.rows[0].id;
  }
});
beforeEach(async () => {
  await db.exec(
    "update public.employees set active=true,availability='AVAILABLE';update public.products set active=true",
  );
  await db.query(
    "insert into public.employee_products(employee_id,product_id) values($1,$3),($2,$3) on conflict do nothing",
    [agentEmployee, otherEmployee, product],
  );
});
afterAll(async () => {
  await db.close();
});
describe("permissões e RLS reais", () => {
  it("admin cria lead e auditoria com autor na mesma operação", async () => {
    const id = await createLead();
    const r = await admin<{
      actor_id: string;
      action: string;
      data: { actor_name: string };
    }>("select * from public.lead_events where lead_id=$1", [id]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      actor_id: adminId,
      action: "CREATED",
      data: { actor_name: "Admin" },
    });
  });
  it("agente não cria leads", async () => {
    await expect(
      agent(
        "select public.create_lead('Indevido','11999999999','','','',$1,'')",
        [product],
      ),
    ).rejects.toThrow("administrativo");
  });
  it("agente vê só seu lead e histórico; outro agente não acessa por UUID", async () => {
    const own = await createLead(),
      other = await createLead();
    await assign(own);
    await assign(other, otherEmployee);
    expect(
      (await agent("select id from public.leads where id=$1", [own])).rows,
    ).toHaveLength(1);
    expect(
      (await agent("select id from public.leads where id=$1", [other])).rows,
    ).toHaveLength(0);
    expect(
      (
        await agent("select id from public.lead_events where lead_id=$1", [
          other,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("agente não lista outros funcionários", async () => {
    const r = await agent<{ id: string }>("select id from public.employees");
    expect(r.rows).toEqual([{ id: agentEmployee }]);
  });
  it("escrita direta de status, perfil e histórico é negada", async () => {
    const id = await createLead();
    await expect(
      agent("update public.leads set status='CLOSED_WON' where id=$1", [id]),
    ).rejects.toThrow("permission denied");
    await expect(
      agent("update public.profiles set role='ADMIN' where id=$1", [agentId]),
    ).rejects.toThrow("permission denied");
    await expect(
      agent(
        "insert into public.lead_events(lead_id,actor_id,action) values($1,$2,'FAKE')",
        [id, agentId],
      ),
    ).rejects.toThrow("permission denied");
  });
  it("agente não provisiona acessos ou modifica catálogo", async () => {
    await expect(
      agent(
        "select public.provision_employee($1,'Ataque','a@example.com','',$2,'ADMIN')",
        [randomUUID(), [product]],
      ),
    ).rejects.toThrow("permission denied");
    await expect(
      agent("select public.save_product(null,'Ataque',true)"),
    ).rejects.toThrow("administrativo");
  });
  it("admin também não pode apagar histórico diretamente", async () => {
    await expect(admin("delete from public.lead_events")).rejects.toThrow(
      "permission denied",
    );
  });
  it("anônimo não tem leitura nem execução", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from public.leads")).rejects.toThrow(
        "permission denied",
      );
      await expect(
        db.query("select public.save_product(null,'Teste',true)"),
      ).rejects.toThrow("permission denied");
    } finally {
      await db.exec("reset role");
    }
  });
  it("inativo perde leitura e execução mesmo com sessão válida", async () => {
    await db.query("update public.employees set active=false where id=$1", [
      agentEmployee,
    ]);
    expect((await agent("select * from public.leads")).rows).toHaveLength(0);
    await expect(
      agent("select public.set_availability($1,'AVAILABLE')", [agentEmployee]),
    ).rejects.toThrow("Acesso negado");
  });
});
describe("atribuição e transferência", () => {
  it("atribui funcionário compatível com responsável e data", async () => {
    const id = await createLead();
    await assign(id);
    const r = await admin<{
      status: string;
      assigned_employee_id: string;
      assigned_at: string;
    }>("select * from public.leads where id=$1", [id]);
    expect(r.rows[0]).toMatchObject({
      status: "ASSIGNED",
      assigned_employee_id: agentEmployee,
    });
    expect(r.rows[0].assigned_at).toBeTruthy();
  });
  it.each(["BUSY", "AWAY", "OFFLINE"])(
    "recusa funcionário %s sem gerar histórico",
    async (availability) => {
      const id = await createLead();
      await admin("select public.set_availability($1,$2)", [
        agentEmployee,
        availability,
      ]);
      await expect(assign(id)).rejects.toThrow("disponível");
      expect(
        (await admin("select * from public.lead_events where lead_id=$1", [id]))
          .rows,
      ).toHaveLength(1);
    },
  );
  it("recusa funcionário inativo", async () => {
    const id = await createLead();
    await db.query("update public.employees set active=false where id=$1", [
      agentEmployee,
    ]);
    await expect(assign(id)).rejects.toThrow("disponível");
  });
  it("recusa especialidade incompatível", async () => {
    const id = await createLead();
    await db.query(
      "delete from public.employee_products where employee_id=$1",
      [agentEmployee],
    );
    await expect(assign(id)).rejects.toThrow("não atende");
  });
  it("recusa atribuição feita por agente", async () => {
    const id = await createLead();
    await expect(
      agent("select public.assign_lead($1,$2,null)", [id, agentEmployee]),
    ).rejects.toThrow("administrativo");
  });
  it("detecta operação com responsável desatualizado", async () => {
    const id = await createLead();
    await assign(id);
    await expect(assign(id, otherEmployee)).rejects.toThrow("outra operação");
  });
  it("transferência reinicia status e remove acesso do antigo responsável", async () => {
    const id = await createLead();
    await assign(id);
    await agent("select public.transition_lead($1,'IN_PROGRESS','ASSIGNED')", [
      id,
    ]);
    await assign(id, otherEmployee, agentEmployee);
    expect(
      (await agent("select * from public.leads where id=$1", [id])).rows,
    ).toHaveLength(0);
    const r = await admin<{ status: string }>(
      "select status from public.leads where id=$1",
      [id],
    );
    expect(r.rows[0].status).toBe("ASSIGNED");
    expect(
      (
        await admin(
          "select * from public.lead_events where lead_id=$1 and action='TRANSFERRED'",
          [id],
        )
      ).rows,
    ).toHaveLength(1);
  });
});
describe("transições de atendimento", () => {
  it.each(["CLOSED_WON", "CLOSED_LOST"])(
    "responsável inicia e finaliza como %s",
    async (status) => {
      const id = await createLead();
      await assign(id);
      await agent(
        "select public.transition_lead($1,'IN_PROGRESS','ASSIGNED')",
        [id],
      );
      await agent("select public.transition_lead($1,$2,'IN_PROGRESS')", [
        id,
        status,
      ]);
      const r = await agent<{ status: string }>(
        "select status from public.leads where id=$1",
        [id],
      );
      expect(r.rows[0].status).toBe(status);
      expect(
        (await agent("select * from public.lead_events where lead_id=$1", [id]))
          .rows,
      ).toHaveLength(4);
    },
  );
  it("recusa pular início, voltar status, reabrir e reatribuir fechado", async () => {
    const id = await createLead();
    await assign(id);
    await expect(
      agent("select public.transition_lead($1,'CLOSED_WON','ASSIGNED')", [id]),
    ).rejects.toThrow("inválida");
    await agent("select public.transition_lead($1,'IN_PROGRESS','ASSIGNED')", [
      id,
    ]);
    await expect(
      agent("select public.transition_lead($1,'ASSIGNED','IN_PROGRESS')", [id]),
    ).rejects.toThrow("inválida");
    await agent(
      "select public.transition_lead($1,'CLOSED_WON','IN_PROGRESS')",
      [id],
    );
    await expect(
      agent("select public.transition_lead($1,'IN_PROGRESS','CLOSED_WON')", [
        id,
      ]),
    ).rejects.toThrow("inválida");
    await expect(assign(id, otherEmployee, agentEmployee)).rejects.toThrow(
      "encerrado",
    );
  });
  it("recusa transição de lead de outro agente", async () => {
    const id = await createLead();
    await assign(id, otherEmployee);
    await expect(
      agent("select public.transition_lead($1,'IN_PROGRESS','ASSIGNED')", [id]),
    ).rejects.toThrow("acesso negado");
  });
  it("detecta status desatualizado", async () => {
    const id = await createLead();
    await assign(id);
    await agent("select public.transition_lead($1,'IN_PROGRESS','ASSIGNED')", [
      id,
    ]);
    await expect(
      agent("select public.transition_lead($1,'CLOSED_WON','ASSIGNED')", [id]),
    ).rejects.toThrow("outra operação");
  });
});
describe("disponibilidade e funcionários", () => {
  it.each(["AVAILABLE", "BUSY", "AWAY", "OFFLINE"])(
    "agente define disponibilidade %s",
    async (value) => {
      await agent("select public.set_availability($1,$2)", [
        agentEmployee,
        value,
      ]);
      const r = await agent<{ availability: string }>(
        "select availability from public.employees where id=$1",
        [agentEmployee],
      );
      expect(r.rows[0].availability).toBe(value);
    },
  );
  it("agente não muda disponibilidade alheia ou cadastro", async () => {
    await expect(
      agent("select public.set_availability($1,'BUSY')", [otherEmployee]),
    ).rejects.toThrow("Acesso negado");
    await expect(
      agent("select public.update_employee($1,'Fraude','',true,$2)", [
        otherEmployee,
        [product],
      ]),
    ).rejects.toThrow("administrativo");
  });
  it("admin muda disponibilidade de outro funcionário", async () => {
    await admin("select public.set_availability($1,'AWAY')", [otherEmployee]);
    expect(
      (
        await db.query<{ availability: string }>(
          "select availability from public.employees where id=$1",
          [otherEmployee],
        )
      ).rows[0].availability,
    ).toBe("AWAY");
  });
  it("bloqueia remoção de especialidade e desativação com leads abertos", async () => {
    const id = await createLead();
    await assign(id);
    await expect(
      admin("select public.update_employee($1,'Agente Um','',false,$2)", [
        agentEmployee,
        [product],
      ]),
    ).rejects.toThrow("Transfira");
    await expect(
      admin("select public.update_employee($1,'Agente Um','',true,$2)", [
        agentEmployee,
        [otherProduct],
      ]),
    ).rejects.toThrow("Transfira");
  });
  it("não permite desativar o próprio administrador", async () => {
    await expect(
      admin("select public.update_employee($1,'Admin','',false,$2)", [
        adminEmployee,
        [product],
      ]),
    ).rejects.toThrow("próprio acesso");
  });
  it("produto novo funciona sem alterar código; inativo não recebe leads", async () => {
    const id = (
      await admin<{ id: string }>(
        "select public.save_product(null,'Produto futuro',true) as id",
      )
    ).rows[0].id;
    await admin(
      "select public.create_lead('Novo produto','11999999999','','','',$1,'')",
      [id],
    );
    await admin("select public.save_product($1,'Produto futuro',false)", [id]);
    await expect(
      admin(
        "select public.create_lead('Novo produto','11999999999','','','',$1,'')",
        [id],
      ),
    ).rejects.toThrow("indisponível");
  });
});
