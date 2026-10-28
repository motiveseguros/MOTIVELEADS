import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
import { createWebhookHandlers } from "../src/lib/whatsapp/webhook";
import { inboundEvent, webhookPayload } from "./fixtures/whatsapp";
let db: PGlite;
const adminId = randomUUID(),
  agentId = randomUUID(),
  otherId = randomUUID();
let accountId: string,
  secondAccountId: string,
  agentEmployee: string,
  otherEmployee: string,
  product: string;
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
async function ingest(events: unknown[]) {
  await db.exec("set role service_role");
  try {
    return (
      await db.query<{
        result: { inserted: number; duplicates: number; statuses: number };
      }>("select public.ingest_whatsapp_events($1::jsonb) as result", [
        JSON.stringify(events),
      ])
    ).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}
async function counts() {
  return (
    await db.query<{
      contacts: number;
      conversations: number;
      messages: number;
      events: number;
    }>(
      "select (select count(*)::int from contacts) as contacts,(select count(*)::int from conversations) as conversations,(select count(*)::int from messages) as messages,(select count(*)::int from webhook_events) as events",
    )
  ).rows[0];
}
async function conversation() {
  return (
    await db.query<{
      id: string;
      contact_id: string;
      lead_id: string | null;
      last_message_at: Date;
    }>("select * from conversations order by created_at limit 1")
  ).rows[0];
}
async function linkedLead() {
  const id = (
    await asUser<{ id: string }>(
      adminId,
      "select public.create_lead('Lead teste','15550000001','','','',$1,'') as id",
      [product],
    )
  ).rows[0].id;
  await asUser(adminId, "select public.assign_lead($1,$2,null)", [
    id,
    agentEmployee,
  ]);
  const c = await conversation();
  // Test fixture only: conversion/linking is deliberately not exposed by this phase.
  await db.query("update conversations set lead_id=$1 where id=$2", [id, c.id]);
  return { id, conversation: c };
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;grant usage on schema public to anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const file of (await readdir("supabase/migrations")).sort())
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
  accountId = (
    await db.query<{ id: string }>(
      "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Conta fictícia','10001','20001','15550000000',true) returning id",
    )
  ).rows[0].id;
  secondAccountId = (
    await db.query<{ id: string }>(
      "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Outra conta fictícia','10002','20002','15550000002',true) returning id",
    )
  ).rows[0].id;
});
beforeEach(async () => {
  await db.exec(
    "truncate messages,conversations,contacts,webhook_events;update whatsapp_accounts set active=true;update employees set active=true;",
  );
});
afterAll(async () => {
  await db.close();
});
describe("WhatsApp: integridade e idempotência", () => {
  it("cria contato/conversa sem lead, mensagem e evento atomicamente", async () => {
    const leadsBefore = (await db.query("select count(*) from leads")).rows;
    expect(await ingest([inboundEvent()])).toEqual({
      inserted: 1,
      duplicates: 0,
      statuses: 0,
    });
    expect(await counts()).toEqual({
      contacts: 1,
      conversations: 1,
      messages: 1,
      events: 1,
    });
    expect((await conversation()).lead_id).toBeNull();
    expect((await db.query("select count(*) from leads")).rows).toEqual(
      leadsBefore,
    );
    expect(
      (
        await db.query(
          "select status,direction,sent_by_profile_id from messages",
        )
      ).rows[0],
    ).toEqual({
      status: "RECEIVED",
      direction: "INBOUND",
      sent_by_profile_id: null,
    });
    expect(
      (
        await db.query(
          "select id from webhook_events where processed_at is not null and processing_error is null",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("reutiliza contato e conversa e impõe unicidade account + wa_id", async () => {
    await ingest([
      inboundEvent(),
      inboundEvent({ external_message_id: "wamid.test.2" }),
    ]);
    expect(await counts()).toEqual({
      contacts: 1,
      conversations: 1,
      messages: 2,
      events: 2,
    });
    await expect(
      db.query(
        "insert into contacts(whatsapp_account_id,wa_id) values($1,'15550000001')",
        [accountId],
      ),
    ).rejects.toThrow("unique");
    await ingest([
      inboundEvent({
        waba_id: "10002",
        phone_number_id: "20002",
        external_message_id: "wamid.other",
      }),
    ]);
    expect((await counts()).contacts).toBe(2);
  });
  it("repetição externa não duplica nem cria conversa após fechamento", async () => {
    await ingest([inboundEvent()]);
    await db.exec("update conversations set status='CLOSED'");
    expect(await ingest([inboundEvent()])).toEqual({
      inserted: 0,
      duplicates: 1,
      statuses: 0,
    });
    expect(await counts()).toEqual({
      contacts: 1,
      conversations: 1,
      messages: 1,
      events: 1,
    });
    await ingest([inboundEvent({ external_message_id: "wamid.new" })]);
    expect((await counts()).conversations).toBe(2);
  });
  it("mensagens antigas não recuam last_message_at", async () => {
    await ingest([inboundEvent()]);
    const before = (await conversation()).last_message_at;
    await ingest([
      inboundEvent({
        external_message_id: "wamid.old",
        provider_timestamp: "100",
      }),
    ]);
    expect((await conversation()).last_message_at).toEqual(before);
  });
  it("bloqueia identidade externa divergente ou reutilizada em outra conta", async () => {
    await ingest([inboundEvent()]);
    const before = await counts();
    await expect(
      ingest([inboundEvent({ text_body: "Outro conteúdo" })]),
    ).rejects.toThrow("divergente");
    await expect(
      ingest([inboundEvent({ waba_id: "10002", phone_number_id: "20002" })]),
    ).rejects.toThrow("já utilizado");
    expect(await counts()).toEqual(before);
  });
  it.each(["unknown", "inactive", "waba", "malformed", "injected"])(
    "lote %s não grava dados parciais",
    async (reason) => {
      if (reason === "inactive")
        await db.query(
          "update whatsapp_accounts set active=false where id=$1",
          [secondAccountId],
        );
      const invalid = {
        ...inboundEvent({
          external_message_id: "wamid.z",
          phone_number_id: "20002",
          waba_id: "10002",
        }),
      };
      const payload: Record<string, unknown> = { ...invalid };
      if (reason === "unknown") payload.phone_number_id = "99999";
      if (reason === "waba") payload.waba_id = "99999";
      if (reason === "malformed") payload.text_body = null;
      if (reason === "injected") payload.lead_id = randomUUID();
      await expect(ingest([inboundEvent(), payload])).rejects.toThrow();
      expect(await counts()).toEqual({
        contacts: 0,
        conversations: 0,
        messages: 0,
        events: 0,
      });
    },
  );
  it("falha de inserção após evento válido desfaz todo o lote; retry funciona", async () => {
    await db.exec(
      "create function app_private.fail_whatsapp_test() returns trigger language plpgsql as $$ begin if new.text_body='FORCE_FAILURE' then raise exception 'forced failure'; end if; return new; end $$;create trigger fail_whatsapp_test before insert on messages for each row execute function app_private.fail_whatsapp_test();",
    );
    const batch = [
      inboundEvent(),
      inboundEvent({
        external_message_id: "wamid.z",
        text_body: "FORCE_FAILURE",
      }),
    ];
    try {
      await expect(ingest(batch)).rejects.toThrow("forced failure");
      expect(await counts()).toEqual({
        contacts: 0,
        conversations: 0,
        messages: 0,
        events: 0,
      });
    } finally {
      await db.exec(
        "drop trigger fail_whatsapp_test on messages;drop function app_private.fail_whatsapp_test();",
      );
    }
    expect((await ingest(batch)).inserted).toBe(2);
  });
  it("impede contato/conversa de contas diferentes e duas conversas abertas", async () => {
    await ingest([inboundEvent()]);
    const c = await conversation();
    await expect(
      db.query(
        "insert into conversations(whatsapp_account_id,contact_id) values($1,$2)",
        [secondAccountId, c.contact_id],
      ),
    ).rejects.toThrow("foreign key");
    await expect(
      db.query(
        "insert into conversations(whatsapp_account_id,contact_id) values($1,$2)",
        [accountId, c.contact_id],
      ),
    ).rejects.toThrow("unique");
  });
});
describe("WhatsApp: RLS e privilégios", () => {
  it("ADMIN vê conversa sem lead; AGENT não vê conversa, contato ou mensagens", async () => {
    await ingest([inboundEvent()]);
    for (const table of [
      "conversations",
      "contacts",
      "messages",
      "conversation_inbox",
    ]) {
      expect(
        (await asUser(adminId, "select * from " + table)).rows,
      ).toHaveLength(1);
      expect(
        (await asUser(agentId, "select * from " + table)).rows,
      ).toHaveLength(0);
    }
    expect(
      (await asUser(adminId, "select * from whatsapp_accounts")).rows,
    ).toHaveLength(2);
    expect(
      (await asUser(agentId, "select * from whatsapp_accounts")).rows,
    ).toHaveLength(0);
  });
  it("AGENT vê só seu lead; perde conversa/mensagens/contato após transferência", async () => {
    await ingest([inboundEvent()]);
    const lead = await linkedLead();
    for (const table of [
      "conversations",
      "contacts",
      "messages",
      "conversation_inbox",
    ]) {
      expect(
        (await asUser(agentId, "select * from " + table)).rows,
      ).toHaveLength(1);
      expect(
        (await asUser(otherId, "select * from " + table)).rows,
      ).toHaveLength(0);
    }
    await asUser(adminId, "select public.assign_lead($1,$2,$3)", [
      lead.id,
      otherEmployee,
      agentEmployee,
    ]);
    for (const table of [
      "conversations",
      "contacts",
      "messages",
      "conversation_inbox",
    ]) {
      expect(
        (await asUser(agentId, "select * from " + table)).rows,
      ).toHaveLength(0);
      expect(
        (await asUser(otherId, "select * from " + table)).rows,
      ).toHaveLength(1);
    }
  });
  it("mesmo contato não libera outra conversa sem lead ao agente", async () => {
    await ingest([inboundEvent()]);
    await linkedLead();
    await db.exec("update conversations set status='CLOSED'");
    await ingest([inboundEvent({ external_message_id: "wamid.new" })]);
    expect(
      (await asUser(agentId, "select * from conversations")).rows,
    ).toHaveLength(1);
    expect((await asUser(agentId, "select * from messages")).rows).toHaveLength(
      1,
    );
    expect(
      (await asUser(agentId, "select * from conversation_inbox")).rows,
    ).toHaveLength(1);
  });
  it("funcionários inativos perdem acesso inclusive ADMIN", async () => {
    await ingest([inboundEvent()]);
    await linkedLead();
    await db.exec("update employees set active=false");
    for (const id of [adminId, agentId])
      for (const table of [
        "conversations",
        "contacts",
        "messages",
        "whatsapp_accounts",
        "conversation_inbox",
      ])
        expect((await asUser(id, "select * from " + table)).rows).toHaveLength(
          0,
        );
  });
  it.each([adminId, agentId])(
    "usuário %s não ingere nem escreve histórico/tabelas",
    async (id) => {
      for (const table of [
        "whatsapp_accounts",
        "contacts",
        "conversations",
        "messages",
        "webhook_events",
      ])
        await expect(asUser(id, "delete from " + table)).rejects.toThrow(
          "permission denied",
        );
      await expect(asUser(id, "select * from webhook_events")).rejects.toThrow(
        "permission denied",
      );
      await expect(
        asUser(id, "select public.ingest_whatsapp_events($1::jsonb)", [
          JSON.stringify([inboundEvent()]),
        ]),
      ).rejects.toThrow("permission denied");
    },
  );
  it("anônimo não acessa tabelas, view ou RPC; serviço só tem RPC", async () => {
    for (const role of ["anon", "service_role"]) {
      await db.exec("set role " + role);
      try {
        for (const table of [
          "whatsapp_accounts",
          "contacts",
          "conversations",
          "messages",
          "webhook_events",
          "conversation_inbox",
        ])
          await expect(db.query("select * from " + table)).rejects.toThrow(
            "permission denied",
          );
        if (role === "anon")
          await expect(
            db.query("select public.ingest_whatsapp_events('[]')"),
          ).rejects.toThrow("permission denied");
      } finally {
        await db.exec("reset role");
      }
    }
  });
});
describe("WhatsApp: callbacks fora de ordem", () => {
  it("READ não regride; repetição de callback é idempotente", async () => {
    await ingest([inboundEvent()]);
    const c = await conversation();
    await db.query(
      "insert into messages(conversation_id,external_message_id,direction,type,text_body,status) values($1,'wamid.out','OUTBOUND','text','Fixture de saída','PENDING')",
      [c.id],
    );
    const update = {
      kind: "status",
      waba_id: "10001",
      phone_number_id: "20001",
      external_message_id: "wamid.out",
      provider_timestamp: "1793066400",
      wa_id: "15550000001",
      status: "READ",
    };
    for (const state of ["READ", "SENT", "FAILED", "DELIVERED"])
      await ingest([{ ...update, status: state }]);
    expect(
      (
        await db.query(
          "select status from messages where external_message_id='wamid.out'",
        )
      ).rows[0],
    ).toEqual({ status: "READ" });
    expect((await ingest([update])).duplicates).toBe(1);
  });
  it("entrega supera falha; falha supera envio; remetente ou saída desconhecida aborta", async () => {
    await ingest([inboundEvent()]);
    const c = await conversation();
    await db.query(
      "insert into messages(conversation_id,external_message_id,direction,type,text_body,status) values($1,'wamid.out','OUTBOUND','text','Fixture de saída','PENDING')",
      [c.id],
    );
    const update = {
      kind: "status",
      waba_id: "10001",
      phone_number_id: "20001",
      external_message_id: "wamid.out",
      provider_timestamp: "1793066400",
      wa_id: "15550000001",
      status: "FAILED",
    };
    await ingest([update]);
    await ingest([{ ...update, status: "SENT" }]);
    expect(
      (
        await db.query(
          "select status from messages where external_message_id='wamid.out'",
        )
      ).rows[0],
    ).toEqual({ status: "FAILED" });
    await ingest([{ ...update, status: "DELIVERED" }]);
    expect(
      (
        await db.query(
          "select status from messages where external_message_id='wamid.out'",
        )
      ).rows[0],
    ).toEqual({ status: "DELIVERED" });
    const before = await counts();
    await expect(
      ingest([{ ...update, external_message_id: "unknown" }]),
    ).rejects.toThrow("desconhecida");
    await expect(
      ingest([{ ...update, status: "READ", wa_id: "other" }]),
    ).rejects.toThrow("desconhecida");
    expect(await counts()).toEqual(before);
  });
});

describe("WhatsApp: HTTP até a transação SQL local", () => {
  const post = () =>
    createWebhookHandlers({
      verifyToken: () => undefined,
      authenticator: { verify: async () => true },
      persist: (events) => ingest(events),
    }).POST;
  it("payload normalizado percorre parser/RPC e a repetição retorna duplicata", async () => {
    const makeRequest = () =>
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload()),
      });
    const first = await post()(makeRequest());
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      inserted: 1,
      duplicates: 0,
      statuses: 0,
    });
    const second = await post()(makeRequest());
    expect(await second.json()).toEqual({
      inserted: 0,
      duplicates: 1,
      statuses: 0,
    });
    expect(await counts()).toEqual({
      contacts: 1,
      conversations: 1,
      messages: 1,
      events: 1,
    });
  });
  it("conta desconhecida em lote HTTP devolve erro e desfaz dados anteriores", async () => {
    const payload = webhookPayload();
    payload.entry.push({ ...payload.entry[0], id: "99999" });
    const response = await post()(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    expect(response.status).toBe(503);
    expect(await counts()).toEqual({
      contacts: 0,
      conversations: 0,
      messages: 0,
      events: 0,
    });
  });
});

describe("A01/A02: identidade imutável e nome preenchido somente quando NULL", () => {
  async function contactName() {
    return (
      await db.query<{ display_name: string | null }>(
        "select display_name from contacts where whatsapp_account_id=$1 and wa_id='15550000001'",
        [accountId],
      )
    ).rows[0].display_name;
  }
  it.each(["different", "null", "missing"] as const)(
    "duplicata com nome %s permite outra mensagem inédita e preserva auditoria",
    async (variation) => {
      const original = inboundEvent({ display_name: "João" });
      await ingest([original]);
      const messagesBefore = (await db.query("select * from messages")).rows;
      const eventsBefore = (await db.query("select * from webhook_events"))
        .rows;
      const duplicate: Record<string, unknown> = {
        ...original,
        display_name: variation === "different" ? "João Silva" : null,
      };
      if (variation === "missing") delete duplicate.display_name;
      expect(
        await ingest([
          duplicate,
          inboundEvent({
            external_message_id: "wamid.test.2",
            display_name: "Outro nome",
          }),
        ]),
      ).toEqual({ inserted: 1, duplicates: 1, statuses: 0 });
      expect(await counts()).toEqual({
        contacts: 1,
        conversations: 1,
        messages: 2,
        events: 2,
      });
      expect(
        (
          await db.query(
            "select * from messages where external_message_id=$1",
            [original.external_message_id],
          )
        ).rows,
      ).toEqual(messagesBefore);
      expect(
        (
          await db.query(
            "select * from webhook_events where payload->>'external_message_id'=$1",
            [original.external_message_id],
          )
        ).rows,
      ).toEqual(eventsBefore);
      expect(await contactName()).toBe("João");
    },
  );
  it.each([
    { field: "body", changes: { text_body: "Divergente" } },
    { field: "sender", changes: { wa_id: "15550000099" } },
    { field: "type", changes: { type: "image" } },
    { field: "timestamp", changes: { provider_timestamp: "1700000000" } },
    {
      field: "account",
      changes: { waba_id: "10002", phone_number_id: "20002" },
    },
  ])(
    "divergência imutável em $field continua abortando sem efeitos",
    async ({ changes }) => {
      await ingest([inboundEvent()]);
      const before = await counts();
      const contactBefore = (await db.query("select * from contacts")).rows;
      await expect(
        ingest([{ ...inboundEvent(), ...changes, display_name: null }]),
      ).rejects.toThrow();
      expect(await counts()).toEqual(before);
      expect((await db.query("select * from contacts")).rows).toEqual(
        contactBefore,
      );
    },
  );
  it.each([null, "", "   "])(
    "nome inicial %s não bloqueia preenchimento pelo primeiro nome válido",
    async (initial) => {
      await ingest([inboundEvent({ display_name: initial })]);
      expect(await contactName()).toBeNull();
      await ingest([
        inboundEvent({
          external_message_id: "wamid.name.2",
          display_name: "João",
        }),
      ]);
      expect(await contactName()).toBe("João");
    },
  );
  it.each([null, "João Silva", "", "   "])(
    "nome existente não é alterado pela entrada %s",
    async (incoming) => {
      await ingest([inboundEvent({ display_name: "João" })]);
      await ingest([
        inboundEvent({
          external_message_id: "wamid.name.2",
          provider_timestamp: "1793066500",
          display_name: incoming,
        }),
      ]);
      expect(await contactName()).toBe("João");
    },
  );
  it("evento atrasado preserva nome atual e last_message_at entre chamadas", async () => {
    await ingest([inboundEvent({ display_name: "Nome atual" })]);
    const lastMessage = (await conversation()).last_message_at;
    await ingest([
      inboundEvent({
        external_message_id: "wamid.old",
        provider_timestamp: "1700000000",
        display_name: "Nome antigo",
      }),
    ]);
    expect(await contactName()).toBe("Nome atual");
    expect((await conversation()).last_message_at).toEqual(lastMessage);
  });
  it("lote reproduzido pela auditoria não regride nome", async () => {
    await ingest([
      inboundEvent({
        external_message_id: "a-new",
        display_name: "Nome atual",
      }),
      inboundEvent({
        external_message_id: "z-old",
        provider_timestamp: "1700000000",
        display_name: "Nome antigo",
      }),
    ]);
    expect(await contactName()).toBe("Nome atual");
  });
  it.each(["different", "missing"])(
    "duplicata com nome %s não reabre conversa fechada",
    async (variation) => {
      await ingest([inboundEvent({ display_name: "João" })]);
      await db.exec("update conversations set status='CLOSED'");
      const before = (await db.query("select * from conversations")).rows;
      const duplicate: Record<string, unknown> = {
        ...inboundEvent(),
        display_name: "João Silva",
      };
      if (variation === "missing") delete duplicate.display_name;
      expect(await ingest([duplicate])).toEqual({
        inserted: 0,
        duplicates: 1,
        statuses: 0,
      });
      expect((await db.query("select * from conversations")).rows).toEqual(
        before,
      );
      expect(await counts()).toEqual({
        contacts: 1,
        conversations: 1,
        messages: 1,
        events: 1,
      });
    },
  );
  it("duplicata válida pode preencher NULL sem reabrir conversa ou reescrever evento", async () => {
    await ingest([inboundEvent({ display_name: null })]);
    await db.exec("update conversations set status='CLOSED'");
    const before = (await db.query("select * from webhook_events")).rows;
    expect(
      (await ingest([inboundEvent({ display_name: "João" })])).duplicates,
    ).toBe(1);
    expect(await contactName()).toBe("João");
    expect((await db.query("select * from webhook_events")).rows).toEqual(
      before,
    );
    expect((await db.query("select status from conversations")).rows).toEqual([
      { status: "CLOSED" },
    ]);
  });
  it("duplicata e mensagens inéditas preservam atomicidade inclusive no preenchimento de nome", async () => {
    await ingest([
      inboundEvent({ external_message_id: "a-original", display_name: null }),
    ]);
    const original = inboundEvent({
      external_message_id: "a-original",
      display_name: "João",
    });
    const newMessage = inboundEvent({
      external_message_id: "b-new",
      display_name: "João",
    });
    const before = await counts();
    const contactBefore = (await db.query("select * from contacts")).rows;
    await expect(
      ingest([
        original,
        newMessage,
        { ...inboundEvent(), external_message_id: "z-bad", text_body: null },
      ]),
    ).rejects.toThrow();
    expect(await counts()).toEqual(before);
    expect((await db.query("select * from contacts")).rows).toEqual(
      contactBefore,
    );
    expect(await ingest([original, newMessage])).toEqual({
      inserted: 1,
      duplicates: 1,
      statuses: 0,
    });
    expect(await contactName()).toBe("João");
  });
  it("HTTP sem contacts normaliza nome ausente e mantém duplicata válida", async () => {
    const post = createWebhookHandlers({
      verifyToken: () => undefined,
      authenticator: { verify: async () => true },
      persist: (events) => ingest(events),
    }).POST;
    const request = (payload: unknown) =>
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    const payload = webhookPayload();
    expect((await post(request(payload))).status).toBe(200);
    const change = payload.entry[0].changes[0];
    const replay = {
      ...payload,
      entry: [
        {
          ...payload.entry[0],
          changes: [
            { ...change, value: { ...change.value, contacts: undefined } },
          ],
        },
      ],
    };
    const response = await post(request(replay));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      inserted: 0,
      duplicates: 1,
      statuses: 0,
    });
  });
  it("008 aceita reentrega de dados gravados pela 007 sem reescrever histórico", async () => {
    const upgrade = new PGlite();
    try {
      await upgrade.exec(
        "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      );
      const migrations = (await readdir("supabase/migrations")).sort();
      for (const file of migrations.filter((f) => f < "202610270008"))
        await upgrade.exec(
          await readFile("supabase/migrations/" + file, "utf8"),
        );
      await upgrade.exec(
        "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Fixture upgrade','10001','20001','15550000000',true)",
      );
      await upgrade.query("select public.ingest_whatsapp_events($1::jsonb)", [
        JSON.stringify([inboundEvent({ display_name: "João" })]),
      ]);
      const eventsBefore = (await upgrade.query("select * from webhook_events"))
        .rows;
      await upgrade.exec(
        await readFile(
          "supabase/migrations/202610270008_whatsapp_ingestion_robustness.sql",
          "utf8",
        ),
      );
      await upgrade.exec("set role service_role");
      const result = await upgrade.query<{ result: { duplicates: number } }>(
        "select public.ingest_whatsapp_events($1::jsonb) as result",
        [JSON.stringify([inboundEvent({ display_name: "João Silva" })])],
      );
      expect(result.rows[0].result.duplicates).toBe(1);
      await upgrade.exec("reset role");
      expect(
        (await upgrade.query("select * from webhook_events")).rows,
      ).toEqual(eventsBefore);
      expect(
        (await upgrade.query("select display_name from contacts")).rows,
      ).toEqual([{ display_name: "João" }]);
    } finally {
      await upgrade.close();
    }
  });
});

describe("F03: normalização explícita de whitespace no display_name", () => {
  async function name() {
    return (
      await db.query<{ display_name: string | null }>(
        "select display_name from contacts where whatsapp_account_id=$1 and wa_id='15550000001'",
        [accountId],
      )
    ).rows[0].display_name;
  }
  const whitespaceCases = [
    { label: "espaço U+0020", value: " " },
    { label: "tabulação", value: "\t" },
    { label: "quebra de linha", value: "\n" },
    { label: "carriage return", value: "\r" },
    { label: "tabulação e quebra de linha", value: "\t\n" },
    { label: "NBSP", value: "\u00a0" },
    {
      label: "mistura de espaços, tabs, quebras e NBSP",
      value: " \t\n\r\u00a0 ",
    },
    {
      label: "demais caracteres do conjunto Unicode White_Space",
      value:
        "\u000b\u000c\u0085\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000",
    },
  ];
  it.each(whitespaceCases)(
    "$label não preenche e permite nome válido posterior",
    async ({ value }) => {
      await ingest([inboundEvent({ display_name: value })]);
      expect(await name()).toBeNull();
      await ingest([
        inboundEvent({
          external_message_id: "wamid.f03.new",
          display_name: "João",
        }),
      ]);
      expect(await name()).toBe("João");
      expect(await counts()).toEqual({
        contacts: 1,
        conversations: 1,
        messages: 2,
        events: 2,
      });
    },
  );
  it.each(["\t\n", "\u00a0", " \t\r\n\u00a0 "])(
    "duplicata com whitespace %j não bloqueia enriquecimento nem reabre conversa",
    async (incoming) => {
      await ingest([inboundEvent({ display_name: null })]);
      await db.exec("update conversations set status='CLOSED'");
      const before = {
        messages: (await db.query("select * from messages")).rows,
        conversations: (await db.query("select * from conversations")).rows,
        events: (await db.query("select * from webhook_events")).rows,
      };
      expect(await ingest([inboundEvent({ display_name: incoming })])).toEqual({
        inserted: 0,
        duplicates: 1,
        statuses: 0,
      });
      expect(await name()).toBeNull();
      expect(
        await ingest([inboundEvent({ display_name: "\t João\u00a0" })]),
      ).toEqual({ inserted: 0, duplicates: 1, statuses: 0 });
      expect(await name()).toBe("João");
      expect((await db.query("select * from messages")).rows).toEqual(
        before.messages,
      );
      expect((await db.query("select * from conversations")).rows).toEqual(
        before.conversations,
      );
      expect((await db.query("select * from webhook_events")).rows).toEqual(
        before.events,
      );
      expect(await counts()).toEqual({
        contacts: 1,
        conversations: 1,
        messages: 1,
        events: 1,
      });
    },
  );
  it.each(["\t\n", "\u00a0", "\t Nome novo\u00a0"])(
    "nome existente nunca é sobrescrito pela entrada %j",
    async (incoming) => {
      await ingest([inboundEvent({ display_name: "Nome atual" })]);
      await ingest([
        inboundEvent({
          external_message_id: "wamid.f03.later",
          display_name: incoming,
        }),
      ]);
      await ingest([inboundEvent({ display_name: incoming })]);
      expect(await name()).toBe("Nome atual");
    },
  );
  it("apara bordas sem alterar caracteres internos do nome ou payload técnico", async () => {
    const rawName = "\t\n\r\u00a0 João\u00a0da Silva \u00a0\r\n\t";
    await ingest([inboundEvent({ display_name: rawName })]);
    expect(await name()).toBe("João\u00a0da Silva");
    expect(
      (
        await db.query(
          "select payload->>'display_name' as name from webhook_events",
        )
      ).rows,
    ).toEqual([{ name: rawName }]);
  });
  it("normalização e enriquecimento por duplicata continuam atômicos com inéditas", async () => {
    const original = inboundEvent({
      external_message_id: "a-f03",
      display_name: "\t\n",
    });
    await ingest([original]);
    const before = await counts();
    await expect(
      ingest([
        { ...original, display_name: "\u00a0 João\t" },
        inboundEvent({ external_message_id: "b-f03", display_name: "\t\n" }),
        { ...inboundEvent(), external_message_id: "z-f03", text_body: null },
      ]),
    ).rejects.toThrow();
    expect(await name()).toBeNull();
    expect(await counts()).toEqual(before);
    expect(
      await ingest([
        { ...original, display_name: "\u00a0 João\t" },
        inboundEvent({ external_message_id: "b-f03", display_name: "\t\n" }),
      ]),
    ).toEqual({ inserted: 1, duplicates: 1, statuses: 0 });
    expect(await name()).toBe("João");
  });
  it("upgrade 008→009 limpa somente nomes sem conteúdo e permite preencher sem reescrever histórico", async () => {
    const upgrade = new PGlite();
    try {
      await upgrade.exec(
        "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
      );
      for (const file of (await readdir("supabase/migrations"))
        .sort()
        .filter((f) => f < "202610270009"))
        await upgrade.exec(
          await readFile("supabase/migrations/" + file, "utf8"),
        );
      await upgrade.exec(
        "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Fixture F03 upgrade','10001','20001','15550000000',true)",
      );
      const legacy = [
        "\t\n",
        "\u00a0",
        " \t\r\n\u00a0 ",
        "\t Nome existente\u00a0",
      ].map((display_name, i) =>
        inboundEvent({
          display_name,
          wa_id: "1555000000" + (i + 1),
          external_message_id: "wamid.f03.legacy." + i,
        }),
      );
      await upgrade.query("select public.ingest_whatsapp_events($1::jsonb)", [
        JSON.stringify(legacy),
      ]);
      const beforeNames = (
        await upgrade.query<{ display_name: string }>(
          "select display_name from contacts order by wa_id",
        )
      ).rows;
      expect(
        beforeNames.slice(0, 3).every((row) => row.display_name !== null),
      ).toBe(true);
      const before = {
        usefulContact: (
          await upgrade.query(
            "select * from contacts where wa_id='15550000004'",
          )
        ).rows,
        messages: (await upgrade.query("select * from messages order by id"))
          .rows,
        conversations: (
          await upgrade.query("select * from conversations order by id")
        ).rows,
        events: (
          await upgrade.query("select * from webhook_events order by id")
        ).rows,
      };
      await upgrade.exec(
        await readFile(
          "supabase/migrations/202610270009_whatsapp_display_name_whitespace.sql",
          "utf8",
        ),
      );
      expect(
        (
          await upgrade.query(
            "select display_name from contacts order by wa_id",
          )
        ).rows,
      ).toEqual([
        { display_name: null },
        { display_name: null },
        { display_name: null },
        beforeNames[3],
      ]);
      expect(
        (
          await upgrade.query(
            "select * from contacts where wa_id='15550000004'",
          )
        ).rows,
      ).toEqual(before.usefulContact);
      await upgrade.exec("set role service_role");
      const result = await upgrade.query<{ result: { duplicates: number } }>(
        "select public.ingest_whatsapp_events($1::jsonb) result",
        [
          JSON.stringify(
            legacy.map((e) => ({ ...e, display_name: "\t João\u00a0" })),
          ),
        ],
      );
      expect(result.rows[0].result.duplicates).toBe(4);
      await upgrade.exec("reset role");
      expect(
        (
          await upgrade.query(
            "select display_name from contacts order by wa_id",
          )
        ).rows,
      ).toEqual([
        { display_name: "João" },
        { display_name: "João" },
        { display_name: "João" },
        beforeNames[3],
      ]);
      expect(
        (await upgrade.query("select * from messages order by id")).rows,
      ).toEqual(before.messages);
      expect(
        (await upgrade.query("select * from conversations order by id")).rows,
      ).toEqual(before.conversations);
      expect(
        (await upgrade.query("select * from webhook_events order by id")).rows,
      ).toEqual(before.events);
    } finally {
      await upgrade.close();
    }
  });
});
