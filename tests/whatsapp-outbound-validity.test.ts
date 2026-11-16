vi.mock("server-only", () => ({}));
import { runOutboundOnce } from "../src/lib/whatsapp/outbound-worker";
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
import { inboundEvent } from "./fixtures/whatsapp";
import type {
  OutboundJob,
  TransportConfig,
  TransportFailure,
} from "../src/domain/whatsapp-outbound";
let db: PGlite,
  account: string,
  serial = 0;
const admin = randomUUID(),
  agent = randomUUID();
const tables = [
  "contacts",
  "conversations",
  "messages",
  "webhook_events",
  "leads",
  "lead_events",
  "whatsapp_intake_sessions",
  "whatsapp_outbound_drafts",
  "whatsapp_outbound_jobs",
  "whatsapp_outbound_events",
];
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
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}
function event(text = "Oi", extra = {}) {
  serial++;
  return inboundEvent({
    text_body: text,
    external_message_id: "outbox.local." + serial,
    provider_timestamp: String(1800000000 + serial),
    ...extra,
  });
}
async function ingest(e = event()) {
  return role(
    "service_role",
    "select public.ingest_whatsapp_events($1::jsonb)",
    [JSON.stringify([e])],
  );
}
async function mode(value = "LIVE", actor = admin) {
  return (
    await role<TransportConfig>(
      "authenticated",
      "select * from public.set_whatsapp_outbound_transport($1,$2)",
      [account, value],
      actor,
    )
  ).rows[0];
}
async function claim() {
  return (
    await role<{
      result: { id: string; claim_token: string; attempts: number } | null;
    }>("service_role", "select public.claim_whatsapp_outbound_job($1) result", [
      account,
    ])
  ).rows[0].result;
}
async function job() {
  return (
    await db.query<OutboundJob>(
      "select * from whatsapp_outbound_jobs order by created_at desc limit 1",
    )
  ).rows[0];
}
async function begin(j?: OutboundJob) {
  j ??= await job();
  return role(
    "service_role",
    "select public.begin_whatsapp_outbound_dispatch($1,$2)",
    [j.id, j.claim_token],
  );
}
async function fail(code: TransportFailure, j?: OutboundJob) {
  j ??= await job();
  return role(
    "service_role",
    "select public.fail_whatsapp_outbound_job($1,$2,$3)",
    [j.id, j.claim_token, code],
  );
}
async function recover(j?: OutboundJob) {
  j ??= await job();
  return role(
    "service_role",
    "select public.recover_whatsapp_outbound_job($1)",
    [j.id],
  );
}
async function count(table: string) {
  return (await db.query<{ n: number }>("select count(*)::int n from " + table))
    .rows[0].n;
}
async function snapshot() {
  const result: Record<string, unknown[]> = {};
  for (const t of tables)
    result[t] = (await db.query("select * from " + t + " order by id")).rows;
  return result;
}
async function queued() {
  await mode();
  await ingest();
  return job();
}
async function expired() {
  await db.exec(
    "update whatsapp_outbound_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where status='PROCESSING'",
  );
}
async function due() {
  await db.exec(
    "update whatsapp_outbound_jobs set available_at=clock_timestamp()-interval '1 second'",
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
      "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Fixture local','10001','20001','15550000000',true) returning id",
    )
  ).rows[0].id;
  const product = (
    await db.query<{ id: string }>("select id from products limit 1")
  ).rows[0].id;
  for (const [id, r] of [
    [admin, "ADMIN"],
    [agent, "AGENT"],
  ]) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query(
      "select public.provision_employee($1,'Fixture local',$2,'',$3,$4)",
      [id, id + "@example.com", [product], r],
    );
  }
});
beforeEach(async () => {
  await db.exec(
    "truncate contacts,conversations,messages,webhook_events,leads,lead_events,whatsapp_outbound_transport_config,whatsapp_outbound_events cascade",
  );
});
afterAll(async () => {
  await db.close();
});
async function allJobs() {
  return (
    await db.query<OutboundJob>(
      "select * from whatsapp_outbound_jobs order by draft_sequence",
    )
  ).rows;
}
async function convert() {
  const j = (await allJobs())[0];
  const p = (await db.query<{ id: string }>("select id from products limit 1"))
    .rows[0].id;
  return role(
    "authenticated",
    "select public.convert_conversation_to_lead($1,'Teste','15550000001','','','',$2,'')",
    [j.conversation_id, p],
    admin,
  );
}
describe("03B2B1 validade e ordenação", () => {
  it("A: NAME é superseded; PRODUCT é único elegível e auditoria técnica tem actor NULL", async () => {
    await queued();
    await ingest(event("Ana Teste"));
    const jobs = await allJobs();
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      status: "CANCELLED",
      cancellation_reason: "PROMPT_SUPERSEDED",
      attempts: 0,
    });
    expect((await claim())?.id).toBe(jobs[1].id);
    expect(
      (
        await db.query(
          "select actor_id,action from whatsapp_outbound_events where action='PROMPT_SUPERSEDED'",
        )
      ).rows,
    ).toEqual([{ actor_id: null, action: "PROMPT_SUPERSEDED" }]);
  });
  it("B: correção após resposta inválida substitui a pergunta", async () => {
    await queued();
    await ingest(event("Ana Teste"));
    await ingest(event("Consórcio"));
    await ingest(event("Vitória"));
    const jobs = await allJobs();
    expect(jobs.slice(0, -1).every((j) => j.status === "CANCELLED")).toBe(true);
    expect((await claim())?.id).toBe(jobs.at(-1)?.id);
    expect(
      (
        await db.query<{ text_body: string }>(
          "select text_body from whatsapp_outbound_drafts order by sequence desc limit 1",
        )
      ).rows[0].text_body,
    ).toContain("UF brasileira válida");
  });
  it("C: três inbounds num lote preservam drafts mas somente o último é elegível", async () => {
    await mode();
    await role(
      "service_role",
      "select public.ingest_whatsapp_events($1::jsonb)",
      [JSON.stringify(["Oi", "Ana Teste", "Consórcio"].map((t) => event(t)))],
    );
    const jobs = await allJobs();
    expect(jobs.map((j) => j.status)).toEqual([
      "CANCELLED",
      "CANCELLED",
      "QUEUED",
    ]);
    expect(await count("whatsapp_outbound_drafts")).toBe(3);
    expect((await claim())?.id).toBe(jobs[2].id);
  });
  it("D: conversão manual invalida na mesma transação, sem alterar proteção ADMIN", async () => {
    await queued();
    await convert();
    expect(await job()).toMatchObject({
      status: "CANCELLED",
      cancellation_reason: "CONVERSATION_CONVERTED",
    });
    expect(await claim()).toBeNull();
    expect(
      await count(
        "whatsapp_outbound_events where action='CONVERSATION_CONVERTED_INVALIDATION' and actor_id is null",
      ),
    ).toBe(1);
  });
  it("E: fechar invalida e reabrir não ressuscita prompt", async () => {
    await queued();
    await db.exec("update conversations set status='CLOSED'");
    expect(await job()).toMatchObject({
      status: "CANCELLED",
      cancellation_reason: "CONVERSATION_CLOSED",
    });
    await db.exec("update conversations set status='OPEN'");
    expect(await claim()).toBeNull();
  });
  it("F: completion acknowledgement é elegível mesmo com lead_id", async () => {
    await mode();
    for (const t of [
      "Oi",
      "Ana Teste",
      "Consórcio",
      "Vitória/ES",
      "teste@example.com",
      "não",
    ])
      await ingest(event(t));
    const jobs = await allJobs();
    expect(jobs.map((j) => j.status)).toEqual([
      "CANCELLED",
      "CANCELLED",
      "CANCELLED",
      "CANCELLED",
      "CANCELLED",
      "QUEUED",
    ]);
    expect(jobs[4].cancellation_reason).toBe("CONVERSATION_CONVERTED");
    expect(await count("leads")).toBe(1);
    expect((await claim())?.id).toBe(jobs[5].id);
    await begin();
    expect(await count("messages where direction='OUTBOUND'")).toBe(0);
  });
  it("G: PROCESSING antes de begin é invalidado, revoga token e preserva attempts", async () => {
    await queued();
    await claim();
    const old = await job();
    await ingest(event("Ana Teste"));
    expect((await allJobs())[0]).toMatchObject({
      status: "CANCELLED",
      claim_token: null,
      attempts: 1,
    });
    await expect(begin(old)).rejects.toThrow("inválido");
    expect((await claim())?.id).toBe((await job()).id);
  });
  it.each(["ACCEPTED", "FAILED"] as const)(
    "H/J: dispatch iniciado bloqueia sucessor até %s",
    async (status) => {
      await queued();
      await claim();
      const old = await job();
      await begin(old);
      await ingest(event("Ana Teste"));
      expect((await allJobs())[0].status).toBe("PROCESSING");
      expect(await claim()).toBeNull();
      if (status === "ACCEPTED")
        await role(
          "service_role",
          "select public.accept_fake_whatsapp_outbound($1,$2,$3)",
          [old.id, old.claim_token, randomUUID()],
        );
      else await fail("PERMANENT_REJECTION", old);
      expect((await claim())?.id).toBe((await job()).id);
    },
  );
  it("I: RECONCILIATION_REQUIRED bloqueia mesmo depois de reativar geração", async () => {
    await queued();
    await claim();
    const old = await job();
    await begin(old);
    await fail("NETWORK_UNCERTAIN", old);
    await mode("DISABLED");
    await mode();
    await ingest(event("Ana Teste"));
    await due();
    expect(await claim()).toBeNull();
    expect((await allJobs())[0].status).toBe("RECONCILIATION_REQUIRED");
  });
  it("recuperação após begin preserva marcador e bloqueia sucessor", async () => {
    await queued();
    await claim();
    const old = await job();
    await begin(old);
    await ingest(event("Ana Teste"));
    await expired();
    await recover(old);
    expect((await allJobs())[0].status).toBe("RECONCILIATION_REQUIRED");
    expect(await claim()).toBeNull();
  });
  it("J: cancelamento humano tem motivo/ator distintos e libera próximo prompt", async () => {
    await queued();
    const old = await job();
    await role(
      "authenticated",
      "select public.cancel_whatsapp_outbound_job($1)",
      [old.id],
      admin,
    );
    expect(await job()).toMatchObject({
      status: "CANCELLED",
      cancellation_reason: "ADMIN_CANCELLED",
    });
    expect(
      (
        await db.query(
          "select actor_id from whatsapp_outbound_events where action='CANCELLED'",
        )
      ).rows,
    ).toEqual([{ actor_id: admin }]);
    await ingest(event("Ana Teste"));
    expect(await claim()).not.toBeNull();
  });
  it("K: duas conversas podem ficar PROCESSING", async () => {
    await queued();
    await ingest(event("Oi", { wa_id: "15550000002" }));
    const a = await claim(),
      b = await claim();
    expect(a && b && a.id !== b.id).toBe(true);
    expect(
      await count("whatsapp_outbound_jobs where status='PROCESSING'"),
    ).toBe(2);
  });
  it("L: índice parcial impede dois PROCESSING mesmo em escrita proprietária", async () => {
    await queued();
    await claim();
    await begin();
    await ingest(event("Ana Teste"));
    const next = await job();
    await expect(
      db.query(
        "update whatsapp_outbound_jobs set status='PROCESSING',attempts=1,locked_at=now(),lease_expires_at=now()+interval '2 minutes',claim_token=gen_random_uuid() where id=$1",
        [next.id],
      ),
    ).rejects.toThrow("whatsapp_one_processing_per_conversation");
  });
  it("M: duplicata não duplica invalidação nem job", async () => {
    await queued();
    const e = event("Ana Teste");
    await ingest(e);
    const before = await snapshot();
    await ingest({ ...e, display_name: "Nome diferente" });
    expect(await snapshot()).toEqual(before);
  });
  it("N: geração antiga e período desligado nunca são promovidos pela reativação", async () => {
    await queued();
    await mode("DISABLED");
    await mode();
    expect(await claim()).toBeNull();
    await mode("DISABLED");
    await ingest(event("Ana Teste"));
    expect(await count("whatsapp_outbound_jobs")).toBe(1);
    expect((await allJobs())[0].status).toBe("CANCELLED");
    await mode();
    expect(await claim()).toBeNull();
  });
  it.each(["conversion", "close", "supersede"])(
    "rollback de %s inclui invalidação e auditoria",
    async (change) => {
      await queued();
      const before = await snapshot();
      await db.exec(
        "alter table whatsapp_outbound_events add constraint force_invalidation_failure check(action not in ('PROMPT_SUPERSEDED','CONVERSATION_CONVERTED_INVALIDATION','CONVERSATION_CLOSED_INVALIDATION')) not valid",
      );
      try {
        const op =
          change === "conversion"
            ? convert()
            : change === "close"
              ? db.exec("update conversations set status='CLOSED'")
              : ingest(event("Ana Teste"));
        await expect(op).rejects.toThrow("force_invalidation_failure");
      } finally {
        await db.exec(
          "alter table whatsapp_outbound_events drop constraint force_invalidation_failure",
        );
      }
      expect(await snapshot()).toEqual(before);
    },
  );
  it("begin revalida predecessor mesmo se um estado inconsistente for injetado pelo proprietário", async () => {
    await queued();
    const old = await job();
    await ingest(event("Ana Teste"));
    await claim();
    const latest = await job();
    await db.query(
      "update whatsapp_outbound_jobs set status='RECONCILIATION_REQUIRED',cancellation_reason=null where id=$1",
      [old.id],
    );
    expect((await begin(latest)).rows).toEqual([
      { begin_whatsapp_outbound_dispatch: null },
    ]);
  });
  it.each(["closed", "converted", "newer-draft"])(
    "begin revalida %s mesmo sem invalidar status via trigger na fixture",
    async (kind) => {
      await queued();
      await claim();
      const j = await job();
      if (kind === "newer-draft") {
        await db.exec(
          "alter table whatsapp_outbound_drafts disable trigger whatsapp_draft_enqueue",
        );
        try {
          await ingest(event("Ana Teste"));
        } finally {
          await db.exec(
            "alter table whatsapp_outbound_drafts enable trigger whatsapp_draft_enqueue",
          );
        }
      } else {
        await db.exec(
          "alter table conversations disable trigger whatsapp_conversation_prompt_validity",
        );
        try {
          if (kind === "closed")
            await db.exec("update conversations set status='CLOSED'");
          else await convert();
        } finally {
          await db.exec(
            "alter table conversations enable trigger whatsapp_conversation_prompt_validity",
          );
        }
      }
      expect((await begin(j)).rows).toEqual([
        { begin_whatsapp_outbound_dispatch: null },
      ]);
    },
  );
  it("funções internas 013 sem EXECUTE para roles API e com search_path vazio", async () => {
    const rows = (
      await db.query<{
        prosecdef: boolean;
        proconfig: string[];
        a: boolean;
        b: boolean;
        c: boolean;
      }>(
        "select prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') a,has_function_privilege('authenticated',oid,'EXECUTE') b,has_function_privilege('service_role',oid,'EXECUTE') c from pg_proc where proname in ('invalidate_whatsapp_prompts','invalidate_conversation_prompts','whatsapp_job_is_current')",
      )
    ).rows;
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.prosecdef).toBe(true);
      expect(r.proconfig).toContain('search_path=""');
      expect([r.a, r.b, r.c]).toEqual([false, false, false]);
    }
  });
});

it("worker não chama provider quando SQL invalida o claim antes de begin", async () => {
  await queued();
  const send = vi.fn(async () => ({
    status: "ACCEPTED_FAKE" as const,
    receipt: randomUUID(),
  }));
  const result = await runOutboundOnce(
    account,
    {
      claim: async () => claim(),
      begin: async (c) => {
        await ingest(event("Ana Teste"));
        return (
          await role<{ result: null }>(
            "service_role",
            "select public.begin_whatsapp_outbound_dispatch($1,$2) result",
            [c.id, c.claim_token],
          )
        ).rows[0].result;
      },
      acceptFake: async () => {
        throw new Error("Não deveria confirmar");
      },
      fail: async () => {
        throw new Error("Não deveria reportar provider");
      },
    },
    { kind: "FAKE", send },
  );
  expect(result).toBe("RECOVERY_REQUIRED");
  expect(send).not.toHaveBeenCalled();
  expect((await allJobs())[0].status).toBe("CANCELLED");
});
it.each(["anon", "authenticated", "service_role"])(
  "%s não fabrica versão, sequência ou motivo",
  async (r) => {
    await queued();
    await expect(
      role(
        r,
        "update public.whatsapp_outbound_jobs set validity_version=1,draft_sequence=99,cancellation_reason=null",
        [],
        admin,
      ),
    ).rejects.toThrow("permission denied");
  },
);
