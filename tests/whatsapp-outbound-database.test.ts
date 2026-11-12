import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
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
  for (const f of (await readdir("supabase/migrations"))
    .sort()
    .filter((f) => f < "202611120012"))
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
  for (const text of [
    "Oi",
    "Ana Teste",
    "consórcio",
    "Vitória/ES",
    "teste@example.com",
    "não",
  ])
    await ingest(event(text));
  const before = (
    await db.query("select * from whatsapp_outbound_drafts order by sequence")
  ).rows;
  expect(before).toHaveLength(6);
  await db.exec(
    await readFile(
      "supabase/migrations/202611120012_whatsapp_outbound_outbox.sql",
      "utf8",
    ),
  );
  expect(
    (await db.query("select * from whatsapp_outbound_drafts order by sequence"))
      .rows,
  ).toEqual(before);
  expect(await count("whatsapp_outbound_jobs")).toBe(0);
  await mode();
  expect(await count("whatsapp_outbound_jobs")).toBe(0);
  expect(await count("messages where direction='OUTBOUND'")).toBe(0);
});
beforeEach(async () => {
  await db.exec(
    "truncate contacts,conversations,messages,webhook_events,leads,lead_events,whatsapp_outbound_transport_config,whatsapp_outbound_events cascade;update employees set active=true;update whatsapp_accounts set active=true",
  );
});
afterAll(async () => {
  await db.close();
});

describe("03B2A: fronteira, atomicidade e ausência de replay", () => {
  it("sem configuração e DISABLED produzem somente drafts", async () => {
    await ingest();
    await mode("DISABLED");
    await ingest(event("Ana Teste"));
    expect(await count("whatsapp_outbound_drafts")).toBe(2);
    expect(await count("whatsapp_outbound_jobs")).toBe(0);
    expect(await claim()).toBeNull();
  });
  it("ativação não enfileira histórico; só próximo draft recebe job", async () => {
    await ingest();
    const c = await mode();
    expect(c.activation_draft_sequence).toBeGreaterThan(0);
    expect(await count("whatsapp_outbound_jobs")).toBe(0);
    await ingest(event("Ana Teste"));
    expect(await count("whatsapp_outbound_jobs")).toBe(1);
    expect(await count("messages where direction='OUTBOUND'")).toBe(0);
  });
  it("ativação repetida preserva fronteira e auditoria", async () => {
    const first = await mode();
    await ingest();
    expect(await mode()).toEqual(first);
    expect(
      await count("whatsapp_outbound_events where action='ACTIVATED'"),
    ).toBe(1);
  });
  it("nova ativação exclui período desligado e retém jobs da geração anterior", async () => {
    await queued();
    const old = await job();
    await mode("DISABLED");
    await ingest(event("Ana Teste"));
    expect(await count("whatsapp_outbound_jobs")).toBe(1);
    expect(await claim()).toBeNull();
    const config = await mode();
    expect(config.generation).toBe(2);
    expect(await claim()).toBeNull();
    await ingest(event("consórcio"));
    expect(await count("whatsapp_outbound_jobs")).toBe(2);
    expect((await claim())?.id).not.toBe(old.id);
  });
  it("duplicata de webhook não cria segundo draft/job mesmo com nome diferente", async () => {
    await mode();
    const e = event();
    await ingest(e);
    const before = await snapshot();
    await ingest({ ...e, display_name: "Outro nome" });
    expect(await snapshot()).toEqual(before);
  });
  it("draft_id UNIQUE e atualização de draft histórico não enfileiram", async () => {
    await ingest();
    await mode();
    await db.exec("update whatsapp_outbound_drafts set text_body=text_body");
    expect(await count("whatsapp_outbound_jobs")).toBe(0);
    await ingest(event("Ana Teste"));
    const j = await job();
    await expect(
      db.query(
        "insert into whatsapp_outbound_jobs(draft_id,whatsapp_account_id,conversation_id,contact_id,activation_generation) select draft_id,whatsapp_account_id,conversation_id,contact_id,activation_generation from whatsapp_outbound_jobs where id=$1",
        [j.id],
      ),
    ).rejects.toThrow("unique");
  });
  it.each(["whatsapp_outbound_jobs", "whatsapp_outbound_events"])(
    "falha em %s reverte TODO inbound e draft",
    async (table) => {
      await mode();
      const before = await snapshot();
      await db.exec(
        "alter table " +
          table +
          " add constraint forced_outbox_failure check(false) not valid",
      );
      try {
        await expect(ingest()).rejects.toThrow("forced_outbox_failure");
      } finally {
        await db.exec(
          "alter table " + table + " drop constraint forced_outbox_failure",
        );
      }
      expect(await snapshot()).toEqual(before);
    },
  );
  it("falha no job final reverte lead, vínculo, dois eventos e COMPLETE", async () => {
    await mode();
    for (const t of [
      "Oi",
      "Ana Teste",
      "consórcio",
      "Vitória/ES",
      "teste@example.com",
    ])
      await ingest(event(t));
    const before = await snapshot();
    await db.exec(
      "alter table whatsapp_outbound_jobs add constraint forced_completion_failure check(false) not valid",
    );
    try {
      await expect(ingest(event("não"))).rejects.toThrow(
        "forced_completion_failure",
      );
    } finally {
      await db.exec(
        "alter table whatsapp_outbound_jobs drop constraint forced_completion_failure",
      );
    }
    expect(await snapshot()).toEqual(before);
    await ingest(event("não"));
    expect(await count("leads")).toBe(1);
    expect(await count("whatsapp_outbound_jobs")).toBe(6);
  });
  it("conta inativa não ativa nem permite claim", async () => {
    await queued();
    await db.exec("update whatsapp_accounts set active=false");
    expect(await claim()).toBeNull();
    await mode("DISABLED");
    await expect(mode()).rejects.toThrow("inativa");
  });
});

describe("03B2A: claims, retries e recuperação", () => {
  it("claim exclusivo, begin único e aceitação fake idempotente sem mensagem OUTBOUND", async () => {
    await queued();
    const c = await claim();
    expect(c?.attempts).toBe(1);
    expect(await claim()).toBeNull();
    await begin();
    await expect(begin()).rejects.toThrow("já iniciada");
    const j = await job(),
      receipt = randomUUID();
    for (let i = 0; i < 2; i++)
      await role(
        "service_role",
        "select public.accept_fake_whatsapp_outbound($1,$2,$3)",
        [j.id, j.claim_token, receipt],
      );
    expect(await job()).toMatchObject({
      status: "ACCEPTED",
      provider_kind: "FAKE",
      provider_message_id: "fake:" + receipt,
      attempts: 1,
    });
    expect(
      await count("whatsapp_outbound_events where action='ACCEPTED_FAKE'"),
    ).toBe(1);
    expect(await count("messages where direction='OUTBOUND'")).toBe(0);
  });
  it("não confirma aceitação sem begin ou com recibo nulo", async () => {
    await queued();
    await claim();
    const j = await job();
    await expect(
      role(
        "service_role",
        "select public.accept_fake_whatsapp_outbound($1,$2,$3)",
        [j.id, j.claim_token, randomUUID()],
      ),
    ).rejects.toThrow("confirmada");
    await begin();
    await expect(
      role(
        "service_role",
        "select public.accept_fake_whatsapp_outbound($1,$2,null)",
        [j.id, j.claim_token],
      ),
    ).rejects.toThrow("obrigatório");
  });
  it("desativar depois de claim impede begin; reativar não revive claim antigo", async () => {
    await queued();
    await claim();
    await mode("DISABLED");
    expect((await begin()).rows[0]).toEqual({
      begin_whatsapp_outbound_dispatch: null,
    });
    await mode();
    expect((await begin()).rows[0]).toEqual({
      begin_whatsapp_outbound_dispatch: null,
    });
  });
  it("desativação não apaga resultado de tentativa já iniciada", async () => {
    await queued();
    await claim();
    await begin();
    const j = await job();
    await mode("DISABLED");
    await role(
      "service_role",
      "select public.accept_fake_whatsapp_outbound($1,$2,$3)",
      [j.id, j.claim_token, randomUUID()],
    );
    expect((await job()).status).toBe("ACCEPTED");
  });
  it.each(["RATE_LIMITED", "TEMPORARY_UNAVAILABLE"] as const)(
    "%s faz backoff determinístico e termina em 5 claims",
    async (code) => {
      await queued();
      for (let i = 1; i <= 5; i++) {
        await due();
        await claim();
        await begin();
        await fail(code);
        const j = await job();
        expect(j.attempts).toBe(i);
        expect(j.status).toBe(i === 5 ? "FAILED" : "QUEUED");
        const delta = (
          await db.query<{ seconds: number }>(
            "select extract(epoch from available_at-updated_at)::float seconds from whatsapp_outbound_jobs",
          )
        ).rows[0].seconds;
        expect(delta).toBeCloseTo(Math.min(300, 30 * 2 ** (i - 1)), 0);
        expect(await claim()).toBeNull();
      }
    },
  );
  it.each([
    "PERMANENT_REJECTION",
    "NETWORK_UNCERTAIN",
    "PROVIDER_EXCEPTION",
  ] as const)("%s não é reenviado", async (code) => {
    await queued();
    await claim();
    await begin();
    await fail(code);
    expect((await job()).status).toBe(
      code === "PERMANENT_REJECTION" ? "FAILED" : "RECONCILIATION_REQUIRED",
    );
    await due();
    expect(await claim()).toBeNull();
  });
  it("recuperação antes do dispatch reencaminha com backoff e token novo", async () => {
    await queued();
    await claim();
    const old = await job();
    await recover();
    expect((await job()).status).toBe("PROCESSING");
    await expired();
    await recover();
    expect((await job()).status).toBe("QUEUED");
    expect(await claim()).toBeNull();
    await due();
    await claim();
    expect((await job()).claim_token).not.toBe(old.claim_token);
    await expect(begin(old)).rejects.toThrow("inválido");
    await begin();
    await expect(fail("PERMANENT_REJECTION", old)).rejects.toThrow("inválida");
  });
  it("crash após begin exige reconciliação, recuperação repetida é idempotente", async () => {
    await queued();
    await claim();
    await begin();
    await expired();
    await recover();
    const before = await snapshot();
    await recover();
    expect(await snapshot()).toEqual(before);
    expect((await job()).status).toBe("RECONCILIATION_REQUIRED");
    await due();
    expect(await claim()).toBeNull();
  });
  it("crashes antes de dispatch também respeitam limite de 5", async () => {
    await queued();
    for (let i = 0; i < 5; i++) {
      await due();
      await claim();
      await expired();
      await recover();
    }
    expect(await job()).toMatchObject({
      status: "FAILED",
      attempts: 5,
      last_error_code: "ATTEMPTS_EXHAUSTED",
    });
    expect(await claim()).toBeNull();
  });
  it("worker atrasado não confirma resultado após lease expirada", async () => {
    await queued();
    await claim();
    await begin();
    const j = await job();
    await expired();
    await expect(
      role(
        "service_role",
        "select public.accept_fake_whatsapp_outbound($1,$2,$3)",
        [j.id, j.claim_token, randomUUID()],
      ),
    ).rejects.toThrow("confirmada");
    await expect(fail("RATE_LIMITED")).rejects.toThrow("inválida");
    await recover();
    expect((await job()).status).toBe("RECONCILIATION_REQUIRED");
  });
  it("cancelamento ADMIN é auditado/idempotente; PROCESSING e incerto não são canceláveis", async () => {
    await queued();
    const j = await job();
    for (let i = 0; i < 2; i++)
      await role(
        "authenticated",
        "select public.cancel_whatsapp_outbound_job($1)",
        [j.id],
        admin,
      );
    expect((await job()).status).toBe("CANCELLED");
    expect(
      await count("whatsapp_outbound_events where action='CANCELLED'"),
    ).toBe(1);
    await ingest(event("Ana Teste"));
    await claim();
    await expect(
      role(
        "authenticated",
        "select public.cancel_whatsapp_outbound_job($1)",
        [(await job()).id],
        admin,
      ),
    ).rejects.toThrow("reconciliação");
  });
});

describe("03B2A: grants, RLS e integridade", () => {
  it("fronteira e autorização são isoladas por conta", async () => {
    await ingest();
    const own = (
      await db.query<{ sequence: number }>(
        "select max(sequence)::float sequence from whatsapp_outbound_drafts",
      )
    ).rows[0].sequence;
    const second = (
      await db.query<{ id: string }>(
        "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Segunda fixture','10002','20002','15550000002',true) returning id",
      )
    ).rows[0].id;
    try {
      await ingest(event("Oi", { waba_id: "10002", phone_number_id: "20002" }));
      expect((await mode()).activation_draft_sequence).toBe(own);
      await ingest(
        event("Ana Teste", { waba_id: "10002", phone_number_id: "20002" }),
      );
      expect(await count("whatsapp_outbound_jobs")).toBe(0);
      await ingest(event("Ana Teste"));
      expect((await job()).whatsapp_account_id).toBe(account);
      expect(
        (
          await role<{ result: unknown }>(
            "service_role",
            "select public.claim_whatsapp_outbound_job($1) result",
            [second],
          )
        ).rows[0].result,
      ).toBeNull();
    } finally {
      await db.exec(
        "truncate contacts,conversations,messages,webhook_events,leads,lead_events cascade",
      );
      await db.query("delete from whatsapp_accounts where id=$1", [second]);
    }
  });
  it("payload inbound não escolhe job, estado ou evidência de provider", async () => {
    await mode();
    for (const key of [
      "job_id",
      "draft_id",
      "provider_message_id",
      "activation_generation",
      "status",
      "mode",
    ])
      await expect(ingest({ ...event(), [key]: "forjado" })).rejects.toThrow(
        "inválida",
      );
    expect(await count("whatsapp_outbound_jobs")).toBe(0);
  });

  it.each(["anon", "authenticated", "service_role"])(
    "%s não escreve tabelas operacionais diretamente",
    async (r) => {
      for (const t of [
        "whatsapp_outbound_transport_config",
        "whatsapp_outbound_jobs",
        "whatsapp_outbound_events",
      ])
        for (const sql of [
          "delete from " + t,
          "update " + t + " set whatsapp_account_id=whatsapp_account_id",
          "insert into " + t + " default values",
        ])
          await expect(role(r, sql, [], admin)).rejects.toThrow(
            "permission denied",
          );
    },
  );
  it("AGENT não ativa/cancela, ADMIN inativo também não; ator vem de auth.uid", async () => {
    await expect(mode("LIVE", agent)).rejects.toThrow("administrativo");
    await queued();
    await expect(
      role(
        "authenticated",
        "select public.cancel_whatsapp_outbound_job($1)",
        [(await job()).id],
        agent,
      ),
    ).rejects.toThrow("administrativo");
    expect(
      (
        await db.query(
          "select actor_id from whatsapp_outbound_events where action='ACTIVATED'",
        )
      ).rows,
    ).toEqual([{ actor_id: admin }]);
    await db.query("update employees set active=false where profile_id=$1", [
      admin,
    ]);
    await expect(mode("DISABLED")).rejects.toThrow("administrativo");
  });
  it("ADMIN lê diagnóstico; AGENT não lê mesmo responsável; inativo perde leitura", async () => {
    await queued();
    const product = (
      await db.query<{ id: string }>("select id from products limit 1")
    ).rows[0].id;
    const cid = (await job()).conversation_id;
    const lead = (
      await role<{ id: string }>(
        "authenticated",
        "select public.convert_conversation_to_lead($1,'Teste','15550000001','','','',$2,'') id",
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
    await role(
      "authenticated",
      "select public.assign_lead($1,$2,null)",
      [lead, employee],
      admin,
    );
    for (const t of [
      "whatsapp_outbound_transport_config",
      "whatsapp_outbound_jobs",
      "whatsapp_outbound_events",
    ]) {
      expect(
        (await role("authenticated", "select * from " + t, [], admin)).rows
          .length,
      ).toBeGreaterThan(0);
      expect(
        (await role("authenticated", "select * from " + t, [], agent)).rows,
      ).toHaveLength(0);
    }
    expect(
      (await role("authenticated", "select * from conversations", [], agent))
        .rows,
    ).toHaveLength(1);
    await db.query("update employees set active=false where profile_id=$1", [
      admin,
    ]);
    expect(
      (
        await role(
          "authenticated",
          "select * from whatsapp_outbound_jobs",
          [],
          admin,
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("grants efetivos e search_path de TODAS as funções 012", async () => {
    const names = [
      "set_whatsapp_outbound_transport",
      "cancel_whatsapp_outbound_job",
      "claim_whatsapp_outbound_job",
      "begin_whatsapp_outbound_dispatch",
      "accept_fake_whatsapp_outbound",
      "fail_whatsapp_outbound_job",
      "recover_whatsapp_outbound_job",
      "enqueue_new_whatsapp_draft",
    ];
    const rows = (
      await db.query<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[];
        anon: boolean;
        user: boolean;
        service: boolean;
      }>(
        "select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'EXECUTE') anon,has_function_privilege('authenticated',oid,'EXECUTE') user,has_function_privilege('service_role',oid,'EXECUTE') service from pg_proc where proname=any($1)",
        [names],
      )
    ).rows;
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(r.prosecdef).toBe(true);
      expect(r.proconfig).toContain('search_path=""');
      expect(r.anon).toBe(false);
      expect(r.user).toBe(names.slice(0, 2).includes(r.proname));
      expect(r.service).toBe(names.slice(2, 7).includes(r.proname));
    }
  });
  it.each(["anon", "authenticated"])(
    "%s não executa RPCs técnicas nem chama trigger diretamente",
    async (r) => {
      await queued();
      const j = await job();
      for (const [sql, args] of [
        ["select public.claim_whatsapp_outbound_job($1)", [account]],
        [
          "select public.begin_whatsapp_outbound_dispatch($1,$2)",
          [j.id, randomUUID()],
        ],
        [
          "select public.accept_fake_whatsapp_outbound($1,$2,$3)",
          [j.id, randomUUID(), randomUUID()],
        ],
        [
          "select public.fail_whatsapp_outbound_job($1,$2,'RATE_LIMITED')",
          [j.id, randomUUID()],
        ],
        ["select public.recover_whatsapp_outbound_job($1)", [j.id]],
      ] as [string, string[]][])
        await expect(role(r, sql, args, admin)).rejects.toThrow(
          "permission denied",
        );
    },
  );
  it("constraints rejeitam ACCEPTED sem recibo e ativação sem fronteira", async () => {
    await queued();
    await expect(
      db.exec("update whatsapp_outbound_jobs set status='ACCEPTED'"),
    ).rejects.toThrow("check constraint");
    await expect(
      db.exec(
        "update whatsapp_outbound_transport_config set activation_draft_sequence=null",
      ),
    ).rejects.toThrow("check constraint");
  });
});
