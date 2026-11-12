import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { inboundEvent } from "./fixtures/whatsapp";

let db: PGlite;
const adminId = randomUUID(),
  agentId = randomUUID(),
  otherId = randomUUID();
let product: string,
  agentEmployee: string,
  otherEmployee: string,
  conversationId: string;
const conversionSql =
  "select public.convert_conversation_to_lead($1,$2,$3,$4,$5,$6,$7,$8) as id";

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
function args(id = conversationId) {
  return [
    id,
    " Cliente teste ",
    "+15550000001",
    "teste@example.com",
    " Cidade ",
    "sp",
    product,
    "Notas da conversão",
  ];
}
async function convert(id = adminId, values = args()) {
  return (await asUser<{ id: string }>(id, conversionSql, values)).rows[0].id;
}
async function snapshot() {
  const result: Record<string, unknown[]> = {};
  for (const table of [
    "contacts",
    "conversations",
    "messages",
    "webhook_events",
    "leads",
    "lead_events",
  ])
    result[table] = (
      await db.query("select * from public." + table + " order by id")
    ).rows;
  return result;
}
async function ingest() {
  await db.exec("set role service_role");
  try {
    await db.query("select public.ingest_whatsapp_events($1::jsonb)", [
      JSON.stringify([inboundEvent()]),
    ]);
  } finally {
    await db.exec("reset role");
  }
  conversationId = (
    await db.query<{ id: string }>("select id from conversations")
  ).rows[0].id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;grant usage on schema public to anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  const migrations = (await readdir("supabase/migrations")).sort();
  // Exercise 009 -> 010 with existing inbound data. Other suites also apply 001 -> 010.
  for (const file of migrations.filter((file) => file < "202611060010"))
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  product = (await db.query<{ id: string }>("select id from products limit 1"))
    .rows[0].id;
  for (const [id, name, role] of [
    [adminId, "Admin", "ADMIN"],
    [agentId, "Agente", "AGENT"],
    [otherId, "Outro", "AGENT"],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    const employee = (
      await db.query<{ id: string }>(
        "select public.provision_employee($1,$2,$3,'',$4,$5) as id",
        [id, name, id + "@example.com", [product], role],
      )
    ).rows[0].id;
    if (id === agentId) agentEmployee = employee;
    if (id === otherId) otherEmployee = employee;
  }
  await db.exec(
    "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Conta fictícia','10001','20001','15550000000',true)",
  );
  await ingest();
  const before = await snapshot();
  await db.exec(
    await readFile(
      "supabase/migrations/202611060010_conversation_to_lead.sql",
      "utf8",
    ),
  );
  expect(await snapshot()).toEqual(before);
  for (const file of migrations.filter(
    (file) => file > "202611060010_conversation_to_lead.sql",
  ))
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
});
beforeEach(async () => {
  await db.exec(
    "truncate public.messages,public.conversations,public.contacts,public.webhook_events,public.lead_events,public.leads cascade;update employees set active=true;update products set active=true;",
  );
  await ingest();
});
afterAll(async () => {
  await db.close();
});

describe("Fase 03A: conversão atômica de conversa em lead", () => {
  it("ADMIN cria lead NEW, vincula a conversa e registra criação e conversão", async () => {
    const before = await snapshot();
    const id = await convert();
    const after = await snapshot();
    expect(after.leads).toEqual([
      expect.objectContaining({
        id,
        name: "Cliente teste",
        phone: "+15550000001",
        email: "teste@example.com",
        city: "Cidade",
        state: "SP",
        product_id: product,
        notes: "Notas da conversão",
        status: "NEW",
        assigned_employee_id: null,
        assigned_at: null,
      }),
    ]);
    expect(after.conversations).toEqual([
      expect.objectContaining({
        id: conversationId,
        lead_id: id,
        status: "OPEN",
      }),
    ]);
    expect(after.lead_events).toHaveLength(2);
    expect(after.lead_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lead_id: id,
          actor_id: adminId,
          action: "CREATED",
        }),
        expect.objectContaining({
          lead_id: id,
          actor_id: adminId,
          action: "CONVERTED_FROM_CONVERSATION",
          data: expect.objectContaining({
            conversation_id: conversationId,
            actor_name: "Admin",
          }),
        }),
      ]),
    );
    for (const table of ["contacts", "messages", "webhook_events"])
      expect(after[table]).toEqual(before[table]);
  });
  it("retry/duplo clique devolve o mesmo lead sem sobrescrever dados ou duplicar auditoria", async () => {
    const id = await convert();
    const before = await snapshot();
    expect(await convert()).toBe(id);
    const changed = args();
    changed[1] = "Outro nome";
    changed[6] = randomUUID();
    expect(await convert(adminId, changed)).toBe(id);
    expect(await snapshot()).toEqual(before);
  });
  it("repetição após fechamento preserva conversa e lead existentes", async () => {
    const id = await convert();
    await db.exec("update conversations set status='CLOSED'");
    const before = await snapshot();
    expect(await convert()).toBe(id);
    expect(await snapshot()).toEqual(before);
  });
  it.each(["closed", "missing", "null"])(
    "recusa conversa %s sem criar lead",
    async (reason) => {
      if (reason === "closed")
        await db.exec("update conversations set status='CLOSED'");
      const before = await snapshot();
      const values: unknown[] = args();
      if (reason === "missing") values[0] = randomUUID();
      if (reason === "null") values[0] = null;
      await expect(asUser(adminId, conversionSql, values)).rejects.toThrow(
        /abertas|não encontrada/,
      );
      expect(await snapshot()).toEqual(before);
    },
  );
  it.each([
    "inactive_product",
    "missing_product",
    "name",
    "phone",
    "email",
    "state",
    "notes",
  ])("validação %s desfaz toda a operação", async (reason) => {
    const values = args();
    if (reason === "inactive_product")
      await db.query("update products set active=false where id=$1", [product]);
    if (reason === "missing_product") values[6] = randomUUID();
    if (reason === "name") values[1] = " ";
    if (reason === "phone") values[2] = "invalid";
    if (reason === "email") values[3] = "invalid";
    if (reason === "state") values[5] = "SPP";
    if (reason === "notes") values[7] = "x".repeat(5001);
    const before = await snapshot();
    await expect(convert(adminId, values)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it.each(["link", "creation_audit", "conversion_audit"])(
    "falha forçada em %s reverte lead, vínculo e histórico",
    async (stage) => {
      const before = await snapshot();
      const table = stage === "link" ? "conversations" : "lead_events";
      const check =
        stage === "link"
          ? "lead_id is null"
          : stage === "creation_audit"
            ? "action <> 'CREATED'"
            : "action <> 'CONVERTED_FROM_CONVERSATION'";
      await db.exec(
        `alter table public.${table} add constraint reject_conversion_test check (${check}) not valid`,
      );
      try {
        await expect(convert()).rejects.toThrow("reject_conversion_test");
      } finally {
        await db.exec(
          `alter table public.${table} drop constraint reject_conversion_test`,
        );
      }
      expect(await snapshot()).toEqual(before);
      await expect(convert()).resolves.toBeTruthy();
    },
  );
  it("duplicata inbound após conversão preserva mensagem, vínculo e auditoria", async () => {
    await convert();
    const before = await snapshot();
    await ingest();
    expect(await snapshot()).toEqual(before);
  });
});

describe("Fase 03A: autorização e RLS preservados", () => {
  it.each(["agent", "inactive_admin", "no_profile"])(
    "%s não converte",
    async (role) => {
      if (role === "inactive_admin")
        await db.query(
          "update employees set active=false where profile_id=$1",
          [adminId],
        );
      const before = await snapshot();
      await expect(
        convert(
          role === "agent"
            ? agentId
            : role === "inactive_admin"
              ? adminId
              : randomUUID(),
        ),
      ).rejects.toThrow("administrativo");
      expect(await snapshot()).toEqual(before);
    },
  );
  it.each(["anon", "service_role"])(
    "%s não executa a RPC de conversão",
    async (role) => {
      await db.exec("set role " + role);
      try {
        await expect(db.query(conversionSql, args())).rejects.toThrow(
          "permission denied",
        );
      } finally {
        await db.exec("reset role");
      }
    },
  );
  it("AGENT não recebe o ID de um lead por retry de conversão existente", async () => {
    await convert();
    const before = await snapshot();
    await expect(convert(agentId)).rejects.toThrow("administrativo");
    expect(await snapshot()).toEqual(before);
  });
  it("somente a atribuição libera conversa; transferência e inatividade revogam acesso", async () => {
    const id = await convert();
    for (const table of [
      "conversations",
      "contacts",
      "messages",
      "lead_events",
    ]) {
      expect(
        (await asUser(agentId, "select * from public." + table)).rows,
      ).toHaveLength(0);
    }
    await asUser(adminId, "select public.assign_lead($1,$2,null)", [
      id,
      agentEmployee,
    ]);
    expect(
      (
        await asUser(agentId, "select id from conversations where id=$1", [
          conversationId,
        ])
      ).rows,
    ).toHaveLength(1);
    expect((await asUser(agentId, "select * from messages")).rows).toHaveLength(
      1,
    );
    await expect(convert(agentId)).rejects.toThrow("administrativo");
    await asUser(adminId, "select public.assign_lead($1,$2,$3)", [
      id,
      otherEmployee,
      agentEmployee,
    ]);
    expect(
      (await asUser(agentId, "select * from conversations")).rows,
    ).toHaveLength(0);
    expect((await asUser(agentId, "select * from messages")).rows).toHaveLength(
      0,
    );
    expect(
      (await asUser(otherId, "select * from conversations")).rows,
    ).toHaveLength(1);
    await db.query("update employees set active=false where id=$1", [
      otherEmployee,
    ]);
    expect(
      (await asUser(otherId, "select * from conversations")).rows,
    ).toHaveLength(0);
  });
  it.each([adminId, agentId])(
    "usuário %s não escreve vínculo diretamente",
    async (id) => {
      await expect(
        asUser(id, "update conversations set lead_id=$1 where id=$2", [
          randomUUID(),
          conversationId,
        ]),
      ).rejects.toThrow("permission denied");
    },
  );
  it("FK existente recusa lead inexistente mesmo fora da RPC", async () => {
    await expect(
      db.query("update conversations set lead_id=$1 where id=$2", [
        randomUUID(),
        conversationId,
      ]),
    ).rejects.toThrow("foreign key");
  });
  it("SECURITY DEFINER mantém search_path vazio e sem execute público", async () => {
    const proc = (
      await db.query<{ prosecdef: boolean; proconfig: string[] }>(
        "select prosecdef,proconfig from pg_proc where oid='public.convert_conversation_to_lead(uuid,text,text,text,text,text,uuid,text)'::regprocedure",
      )
    ).rows[0];
    expect(proc.prosecdef).toBe(true);
    expect(proc.proconfig).toContain('search_path=""');
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('anon','public.convert_conversation_to_lead(uuid,text,text,text,text,text,uuid,text)','EXECUTE') as allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
});
