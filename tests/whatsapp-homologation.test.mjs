import {
  linkFixtureToLead,
  revertFixtureLeadLink,
} from "../scripts/lib/whatsapp-homologation-link.mjs";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
vi.mock("server-only", () => ({}));
import { parseWebhook } from "../src/lib/whatsapp/parsing";
import {
  accountFixture as account,
  inboundFixture as event,
} from "../scripts/lib/whatsapp-homologation-fixture.mjs";
import {
  prepareFixtureAccount,
  readFixtureSummary,
  cleanupFixture,
} from "../scripts/lib/whatsapp-homologation-db.mjs";
import {
  readConfiguration,
  runControlled,
  ingestFixture,
} from "../scripts/lib/whatsapp-homologation-runtime.mjs";
const env = {
  SUPABASE_DATABASE_CA_PATH: "./certs/test-ca.crt",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_LOCAL_TEST_FIXTURE_ONLY",
  WHATSAPP_HOMOLOGATION_DATABASE_URL:
    "postgresql://postgres:fictional@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
};
afterEach(() => vi.unstubAllGlobals());
describe("homologação: fronteira de segurança", () => {
  it.each([
    { NEXT_PUBLIC_SUPABASE_URL: "" },
    { SUPABASE_SECRET_KEY: "" },
    { SUPABASE_DATABASE_CA_PATH: "" },
    { SUPABASE_DATABASE_CA_PATH: "   " },
    { WHATSAPP_HOMOLOGATION_DATABASE_URL: "" },
    {
      NEXT_PUBLIC_SUPABASE_URL:
        "https://user:password@abcdefghijklmnopqrst.supabase.co",
    },
    {
      WHATSAPP_HOMOLOGATION_DATABASE_URL:
        "postgresql://postgres:fictional@db.otherproject.supabase.co:5432/postgres",
    },
    {
      WHATSAPP_HOMOLOGATION_DATABASE_URL:
        "postgresql://postgres.abcdefghijklmnopqrst:fictional@aws-0-test.pooler.supabase.com:6543/postgres",
    },
    {
      WHATSAPP_HOMOLOGATION_DATABASE_URL:
        env.WHATSAPP_HOMOLOGATION_DATABASE_URL + "?sslmode=disable",
    },
  ])("recusa configuração insegura ou incompleta sem conexão", (change) => {
    expect(() => readConfiguration({ ...env, ...change })).toThrow();
  });
  it("aceita conexão direta/sessão do mesmo projeto mantendo TLS verificado", () => {
    expect(readConfiguration(env).pg.ssl).toEqual({ rejectUnauthorized: true });
    const config = readConfiguration({
      ...env,
      WHATSAPP_HOMOLOGATION_DATABASE_URL:
        "postgresql://postgres.abcdefghijklmnopqrst:fictional@aws-0-test.pooler.supabase.com:5432/postgres",
    });
    expect(config.caPath).toBe(env.SUPABASE_DATABASE_CA_PATH);
    expect(config.pg.user).toBe("postgres.abcdefghijklmnopqrst");
    expect(config.pg.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.pg).not.toHaveProperty("connectionString");
  });
  it.each(["ingest", "cleanup"])(
    "%s sem frase exata não conecta nem grava",
    async (mode) => {
      const connect = vi.fn(),
        operation = vi.fn();
      const io = { isTTY: true, log: vi.fn(), ask: vi.fn(async () => "sim") };
      await expect(
        runControlled(mode, readConfiguration(env), io, connect, operation),
      ).rejects.toThrow("Confirmação");
      expect(connect).not.toHaveBeenCalled();
      expect(operation).not.toHaveBeenCalled();
      expect(JSON.stringify(io.log.mock.calls)).not.toContain(
        env.SUPABASE_SECRET_KEY,
      );
      expect(JSON.stringify(io.log.mock.calls)).not.toContain("fictional");
    },
  );
  it("não permite confirmação por pipe", async () => {
    const connect = vi.fn(),
      operation = vi.fn();
    await expect(
      runControlled(
        "cleanup",
        readConfiguration(env),
        { isTTY: false, log: vi.fn(), ask: vi.fn() },
        connect,
        operation,
      ),
    ).rejects.toThrow("interativo");
    expect(connect).not.toHaveBeenCalled();
  });
  it("libera lock e conexão mesmo se a operação falhar", async () => {
    const db = {
      query: vi.fn(async () => ({ rows: [{ acquired: true }] })),
      end: vi.fn(),
    };
    await expect(
      runControlled(
        "ingest",
        readConfiguration(env),
        {
          isTTY: true,
          log: vi.fn(),
          ask: async () => "HOMOLOGAR abcdefghijklmnopqrst",
        },
        async () => db,
        async () => {
          throw new Error("fixture failure");
        },
      ),
    ).rejects.toThrow("fixture failure");
    expect(db.query).toHaveBeenLastCalledWith(
      "select pg_catalog.pg_advisory_unlock($1,$2)",
      [20261027, 202],
    );
    expect(db.end).toHaveBeenCalledOnce();
  });
  it("lock já ocupado impede a operação", async () => {
    const db = {
      query: vi.fn(async () => ({ rows: [{ acquired: false }] })),
      end: vi.fn(),
    };
    const operation = vi.fn();
    await expect(
      runControlled(
        "cleanup",
        readConfiguration(env),
        {
          isTTY: true,
          log: vi.fn(),
          ask: async () => "LIMPAR abcdefghijklmnopqrst",
        },
        async () => db,
        operation,
      ),
    ).rejects.toThrow("execução");
    expect(operation).not.toHaveBeenCalled();
    expect(db.end).toHaveBeenCalledOnce();
  });
  it("payload fictício corresponde exatamente ao contrato do parser", () => {
    expect(
      parseWebhook({
        object: "whatsapp_business_account",
        entry: [
          {
            id: account.waba_id,
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  metadata: { phone_number_id: account.phone_number_id },
                  contacts: [
                    {
                      wa_id: event.wa_id,
                      profile: { name: event.display_name },
                    },
                  ],
                  messages: [
                    {
                      from: event.wa_id,
                      id: event.external_message_id,
                      timestamp: event.provider_timestamp,
                      type: "text",
                      text: { body: event.text_body },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toEqual([event]);
  });
  it("secret só vai à RPC; não chama webhook nem insere contatos por HTTP", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ inserted: 1, duplicates: 0, statuses: 0 }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", request);
    expect(await ingestFixture(readConfiguration(env))).toEqual({
      inserted: 1,
      duplicates: 0,
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe(
      env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/rpc/ingest_whatsapp_events",
    );
    expect(JSON.parse(String(options.body))).toEqual({ p_events: [event] });
    expect(options.redirect).toBe("error");
  });
  it("erro remoto contendo credencial nunca é devolvido como diagnóstico", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: env.SUPABASE_SECRET_KEY }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(ingestFixture(readConfiguration(env))).rejects.toThrow(
      "RPC não confirmada",
    );
  });
});

let db;
async function ingest(events = [event]) {
  await db.exec("set role service_role");
  try {
    return (
      await db.query("select public.ingest_whatsapp_events($1::jsonb) result", [
        JSON.stringify(events),
      ])
    ).rows[0].result;
  } finally {
    await db.exec("reset role");
  }
}
async function snapshot() {
  const result = [];
  for (const table of [
    "whatsapp_accounts",
    "contacts",
    "conversations",
    "messages",
    "webhook_events",
  ])
    result.push(
      (await db.query("select * from public." + table + " order by id")).rows,
    );
  return result;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
  );
  for (const file of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  await db.exec(
    "insert into auth.users values('00000000-0000-4000-8000-00000000002a')",
  );
  const product = (await db.query("select id from products limit 1")).rows[0]
    .id;
  await db.query("select public.provision_employee($1,$2,$3,$4,$5,$6)", [
    "00000000-0000-4000-8000-00000000002a",
    "Admin fixture",
    "fixture@example.invalid",
    "",
    [product],
    "ADMIN",
  ]);
});
beforeEach(async () => {
  await db.exec(
    "truncate messages,conversations,contacts,webhook_events,whatsapp_accounts cascade",
  );
});
afterAll(async () => {
  await db.close();
});
describe("homologação: fixtures e cleanup restrito", () => {
  it("duas execuções usam só a RPC, geram uma mensagem e cleanup preserva outra conta", async () => {
    expect(await prepareFixtureAccount(db)).toBe(true);
    expect((await ingest()).inserted).toBe(1);
    expect(await prepareFixtureAccount(db)).toBe(false);
    expect((await ingest()).duplicates).toBe(1);
    const summary = await readFixtureSummary(db);
    expect(summary.messages).toBe(1);
    expect(summary.conversation.lead_id).toBeNull();
    await db.exec(
      "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Outra fixture independente','123','456','FICTICIO',true)",
    );
    await ingest([
      {
        ...event,
        waba_id: "123",
        phone_number_id: "456",
        external_message_id: "unrelated-fixture",
      },
    ]);
    const before = await snapshot();
    expect(await cleanupFixture(db)).toEqual({ removed: true, messages: 1 });
    const after = await snapshot();
    for (let i = 0; i < after.length; i++) {
      expect(after[i]).toHaveLength(1);
      expect(before[i]).toContainEqual(after[i][0]);
    }
    expect(await cleanupFixture(db)).toEqual({ removed: false, messages: 0 });
    expect(await snapshot()).toEqual(after);
  });
  it("permite remover somente a conta preparada quando a ingestão não ocorreu", async () => {
    await prepareFixtureAccount(db);
    expect(await cleanupFixture(db)).toEqual({ removed: true, messages: 0 });
    expect((await snapshot()).every((rows) => rows.length === 0)).toBe(true);
  });
  it("colisão de identificadores da conta não é adotada nem sobrescrita", async () => {
    await prepareFixtureAccount(db);
    await db.query(
      "update whatsapp_accounts set name='NAO E FIXTURE' where id=$1",
      [account.id],
    );
    const before = await snapshot();
    await expect(prepareFixtureAccount(db)).rejects.toThrow("divergente");
    await expect(cleanupFixture(db)).rejects.toThrow("divergente");
    expect(await snapshot()).toEqual(before);
  });
  it.each([
    "extra-contact",
    "extra-message",
    "extra-event",
    "changed-body",
    "changed-name",
    "lead-linked",
  ])("cleanup recusa %s e não remove nenhum registro", async (variation) => {
    await prepareFixtureAccount(db);
    await ingest();
    if (variation === "extra-contact")
      await ingest([
        {
          ...event,
          external_message_id: "other-message",
          wa_id: "other-contact",
        },
      ]);
    if (variation === "extra-message")
      await ingest([{ ...event, external_message_id: "other-message" }]);
    if (variation === "extra-event")
      await db.query(
        "insert into webhook_events(provider,event_key,payload) values('WHATSAPP',$1,'{}')",
        ["status:" + account.id + ":unrelated"],
      );
    if (variation === "changed-body")
      await db.exec(
        "update messages set text_body='Não é o conteúdo fictício esperado'",
      );
    if (variation === "changed-name")
      await db.exec("update contacts set display_name='Outro nome'");
    if (variation === "lead-linked") {
      // Fixture only: migration tables require a valid lead/product; no production linkage is exposed.
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        "00000000-0000-4000-8000-00000000002a",
      ]);
      const product = (await db.query("select id from products limit 1"))
        .rows[0].id;
      const lead = await db.query(
        "select public.create_lead('Fixture lead','00000000000','','','',$1,'') as id",
        [product],
      );
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await db.query("update conversations set lead_id=$1", [lead.rows[0].id]);
    }
    const before = await snapshot();
    await expect(cleanupFixture(db)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it("falha durante cleanup reverte exclusões anteriores", async () => {
    await prepareFixtureAccount(db);
    await ingest();
    const before = await snapshot();
    await db.exec(
      "create function app_private.cleanup_test_fail() returns trigger language plpgsql as $$ begin raise exception 'forced cleanup failure'; end $$;create trigger cleanup_test_fail before delete on contacts for each row execute function app_private.cleanup_test_fail();",
    );
    try {
      await expect(cleanupFixture(db)).rejects.toThrow(
        "forced cleanup failure",
      );
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.exec(
        "drop trigger cleanup_test_fail on contacts;drop function app_private.cleanup_test_fail();",
      );
    }
  });
});

let brunaId, consorcioId;
beforeAll(async () => {
  consorcioId = (
    await db.query("select id from public.products where name='Consórcio'")
  ).rows[0].id;
  await db.query("insert into auth.users(id) values($1)", [
    "00000000-0000-4000-8000-00000000002b",
  ]);
  await db.query("select public.provision_employee($1,$2,$3,$4,$5,$6)", [
    "00000000-0000-4000-8000-00000000002b",
    "Bruna Fixture",
    "bruna.fixture@example.invalid",
    "",
    [consorcioId],
    "AGENT",
  ]);
  brunaId = (
    await db.query("select id from public.employees where profile_id=$1", [
      "00000000-0000-4000-8000-00000000002b",
    ])
  ).rows[0].id;
});
async function prepareLinkTarget() {
  await prepareFixtureAccount(db);
  await ingest();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    "00000000-0000-4000-8000-00000000002a",
  ]);
  const leadId = (
    await db.query(
      "select public.create_lead('Lead fixture vínculo','00000000000','','','',$1,'') as id",
      [consorcioId],
    )
  ).rows[0].id;
  await db.query("select public.assign_lead($1,$2,null)", [leadId, brunaId]);
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  const conversation = (
    await db.query(
      "select id,contact_id,updated_at::text as revision from public.conversations where whatsapp_account_id=$1",
      [account.id],
    )
  ).rows[0];
  return {
    projectRef: "localtest",
    conversationId: conversation.id,
    contactId: conversation.contact_id,
    leadId,
    employeeId: brunaId,
    productId: consorcioId,
    previousRevision: conversation.revision,
  };
}
describe("vínculo administrativo específico e reversão", () => {
  it("vincula e reverte somente a conversa, sem alterar lead, atribuição ou histórico", async () => {
    const target = await prepareLinkTarget();
    const beforeLead = (
      await db.query("select * from public.leads where id=$1", [target.leadId])
    ).rows;
    const beforeEvents = (
      await db.query(
        "select * from public.lead_events where lead_id=$1 order by id",
        [target.leadId],
      )
    ).rows;
    const save = vi.fn(async () => {});
    const receipt = await linkFixtureToLead(db, target, save);
    expect(save).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(receipt.previousLeadId).toBeNull();
    expect(
      (
        await db.query("select lead_id from public.conversations where id=$1", [
          target.conversationId,
        ])
      ).rows[0].lead_id,
    ).toBe(target.leadId);
    await expect(cleanupFixture(db)).rejects.toThrow();
    expect(await revertFixtureLeadLink(db, receipt, "localtest")).toMatchObject(
      { reverted: true, currentLeadId: null },
    );
    expect(
      (
        await db.query("select * from public.leads where id=$1", [
          target.leadId,
        ])
      ).rows,
    ).toEqual(beforeLead);
    expect(
      (
        await db.query(
          "select * from public.lead_events where lead_id=$1 order by id",
          [target.leadId],
        )
      ).rows,
    ).toEqual(beforeEvents);
    expect(await cleanupFixture(db)).toEqual({ removed: true, messages: 1 });
  });
  it.each(["employee", "conversation", "revision"])(
    "recusa alvo divergente: %s",
    async (variation) => {
      const target = await prepareLinkTarget();
      const before = await snapshot();
      if (variation === "employee")
        target.employeeId = "00000000-0000-4000-8000-00000000002a";
      if (variation === "conversation")
        target.conversationId = "00000000-0000-4000-8000-00000000002a";
      if (variation === "revision")
        target.previousRevision = "2020-01-01 00:00:00+00";
      const save = vi.fn();
      await expect(linkFixtureToLead(db, target, save)).rejects.toThrow();
      expect(save).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    },
  );
  it("falha ao salvar recibo reverte o vínculo atomicamente", async () => {
    const target = await prepareLinkTarget();
    const before = await snapshot();
    await expect(
      linkFixtureToLead(db, target, async () => {
        throw new Error("disk failure");
      }),
    ).rejects.toThrow("disk failure");
    expect(await snapshot()).toEqual(before);
  });
  it("não sobrescreve um vínculo já existente", async () => {
    const target = await prepareLinkTarget();
    await linkFixtureToLead(db, target, async () => {});
    const before = await snapshot();
    await expect(
      linkFixtureToLead(db, target, async () => {}),
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
  it("reversão recusa recibo de outro projeto sem alterar dados", async () => {
    const target = await prepareLinkTarget();
    const receipt = await linkFixtureToLead(db, target, async () => {});
    const before = await snapshot();
    await expect(
      revertFixtureLeadLink(db, receipt, "anotherproject"),
    ).rejects.toThrow("outro projeto");
    expect(await snapshot()).toEqual(before);
  });
  it("reversão não desfaz mudanças posteriores mesmo mantendo o mesmo lead", async () => {
    const target = await prepareLinkTarget();
    const receipt = await linkFixtureToLead(db, target, async () => {});
    await db.query(
      "update public.conversations set status=status where id=$1",
      [target.conversationId],
    );
    const before = await snapshot();
    await expect(
      revertFixtureLeadLink(db, receipt, "localtest"),
    ).rejects.toThrow("alterada desde");
    expect(await snapshot()).toEqual(before);
  });
});
