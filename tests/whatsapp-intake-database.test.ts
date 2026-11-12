import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { inboundEvent } from "./fixtures/whatsapp";
import type { IntakeSession } from "../src/domain/whatsapp-intake";

let db: PGlite,
  serial = 0,
  product: string,
  agentEmployee: string,
  otherEmployee: string;
const admin = randomUUID(),
  agent = randomUUID(),
  other = randomUUID();
async function role<T>(
  name: string,
  sql: string,
  args: unknown[] = [],
  user = "",
) {
  await db.exec("set role " + name);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  try {
    return await db.query<T>(sql, args);
  } finally {
    await db.exec("reset role");
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
  }
}
function event(text: string, extra = {}) {
  serial++;
  return inboundEvent({
    text_body: text,
    external_message_id: "wamid.intake." + serial,
    provider_timestamp: String(1800000000 + serial),
    ...extra,
  });
}
async function ingest(events: unknown[]) {
  return role(
    "service_role",
    "select public.ingest_whatsapp_events($1::jsonb)",
    [JSON.stringify(events)],
  );
}
async function say(text: string) {
  const e = event(text);
  await ingest([e]);
  return e;
}
async function session() {
  return (
    await db.query<IntakeSession>("select * from whatsapp_intake_sessions")
  ).rows[0];
}
async function conversation() {
  return (
    await db.query<{ id: string; lead_id: string | null }>(
      "select id,lead_id from conversations",
    )
  ).rows[0];
}
async function snapshot() {
  const result: Record<string, unknown[]> = {};
  for (const t of [
    "contacts",
    "conversations",
    "messages",
    "webhook_events",
    "whatsapp_intake_sessions",
    "whatsapp_intake_turns",
    "whatsapp_outbound_drafts",
    "leads",
    "lead_events",
  ])
    result[t] = (
      await db.query(
        "select * from " +
          t +
          " order by " +
          (t === "whatsapp_intake_turns" ? "message_id" : "id"),
      )
    ).rows;
  return result;
}
async function until(step: string) {
  await say("Oi, tenho interesse");
  for (const [target, text] of [
    ["NAME", " Ana Teste "],
    ["PRODUCT", "consórcio"],
    ["LOCATION", "Vitória/ES"],
    ["EMAIL", "teste@example.com"],
  ]) {
    if (target === step) return;
    await say(text);
  }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;grant usage on schema public to anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  const files = (await readdir("supabase/migrations")).sort();
  for (const f of files.filter((f) => f < "202611110011"))
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  await db.exec(
    "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Teste local','10001','20001','15550000000',true)",
  );
  const legacy = await say("Conversa anterior à migration");
  const before = await db.query("select * from messages");
  await db.exec(
    await readFile(
      "supabase/migrations/202611110011_whatsapp_intake.sql",
      "utf8",
    ),
  );
  expect((await db.query("select * from messages")).rows).toEqual(before.rows);
  expect(
    (await db.query("select * from whatsapp_intake_sessions")).rows,
  ).toHaveLength(0);
  await ingest([legacy]);
  expect(
    (await db.query("select * from whatsapp_intake_sessions")).rows,
  ).toHaveLength(0);
  product = (
    await db.query<{ id: string }>(
      "select id from products where name='Consórcio'",
    )
  ).rows[0].id;
  for (const [id, name, r] of [
    [admin, "Admin", "ADMIN"],
    [agent, "Agente", "AGENT"],
    [other, "Outro", "AGENT"],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    const result = await db.query<{ id: string }>(
      "select public.provision_employee($1,$2,$3,'',$4,$5) id",
      [id, name, id + "@example.com", [product], r],
    );
    if (id === agent) agentEmployee = result.rows[0].id;
    if (id === other) otherEmployee = result.rows[0].id;
  }
});
beforeEach(async () => {
  await db.exec(
    "truncate contacts,conversations,messages,webhook_events,leads,lead_events cascade;update products set active=true;update employees set active=true",
  );
  serial = 0;
});
afterAll(async () => {
  await db.close();
});

describe("03B1: máquina determinística e rascunhos sem transporte", () => {
  it("primeiro inbound cria NAME e apenas rascunho; duplicata não avança nem duplica resposta", async () => {
    const first = await say("Olá");
    const before = await snapshot();
    expect(await session()).toMatchObject({
      status: "ACTIVE",
      current_step: "NAME",
      name: null,
    });
    expect(before.whatsapp_outbound_drafts).toEqual([
      expect.objectContaining({
        status: "DRAFT",
        text_body: expect.stringContaining("qual é o seu nome"),
      }),
    ]);
    expect(before.messages).toHaveLength(1);
    await ingest([first]);
    expect(await snapshot()).toEqual(before);
  });
  it("nome válido é aparado; metadado display_name não substitui resposta comercial", async () => {
    await until("NAME");
    await say("\t Ana Teste \u00a0");
    expect(await session()).toMatchObject({
      name: "Ana Teste",
      current_step: "PRODUCT",
    });
  });
  it.each([" ", "\t\n\u00a0", "A", "a".repeat(121)])(
    "nome inválido não avança: %j",
    async (name) => {
      await until("NAME");
      await say(name);
      expect((await session()).current_step).toBe("NAME");
      expect(
        (
          await db.query(
            "select outcome from whatsapp_intake_turns order by created_at desc limit 1",
          )
        ).rows[0],
      ).toEqual({ outcome: "INVALID" });
    },
  );
  it.each([
    "consorcio",
    "CONSÓRCIO",
    "consorcio auto",
    "seguro",
    "seguro auto",
    "seguro de carro",
    "automóvel",
  ])("resolve produto ativo por alias %s sem ID fixo", async (value) => {
    await until("PRODUCT");
    await say(value);
    const s = await session();
    expect(s.current_step).toBe("LOCATION");
    expect(
      (
        await db.query<{ name: string }>(
          "select name from products where id=$1",
          [s.product_id],
        )
      ).rows[0].name,
    ).toBe(
      value.toLowerCase().startsWith("cons") ? "Consórcio" : "Seguro Auto",
    );
  });
  it.each(["inexistente", "inativo", "ambíguo"])(
    "produto %s permanece em PRODUCT",
    async (reason) => {
      await until("PRODUCT");
      if (reason === "inativo")
        await db.query("update products set active=false where id=$1", [
          product,
        ]);
      if (reason === "ambíguo")
        await db.exec("insert into products(name) values('consorcio')");
      try {
        await say(reason === "inexistente" ? "vida" : "consórcio");
        expect((await session()).current_step).toBe("PRODUCT");
      } finally {
        if (reason === "ambíguo")
          await db.exec("delete from products where name='consorcio'");
      }
    },
  );
  it.each(["Vitória/ES", "Vitória - ES", "Vitória, es"])(
    "separa cidade/UF: %s",
    async (value) => {
      await until("LOCATION");
      await say(value);
      expect(await session()).toMatchObject({
        city: "Vitória",
        state: "ES",
        current_step: "EMAIL",
      });
    },
  );
  it.each(["Vitória/XX", "Vitória", "/ES", "x/ES", "a".repeat(121) + "/ES"])(
    "localidade inválida não avança: %s",
    async (value) => {
      await until("LOCATION");
      await say(value);
      expect((await session()).current_step).toBe("LOCATION");
    },
  );
  it("aceita e-mail conservador e preserva conteúdo", async () => {
    await until("EMAIL");
    await say(" ana.teste+contato@example.com ");
    expect(await session()).toMatchObject({
      email: "ana.teste+contato@example.com",
      current_step: "SUPPLEMENTAL",
    });
  });
  it.each([
    "invalido",
    "a@b",
    "a..b@example.com",
    "a@-example.com",
    "x".repeat(65) + "@example.com",
  ])("e-mail inválido não avança: %s", async (value) => {
    await until("EMAIL");
    await say(value);
    expect((await session()).current_step).toBe("EMAIL");
  });
  it.each(["não", "nao", "nenhuma", "nada", "  NÃO  "])(
    "supplemental %s vira NULL; completa um lead NEW sem responsável",
    async (value) => {
      await until("SUPPLEMENTAL");
      const original = (await snapshot()).messages;
      await say(value);
      const s = await session(),
        c = await conversation();
      expect(s).toMatchObject({
        status: "COMPLETE",
        current_step: "COMPLETE",
        supplemental_notes: null,
      });
      expect(s.completed_at).not.toBeNull();
      expect((await db.query("select * from leads")).rows).toEqual([
        expect.objectContaining({
          id: c.lead_id,
          name: "Ana Teste",
          phone: "+15550000001",
          product_id: product,
          status: "NEW",
          assigned_employee_id: null,
          assigned_at: null,
          notes: "",
          creation_source: "WHATSAPP_INTAKE",
        }),
      ]);
      const after = await snapshot();
      expect(after.messages).toHaveLength(6);
      expect(after.messages).toEqual(expect.arrayContaining(original));
      expect(after.lead_events).toHaveLength(2);
      for (const e of after.lead_events)
        expect(e).toMatchObject({
          actor_id: null,
          data: expect.objectContaining({ source: "WHATSAPP_INTAKE" }),
        });
      expect(after.whatsapp_outbound_drafts).toHaveLength(6);
      expect(
        (await db.query("select * from messages where direction='OUTBOUND'"))
          .rows,
      ).toHaveLength(0);
    },
  );
  it("texto suplementar preservado, sem modificar contato", async () => {
    await until("SUPPLEMENTAL");
    const before = (
      await db.query("select to_jsonb(c)-'updated_at' as data from contacts c")
    ).rows;
    await say("Quero planejar a compra.\nPreferência: imóvel.");
    expect((await session()).supplemental_notes).toBe(
      "Quero planejar a compra.\nPreferência: imóvel.",
    );
    expect(
      (
        await db.query(
          "select to_jsonb(c)-'updated_at' as data from contacts c",
        )
      ).rows,
    ).toEqual(before);
  });
  it.each([" ", "x".repeat(5001)])(
    "supplemental inválido não conclui",
    async (value) => {
      await until("SUPPLEMENTAL");
      await say(value);
      expect((await session()).status).toBe("ACTIVE");
      expect((await conversation()).lead_id).toBeNull();
    },
  );
  it("repetição e novo inbound após COMPLETE preservam sessão/lead/drafts", async () => {
    await until("SUPPLEMENTAL");
    const last = await say("não"),
      before = await snapshot();
    await ingest([last]);
    expect(await snapshot()).toEqual(before);
    await say("Obrigado");
    const after = await snapshot();
    for (const t of [
      "leads",
      "lead_events",
      "whatsapp_intake_sessions",
      "whatsapp_intake_turns",
      "whatsapp_outbound_drafts",
    ])
      expect(after[t]).toEqual(before[t]);
    expect(after.messages).toHaveLength(7);
  });
  it("produto desativado antes da conclusão retorna a PRODUCT sem perder inbound", async () => {
    await until("SUPPLEMENTAL");
    await db.query("update products set active=false where id=$1", [product]);
    await say("não");
    expect(await session()).toMatchObject({
      status: "ACTIVE",
      current_step: "PRODUCT",
      product_id: null,
    });
    expect((await conversation()).lead_id).toBeNull();
  });
  it("telefone ausente bloqueia conclusão sem perguntar telefone ou fabricar número", async () => {
    await until("SUPPLEMENTAL");
    await db.exec(
      "update contacts set phone=null,wa_id='fixture-without-number'",
    );
    await ingest([event("não", { wa_id: "fixture-without-number" })]);
    expect((await session()).status).toBe("ACTIVE");
    expect((await conversation()).lead_id).toBeNull();
    expect(
      (
        await db.query<{ text_body: string }>(
          "select text_body from whatsapp_outbound_drafts order by sequence desc limit 1",
        )
      ).rows[0].text_body,
    ).toContain("revisão da equipe");
  });
  it("usa wa_id quando contact.phone não está disponível", async () => {
    await until("SUPPLEMENTAL");
    await db.exec("update contacts set phone=null");
    await say("não");
    expect((await db.query("select phone from leads")).rows[0]).toEqual({
      phone: "+15550000001",
    });
  });
  it("lote usa timestamp e ordem original em empate, nunca ordenação lexical do ID", async () => {
    const batch = [
      event("Oi", { external_message_id: "z" }),
      event("Ana Teste", { external_message_id: "y" }),
      event("consórcio", { external_message_id: "x" }),
      event("Vitória/ES", { external_message_id: "w" }),
      event("teste@example.com", { external_message_id: "v" }),
      event("não", { external_message_id: "u" }),
    ];
    await ingest([batch[3], batch[1], batch[5], batch[0], batch[4], batch[2]]);
    expect((await session()).status).toBe("COMPLETE");
  });
  it("duplicata no lote não impede avanço por mensagem inédita", async () => {
    const first = await say("Oi");
    await ingest([first, event("Ana Teste")]);
    expect((await session()).current_step).toBe("PRODUCT");
  });
  it("duplicata de resposta aceita não avança a etapa nem recria draft", async () => {
    await until("NAME");
    const name = await say("Ana Teste");
    const before = await snapshot();
    await ingest([name]);
    expect(await snapshot()).toEqual(before);
    expect((await session()).current_step).toBe("PRODUCT");
  });
  it("timestamp igual no lote mantém ordem original das respostas", async () => {
    await ingest(
      [
        "Oi",
        "Ana Teste",
        "consórcio",
        "Vitória/ES",
        "teste@example.com",
        "não",
      ].map((t, i) =>
        event(t, {
          external_message_id: "tie." + (9 - i),
          provider_timestamp: "1800000000",
        }),
      ),
    );
    expect((await session()).status).toBe("COMPLETE");
  });
  it("conversão manual vence e inbound não altera intake antigo", async () => {
    await until("PRODUCT");
    const c = await conversation();
    await role(
      "authenticated",
      "select public.convert_conversation_to_lead($1,'Manual','15550000001','','','',$2,'')",
      [c.id, product],
      admin,
    );
    const before = await snapshot();
    await say("consórcio");
    const after = await snapshot();
    for (const t of [
      "leads",
      "lead_events",
      "whatsapp_intake_sessions",
      "whatsapp_intake_turns",
      "whatsapp_outbound_drafts",
    ])
      expect(after[t]).toEqual(before[t]);
  });
  it("conversa com lead nunca inicia intake", async () => {
    const first = await say("Oi");
    await db.exec("delete from whatsapp_intake_sessions");
    const c = await conversation();
    await role(
      "authenticated",
      "select public.convert_conversation_to_lead($1,'Manual','15550000001','','','',$2,'')",
      [c.id, product],
      admin,
    );
    await ingest([first, event("Nome")]);
    expect(
      (await db.query("select * from whatsapp_intake_sessions")).rows,
    ).toHaveLength(0);
  });
});

describe("03B1: atomicidade e autorização", () => {
  it.each([
    "leads",
    "link",
    "created_audit",
    "conversion_audit",
    "complete",
    "draft",
  ])("falha em %s reverte TODO o inbound e a conclusão", async (stage) => {
    await until("SUPPLEMENTAL");
    const before = await snapshot();
    const [table, check] =
      stage === "leads"
        ? ["leads", "creation_source<>'WHATSAPP_INTAKE'"]
        : stage === "link"
          ? ["conversations", "lead_id is null"]
          : stage === "created_audit"
            ? ["lead_events", "action<>'CREATED'"]
            : stage === "conversion_audit"
              ? ["lead_events", "action<>'CONVERTED_FROM_WHATSAPP_INTAKE'"]
              : stage === "complete"
                ? ["whatsapp_intake_sessions", "status<>'COMPLETE'"]
                : ["whatsapp_outbound_drafts", "false"];
    await db.exec(
      `alter table ${table} add constraint intake_forced_failure check(${check}) not valid`,
    );
    try {
      await expect(say("não")).rejects.toThrow("intake_forced_failure");
    } finally {
      await db.exec(
        `alter table ${table} drop constraint intake_forced_failure`,
      );
    }
    expect(await snapshot()).toEqual(before);
    await say("não");
    expect((await session()).status).toBe("COMPLETE");
  });
  it("falha ao gerar primeiro draft não deixa contato/conversa/mensagem/evento parcial", async () => {
    const before = await snapshot();
    await db.exec(
      "alter table whatsapp_outbound_drafts add constraint fail_first check(false) not valid",
    );
    try {
      await expect(say("Oi")).rejects.toThrow("fail_first");
    } finally {
      await db.exec(
        "alter table whatsapp_outbound_drafts drop constraint fail_first",
      );
    }
    expect(await snapshot()).toEqual(before);
  });
  it.each(["anon", "authenticated", "service_role"])(
    "%s não executa conclusão técnica ou escreve intake diretamente",
    async (r) => {
      await until("NAME");
      const c = await conversation();
      await expect(
        role(
          r,
          "select app_private.complete_whatsapp_intake($1)",
          [c.id],
          r === "authenticated" ? admin : "",
        ),
      ).rejects.toThrow("permission denied");
      await expect(
        role(
          r,
          "update whatsapp_intake_sessions set name='Forjado'",
          [],
          r === "authenticated" ? admin : "",
        ),
      ).rejects.toThrow("permission denied");
      await expect(
        role(
          r,
          "insert into whatsapp_outbound_drafts(session_id,in_reply_to_message_id,text_body) values($1,$2,'x')",
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow("permission denied");
    },
  );
  it("AGENT não lê intake, ADMIN lê; leitura comercial segue atribuição e transferência", async () => {
    await until("SUPPLEMENTAL");
    expect(
      (
        await role(
          "authenticated",
          "select * from whatsapp_intake_sessions",
          [],
          agent,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await role(
          "authenticated",
          "select * from whatsapp_intake_sessions",
          [],
          admin,
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await role(
          "authenticated",
          "select * from whatsapp_outbound_drafts",
          [],
          agent,
        )
      ).rows,
    ).toHaveLength(0);
    await say("não");
    const c = await conversation();
    expect(
      (await role("authenticated", "select * from conversations", [], agent))
        .rows,
    ).toHaveLength(0);
    await role(
      "authenticated",
      "select public.assign_lead($1,$2,null)",
      [c.lead_id, agentEmployee],
      admin,
    );
    expect(
      (await role("authenticated", "select * from conversations", [], agent))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await role(
          "authenticated",
          "select * from whatsapp_intake_sessions",
          [],
          agent,
        )
      ).rows,
    ).toHaveLength(0);
    await role(
      "authenticated",
      "select public.assign_lead($1,$2,$3)",
      [c.lead_id, otherEmployee, agentEmployee],
      admin,
    );
    expect(
      (await role("authenticated", "select * from conversations", [], agent))
        .rows,
    ).toHaveLength(0);
    expect(
      (await role("authenticated", "select * from conversations", [], other))
        .rows,
    ).toHaveLength(1);
    await db.query("update employees set active=false where profile_id=$1", [
      admin,
    ]);
    expect(
      (
        await role(
          "authenticated",
          "select * from whatsapp_intake_sessions",
          [],
          admin,
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("payload não escolhe ator/produto/lead; RPC manual continua ADMIN-only", async () => {
    for (const key of ["actor_id", "profile_id", "product_id", "lead_id"])
      await expect(ingest([{ ...event("Oi"), [key]: admin }])).rejects.toThrow(
        "inválida",
      );
    await until("NAME");
    const c = await conversation();
    await expect(
      role(
        "authenticated",
        "select public.convert_conversation_to_lead($1,'Forjado','15550000001','','','',$2,'')",
        [c.id, product],
        agent,
      ),
    ).rejects.toThrow("administrativo");
  });
  it("novas funções mantêm search_path vazio e grants mínimos", async () => {
    const rows = (
      await db.query<{
        proname: string;
        proconfig: string[];
        anon: boolean;
        user: boolean;
        service: boolean;
      }>(
        "select proname,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') user,has_function_privilege('service_role',oid,'EXECUTE') service from pg_proc where pronamespace='app_private'::regnamespace and (proname like 'intake_%' or proname in ('complete_whatsapp_intake','process_whatsapp_intake'))",
      )
    ).rows;
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.proconfig).toContain('search_path=""');
      expect(r.anon || r.user || r.service).toBe(false);
    }
  });
});
