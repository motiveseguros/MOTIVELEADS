import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { OutboundJob } from "../src/domain/whatsapp-outbound";
import type { Message } from "../src/domain/whatsapp";
let db: PGlite, account: string;
const admin = randomUUID(),
  agent = randomUUID();
let seq = 0;
async function asRole<T>(
  name: string,
  sql: string,
  args: unknown[] = [],
  actor = "",
) {
  await db.exec("set role " + name);
  await db.query<Record<string, unknown>>(
    "select set_config('request.jwt.claim.sub',$1,false)",
    [actor],
  );
  try {
    return await db.query<T>(sql, args);
  } finally {
    await db.exec("reset role");
    await db.query<Record<string, unknown>>(
      "select set_config('request.jwt.claim.sub','',false)",
    );
  }
}
async function ingest(
  text = "Oi",
  wa = "15550000001",
  seconds = Math.floor(Date.now() / 1000) - 10,
) {
  return asRole(
    "service_role",
    "select public.ingest_whatsapp_events($1::jsonb)",
    [
      JSON.stringify([
        {
          kind: "inbound",
          waba_id: "10001",
          phone_number_id: "20001",
          external_message_id: "meta.fixture." + ++seq,
          provider_timestamp: String(seconds),
          wa_id: wa,
          type: "text",
          text_body: text,
        },
      ]),
    ],
  );
}
async function status(id: string, value = "SENT", extra = {}) {
  return asRole(
    "service_role",
    "select public.ingest_whatsapp_events($1::jsonb)",
    [
      JSON.stringify([
        {
          kind: "status",
          waba_id: "10001",
          phone_number_id: "20001",
          external_message_id: id,
          provider_timestamp: "1800000000",
          wa_id: "15550000001",
          status: value,
          ...extra,
        },
      ]),
    ],
  );
}
async function jobs() {
  return (
    await db.query<OutboundJob>(
      "select * from whatsapp_outbound_jobs order by draft_sequence",
    )
  ).rows;
}
async function claim() {
  return (
    await asRole<{
      j: { id: string; claim_token: string; attempts: number } | null;
    }>("service_role", "select public.claim_whatsapp_outbound_job($1) j", [
      account,
    ])
  ).rows[0].j;
}
async function begin(j: { id: string; claim_token: string }) {
  return (
    await asRole<{ v: unknown }>(
      "service_role",
      "select public.begin_whatsapp_outbound_dispatch($1,$2) v",
      [j.id, j.claim_token],
    )
  ).rows[0].v;
}
async function setup(wa = "15550000001") {
  await ingest("Oi", wa);
  const j = await claim();
  if (!j) throw new Error("Expected claim");
  await begin(j);
  return j;
}
async function accept(
  j: { id: string; claim_token: string },
  id = "wamid.FIXTURE_META",
) {
  return (
    await asRole<{ id: string }>(
      "service_role",
      "select public.accept_meta_whatsapp_outbound($1,$2,$3) id",
      [j.id, j.claim_token, id],
    )
  ).rows[0].id;
}
async function messages() {
  return (
    await db.query<Message>("select * from messages where direction='OUTBOUND'")
  ).rows;
}
async function fail(
  j: { id: string; claim_token: string },
  code = "NETWORK_UNCERTAIN",
) {
  return asRole(
    "service_role",
    "select public.fail_meta_whatsapp_outbound_job($1,$2,$3,503,131000,1)",
    [j.id, j.claim_token, code],
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;grant usage on schema public to anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const f of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  account = (
    await db.query<{ id: string }>(
      "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('LOCAL META','10001','20001','15550000000',true) returning id",
    )
  ).rows[0].id;
  for (const [id, r] of [
    [admin, "ADMIN"],
    [agent, "AGENT"],
  ]) {
    await db.query<Record<string, unknown>>(
      "insert into auth.users values($1)",
      [id],
    );
    await db.query<Record<string, unknown>>(
      "select public.provision_employee($1,'Local',$2,'',array(select id from products),$3)",
      [id, id + "@example.com", r],
    );
  }
});
beforeEach(async () => {
  await db.exec(
    "truncate contacts,conversations,messages,webhook_events,leads,lead_events,whatsapp_outbound_transport_config,whatsapp_outbound_events cascade",
  );
  await asRole(
    "authenticated",
    "select public.set_whatsapp_outbound_transport($1,'LIVE')",
    [account],
    admin,
  );
});
afterAll(async () => {
  await db.close();
});
it("A–C aceita UMA saída PENDING com texto original, vínculo e timestamp provider NULL", async () => {
  const j = await setup();
  const mid = await accept(j);
  expect(await messages()).toHaveLength(1);
  expect((await messages())[0]).toMatchObject({
    id: mid,
    external_message_id: "wamid.FIXTURE_META",
    direction: "OUTBOUND",
    status: "PENDING",
    provider_timestamp: null,
    sent_by_profile_id: null,
    type: "text",
  });
  expect((await jobs())[0]).toMatchObject({
    status: "ACCEPTED",
    provider_kind: "META",
    outbound_message_id: mid,
    provider_message_id: "wamid.FIXTURE_META",
    locked_at: null,
    lease_expires_at: null,
  });
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select text_body from whatsapp_outbound_drafts",
      )
    ).rows[0],
  ).toEqual({ text_body: (await messages())[0].text_body });
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select action,actor_id from whatsapp_outbound_events where action='ACCEPTED_META'",
      )
    ).rows,
  ).toEqual([{ action: "ACCEPTED_META", actor_id: null }]);
});
it("D repetição após lease mesmo token/wamid é no-op", async () => {
  const j = await setup();
  const first = await accept(j);
  expect(await accept(j)).toBe(first);
  expect(await messages()).toHaveLength(1);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select count(*)::int n from whatsapp_outbound_events where action='ACCEPTED_META'",
      )
    ).rows[0].n,
  ).toBe(1);
});
it("E wamid divergente e token divergente recusados após aceitação", async () => {
  const j = await setup();
  await accept(j);
  await expect(accept(j, "wamid.OTHER")).rejects.toThrow();
  await expect(accept({ ...j, claim_token: randomUUID() })).rejects.toThrow();
  expect(await messages()).toHaveLength(1);
});
it("F wamid não pode pertencer a dois jobs", async () => {
  const a = await setup();
  await accept(a);
  const b = await setup("15550000002");
  await expect(accept(b)).rejects.toThrow();
  expect(await messages()).toHaveLength(1);
  expect((await jobs())[1].status).toBe("PROCESSING");
});
it("G sem begin não aceita", async () => {
  await ingest();
  const j = await claim();
  if (!j) throw new Error("claim");
  await expect(accept(j)).rejects.toThrow();
  expect(await messages()).toHaveLength(0);
});
it("H token inválido não aceita", async () => {
  const j = await setup();
  await expect(accept({ ...j, claim_token: randomUUID() })).rejects.toThrow();
  expect(await messages()).toHaveLength(0);
});
it("I lease vencida exige reconciliação, sem mensagem", async () => {
  const j = await setup();
  await db.query<Record<string, unknown>>(
    "update whatsapp_outbound_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
    [j.id],
  );
  await expect(accept(j)).rejects.toThrow();
  expect(await messages()).toHaveLength(0);
  expect((await jobs())[0].dispatch_started_at).not.toBeNull();
});
it.each(["messages", "whatsapp_outbound_events", "conversations"])(
  "rollback atômico se falhar %s",
  async (table) => {
    const j = await setup();
    await db.exec(
      "create function public.reject_meta_fixture() returns trigger language plpgsql as $$ begin raise exception 'fixture failure'; end $$;create trigger reject_meta_fixture before " +
        (table === "conversations" ? "update" : "insert") +
        " on public." +
        table +
        " for each row execute function public.reject_meta_fixture()",
    );
    try {
      await expect(accept(j)).rejects.toThrow("fixture failure");
      expect(await messages()).toHaveLength(0);
      expect((await jobs())[0]).toMatchObject({
        status: "PROCESSING",
        outbound_message_id: null,
        provider_message_id: null,
      });
    } finally {
      await db.exec(
        "drop trigger reject_meta_fixture on public." +
          table +
          ";drop function public.reject_meta_fixture()",
      );
    }
  },
);
it("L legado não é promovido nem expirado", async () => {
  await ingest();
  await db.exec("update whatsapp_outbound_jobs set validity_version=0");
  expect(await claim()).toBeNull();
  expect((await jobs())[0]).toMatchObject({
    validity_version: 0,
    status: "QUEUED",
    attempts: 0,
  });
});
it("M superseded não chega ao begin", async () => {
  await ingest();
  const j = await claim();
  if (!j) throw new Error("claim");
  await ingest("Ana Teste");
  await expect(begin(j)).rejects.toThrow();
  expect((await jobs())[0]).toMatchObject({
    status: "CANCELLED",
    cancellation_reason: "PROMPT_SUPERSEDED",
    claim_token: null,
  });
});
it("N incerteza após dispatch bloqueia sucessor", async () => {
  const j = await setup();
  await fail(j);
  await ingest("Ana Teste");
  expect(await claim()).toBeNull();
  expect((await jobs())[0].status).toBe("RECONCILIATION_REQUIRED");
});
it.each(["SENT", "DELIVERED", "READ", "FAILED"])(
  "O–R status %s atualiza mesma linha, sem fabricar timestamp",
  async (s) => {
    const j = await setup();
    const mid = await accept(j);
    await status("wamid.FIXTURE_META", s);
    expect(await messages()).toHaveLength(1);
    expect((await messages())[0]).toMatchObject({
      id: mid,
      status: s,
      provider_timestamp: null,
    });
  },
);
it("P–R precedência PENDING<SENT<FAILED<DELIVERED<READ, fora de ordem não regride", async () => {
  await accept(await setup());
  for (const s of [
    "SENT",
    "FAILED",
    "DELIVERED",
    "READ",
    "SENT",
    "FAILED",
    "DELIVERED",
  ])
    await status("wamid.FIXTURE_META", s);
  expect((await messages())[0].status).toBe("READ");
});
it("S wa_id divergente não toca mensagem", async () => {
  await accept(await setup());
  await expect(
    status("wamid.FIXTURE_META", "READ", { wa_id: "15550000002" }),
  ).rejects.toThrow();
  expect((await messages())[0].status).toBe("PENDING");
});
it("S outra conta não pode usar wamid existente", async () => {
  await accept(await setup());
  await db.exec(
    "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('OTHER','10002','20002','15550000009',true)",
  );
  await expect(
    status("wamid.FIXTURE_META", "READ", {
      waba_id: "10002",
      phone_number_id: "20002",
    }),
  ).rejects.toThrow();
  expect((await messages())[0].status).toBe("PENDING");
  await db.exec("delete from whatsapp_accounts where phone_number_id='20002'");
});
it("T duplicata de status preserva uma mensagem e um evento", async () => {
  await accept(await setup());
  await status("wamid.FIXTURE_META");
  const count = (
    await db.query<Record<string, unknown>>(
      "select count(*)::int n from webhook_events",
    )
  ).rows;
  await status("wamid.FIXTURE_META");
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select count(*)::int n from webhook_events",
      )
    ).rows,
  ).toEqual(count);
  expect(await messages()).toHaveLength(1);
});
it("status antes de accept fica durável e é reconciliado na mesma transação", async () => {
  const j = await setup();
  await status("wamid.EARLY", "READ");
  await status("wamid.EARLY", "DELIVERED");
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select resolved_message_id from whatsapp_pending_statuses",
      )
    ).rows,
  ).toEqual([{ resolved_message_id: null }, { resolved_message_id: null }]);
  await status("wamid.EARLY", "READ");
  const mid = await accept(j, "wamid.EARLY");
  expect((await messages())[0]).toMatchObject({ id: mid, status: "READ" });
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select resolved_message_id from whatsapp_pending_statuses",
      )
    ).rows.every((r) => r.resolved_message_id === mid),
  ).toBe(true);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select count(*)::int n from webhook_events where processed_at is null",
      )
    ).rows[0].n,
  ).toBe(0);
});
it("status antecipado de contato divergente não é adotado", async () => {
  const j = await setup();
  await ingest("Oi", "15550000002");
  await status("wamid.MISMATCH", "READ", { wa_id: "15550000002" });
  await expect(accept(j, "wamid.MISMATCH")).rejects.toThrow();
  expect(await messages()).toHaveLength(0);
});
it("janela vencida cancela antes de claim com motivo explícito", async () => {
  await ingest("Oi", "15550000001", Math.floor(Date.now() / 1000) - 86401);
  expect(await claim()).toBeNull();
  expect((await jobs())[0]).toMatchObject({
    status: "CANCELLED",
    cancellation_reason: "CUSTOMER_SERVICE_WINDOW_EXPIRED",
    attempts: 0,
  });
});
it("janela vence entre claim e begin, nenhuma autorização", async () => {
  await ingest();
  const j = await claim();
  if (!j) throw new Error("claim");
  await db.exec(
    "update messages set provider_timestamp=clock_timestamp()-interval '25 hours' where direction='INBOUND'",
  );
  expect(await begin(j)).toBeNull();
  expect((await jobs())[0]).toMatchObject({
    status: "CANCELLED",
    dispatch_started_at: null,
    claim_token: null,
  });
});
it("inbound futuro não abre janela", async () => {
  await ingest("Oi", "15550000001", Math.floor(Date.now() / 1000) + 3600);
  expect(await claim()).toBeNull();
});
it.each(["RATE_LIMITED", "TEMPORARY_UNAVAILABLE", "PERMANENT_REJECTION"])(
  "recusa %s termina FAILED sem retry pós-dispatch",
  async (code) => {
    const j = await setup();
    await fail(j, code);
    expect((await jobs())[0]).toMatchObject({
      status: "FAILED",
      provider_http_status: 503,
      provider_error_code: 131000,
      provider_error_subcode: 1,
    });
    expect(await claim()).toBeNull();
  },
);
it("ordem timeline/inbox usa created_at na saída e preserva inbound", async () => {
  const j = await setup();
  const old = (
    await db.query<Record<string, unknown>>(
      "select provider_timestamp from messages where direction='INBOUND'",
    )
  ).rows;
  const mid = await accept(j);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select id from message_timeline order by timeline_at desc,created_at desc,id desc limit 1",
      )
    ).rows[0].id,
  ).toBe(mid);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select last_message_text from conversation_inbox",
      )
    ).rows[0].last_message_text,
  ).toBe((await messages())[0].text_body);
  expect(
    (
      await db.query<Record<string, unknown>>(
        "select provider_timestamp from messages where direction='INBOUND'",
      )
    ).rows,
  ).toEqual(old);
});
it.each(["anon", "authenticated"])(
  "RPCs técnicas negadas para %s, inclusive ADMIN/AGENT",
  async (r) => {
    const j = await setup();
    for (const actor of [admin, agent]) {
      await expect(
        asRole(
          r,
          "select public.accept_meta_whatsapp_outbound($1,$2,$3)",
          [j.id, j.claim_token, "wamid.DENIED"],
          actor,
        ),
      ).rejects.toThrow("permission denied");
      await expect(
        asRole(
          r,
          "select public.fail_meta_whatsapp_outbound_job($1,$2,'NETWORK_UNCERTAIN')",
          [j.id, j.claim_token],
          actor,
        ),
      ).rejects.toThrow("permission denied");
    }
  },
);
it.each(["anon", "authenticated", "service_role"])(
  "pending status sem leitura/escrita direta %s",
  async (r) => {
    await expect(
      asRole(r, "select * from whatsapp_pending_statuses", [], admin),
    ).rejects.toThrow("permission denied");
    await expect(
      asRole(r, "delete from whatsapp_pending_statuses", [], admin),
    ).rejects.toThrow("permission denied");
  },
);

it("OUTBOUND usa RLS comercial após atribuição, sem liberar painel técnico", async () => {
  const mid = await accept(await setup());
  const cid = (await messages())[0].conversation_id;
  expect(
    (
      await asRole(
        "authenticated",
        "select id from message_timeline where id=$1",
        [mid],
        agent,
      )
    ).rows,
  ).toHaveLength(0);
  const product = (
    await db.query<{ id: string }>("select id from products limit 1")
  ).rows[0].id;
  const lead = (
    await asRole<{ id: string }>(
      "authenticated",
      "select public.convert_conversation_to_lead($1,'Local','15550000001','','','',$2,'') id",
      [cid, product],
      admin,
    )
  ).rows[0].id;
  const employee = (
    await db.query<{ id: string }>(
      "select id from employees where profile_id=$1",
      [agent],
    )
  ).rows[0].id;
  await asRole(
    "authenticated",
    "select public.assign_lead($1,$2,null)",
    [lead, employee],
    admin,
  );
  expect(
    (
      await asRole(
        "authenticated",
        "select id from message_timeline where id=$1",
        [mid],
        agent,
      )
    ).rows,
  ).toHaveLength(1);
  for (const t of [
    "whatsapp_outbound_jobs",
    "whatsapp_outbound_events",
    "whatsapp_outbound_transport_config",
  ])
    expect(
      (await asRole("authenticated", "select * from " + t, [], agent)).rows,
    ).toHaveLength(0);
});

it("limite de pendências falha fechado sem evento parcial", async () => {
  await ingest();
  await db.exec(
    "insert into webhook_events(provider,event_key,payload) select 'WHATSAPP','cap:'||n,'{}'::jsonb from generate_series(1,1000) n;insert into whatsapp_pending_statuses(event_id,whatsapp_account_id,external_message_id,wa_id,status,provider_timestamp) select id,'" +
      account +
      "',event_key,'15550000001','READ',now() from webhook_events where event_key like 'cap:%'",
  );
  const before = (
    await db.query<Record<string, unknown>>(
      "select count(*)::int n from webhook_events",
    )
  ).rows;
  await expect(status("wamid.CAP")).rejects.toThrow("pendentes");
  expect(
    (await db.query("select count(*)::int n from webhook_events")).rows,
  ).toEqual(before);
});
it("status pendente e inbound inédito revertem juntos em lote inválido", async () => {
  await ingest();
  const before = (await db.query("select * from webhook_events")).rows;
  await expect(
    asRole("service_role", "select public.ingest_whatsapp_events($1::jsonb)", [
      JSON.stringify([
        {
          kind: "status",
          waba_id: "10001",
          phone_number_id: "20001",
          external_message_id: "wamid.BATCH",
          provider_timestamp: "1800000000",
          wa_id: "15550000001",
          status: "READ",
        },
        {
          kind: "inbound",
          waba_id: "99999",
          phone_number_id: "99999",
          external_message_id: "bad.fixture",
          provider_timestamp: "1800000000",
          wa_id: "15550000001",
          type: "text",
          text_body: "Oi",
        },
      ]),
    ]),
  ).rejects.toThrow();
  expect((await db.query("select * from webhook_events")).rows).toEqual(before);
  expect(
    (await db.query("select * from whatsapp_pending_statuses")).rows,
  ).toHaveLength(0);
});
it("falha de aceitação mantém status antecipado pendente sem consumo parcial", async () => {
  const j = await setup();
  await status("wamid.ROLLBACK", "READ");
  await db.exec(
    "create function public.reject_pending_fixture() returns trigger language plpgsql as $$ begin raise exception 'fixture rollback'; end $$;create trigger reject_pending_fixture before update on whatsapp_pending_statuses for each row execute function public.reject_pending_fixture()",
  );
  try {
    await expect(accept(j, "wamid.ROLLBACK")).rejects.toThrow(
      "fixture rollback",
    );
    expect(await messages()).toHaveLength(0);
    expect((await jobs())[0].status).toBe("PROCESSING");
    expect(
      (
        await db.query(
          "select resolved_message_id from whatsapp_pending_statuses",
        )
      ).rows,
    ).toEqual([{ resolved_message_id: null }]);
  } finally {
    await db.exec(
      "drop trigger reject_pending_fixture on whatsapp_pending_statuses;drop function public.reject_pending_fixture()",
    );
  }
});
