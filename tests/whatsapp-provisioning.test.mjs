import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { accountFixture } from "../scripts/lib/whatsapp-homologation-fixture.mjs";
import {
  readTestConfiguration,
  provisionTestAccount,
  runTestProvision,
  provisioningError,
} from "../scripts/lib/whatsapp-test-provisioning.mjs";
const env = {
  WHATSAPP_TEST_WABA_ID: "1169885138706340",
  WHATSAPP_TEST_PHONE_NUMBER_ID: "1519898697862586",
  WHATSAPP_TEST_DISPLAY_PHONE_NUMBER: "+1 (555) 156-4835",
  WHATSAPP_HOMOLOGATION_DATABASE_URL:
    "postgresql://postgres:fixture-password@db.testproject.supabase.co:5432/postgres",
  SUPABASE_DATABASE_CA_PATH: "./certs/test-ca.crt",
};
const config = readTestConfiguration(env);
describe("provisionamento: segurança antes da conexão", () => {
  it.each([
    { WHATSAPP_TEST_WABA_ID: "" },
    { WHATSAPP_TEST_PHONE_NUMBER_ID: "" },
    { WHATSAPP_TEST_WABA_ID: "1;select" },
    { WHATSAPP_TEST_PHONE_NUMBER_ID: "1".repeat(65) },
    { WHATSAPP_TEST_WABA_ID: "999999" },
    { WHATSAPP_TEST_WABA_ID: "1281001924190390" },
    { WHATSAPP_TEST_PHONE_NUMBER_ID: "999999" },
    { WHATSAPP_TEST_WABA_ID: accountFixture.waba_id },
    { WHATSAPP_TEST_PHONE_NUMBER_ID: accountFixture.phone_number_id },
    { WHATSAPP_TEST_DISPLAY_PHONE_NUMBER: "" },
    { WHATSAPP_TEST_DISPLAY_PHONE_NUMBER: "+5511999999999" },
    { WHATSAPP_TEST_DISPLAY_PHONE_NUMBER: "+1 (555) 156-4835\nsecret" },
    { WHATSAPP_HOMOLOGATION_DATABASE_URL: "" },
    {
      WHATSAPP_HOMOLOGATION_DATABASE_URL:
        "postgresql://postgres:fixture@other.example/postgres",
    },
    {
      WHATSAPP_HOMOLOGATION_DATABASE_URL:
        env.WHATSAPP_HOMOLOGATION_DATABASE_URL + "?sslmode=disable",
    },
    {
      WHATSAPP_HOMOLOGATION_DATABASE_URL:
        env.WHATSAPP_HOMOLOGATION_DATABASE_URL + "?sslcert=other",
    },
    {
      WHATSAPP_HOMOLOGATION_DATABASE_URL:
        "postgresql://postgres.testproject:fixture@aws-0-test.pooler.supabase.com:6543/postgres",
    },
    { SUPABASE_DATABASE_CA_PATH: "" },
  ])("recusa configuração ausente, divergente ou insegura: %j", (change) => {
    expect(() => readTestConfiguration({ ...env, ...change })).toThrow();
  });
  it("usa TLS verificado e campos separados, sem exigir secret Supabase ou URL pública", () => {
    expect(config.pg.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.pg).not.toHaveProperty("connectionString");
    expect(config.projectRef).toBe("testproject");
    expect(
      readTestConfiguration({
        ...env,
        WHATSAPP_HOMOLOGATION_DATABASE_URL:
          "postgresql://postgres.testproject:fixture@aws-0-test.pooler.supabase.com:5432/postgres",
      }).projectRef,
    ).toBe("testproject");
  });
  it.each([false, true])(
    "não conecta sem confirmação exata (TTY=%s)",
    async (isTTY) => {
      const connect = vi.fn();
      const log = vi.fn();
      await expect(
        runTestProvision(
          config,
          { isTTY, log, ask: async () => "sim" },
          connect,
        ),
      ).rejects.toThrow();
      expect(connect).not.toHaveBeenCalled();
      const printed = JSON.stringify(log.mock.calls);
      expect(printed).not.toContain("fixture-password");
      expect(printed).not.toContain(env.WHATSAPP_HOMOLOGATION_DATABASE_URL);
    },
  );
  it("fecha conexão em falha e nunca revela erro bruto do driver", async () => {
    const db = {
      query: vi.fn().mockRejectedValue(new Error("password=fixture-password")),
      end: vi.fn(),
    };
    await expect(
      runTestProvision(
        config,
        {
          isTTY: true,
          log: vi.fn(),
          ask: async () => "PROVISIONAR TESTE testproject 1519898697862586",
        },
        async () => db,
      ),
    ).rejects.toThrow();
    expect(db.end).toHaveBeenCalledOnce();
    expect(
      provisioningError(new Error("password=fixture-password")),
    ).not.toContain("fixture-password");
  });
  it("valida novamente o destino antes de qualquer SQL", async () => {
    const db = { query: vi.fn() };
    await expect(
      provisionTestAccount(db, {
        ...config.account,
        phone_number_id: accountFixture.phone_number_id,
      }),
    ).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();
  });
});
let db;
const otherId = "00000000-0000-4000-8000-000000000111";
const snapshot = async () =>
  (await db.query("select * from public.whatsapp_accounts order by id")).rows;
async function insert(account, id) {
  await db.query(
    "insert into public.whatsapp_accounts(id,name,waba_id,phone_number_id,display_phone_number,active) values($1,$2,$3,$4,$5,$6)",
    [
      id,
      account.name,
      account.waba_id,
      account.phone_number_id,
      account.display_phone_number,
      account.active,
    ],
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
  );
  for (const f of (await readdir("supabase/migrations")).sort())
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("truncate public.whatsapp_accounts cascade");
  await insert(accountFixture, accountFixture.id);
  await insert(
    {
      name: "OTHER ACCOUNT",
      waba_id: "8888",
      phone_number_id: "9999",
      display_phone_number: "+0000000",
      active: false,
    },
    otherId,
  );
});
describe("provisionamento no PostgreSQL local com migrations reais", () => {
  it("cria apenas a própria conta e repetir é no-op inclusive updated_at", async () => {
    const before = await snapshot();
    expect(await provisionTestAccount(db, config.account)).toEqual(
      config.account,
    );
    const first = await snapshot();
    expect(first).toHaveLength(3);
    expect(
      first.filter((r) => r.id === accountFixture.id || r.id === otherId),
    ).toEqual(before);
    expect(await provisionTestAccount(db, config.account)).toEqual(
      config.account,
    );
    expect(await snapshot()).toEqual(first);
    for (const table of [
      "contacts",
      "conversations",
      "messages",
      "webhook_events",
    ]) {
      expect(
        (await db.query("select count(*)::int n from public." + table)).rows[0]
          .n,
      ).toBe(0);
    }
  });
  it("reativa e atualiza display da própria conta preservando demais contas", async () => {
    const before = await snapshot();
    await insert(
      {
        ...config.account,
        active: false,
        display_phone_number: "+15551564835",
      },
      "00000000-0000-4000-8000-000000000112",
    );
    expect(await provisionTestAccount(db, config.account)).toEqual(
      config.account,
    );
    expect(
      (await snapshot()).filter(
        (r) => r.id === accountFixture.id || r.id === otherId,
      ),
    ).toEqual(before);
  });
  it.each([
    { name: "UNRELATED" },
    { name: accountFixture.name },
    { waba_id: "7777" },
  ])("colisão recusa sem sobrescrever: %j", async (change) => {
    await insert(
      { ...config.account, ...change },
      "00000000-0000-4000-8000-000000000112",
    );
    const before = await snapshot();
    await expect(provisionTestAccount(db, config.account)).rejects.toThrow(
      "divergente",
    );
    expect(await snapshot()).toEqual(before);
  });
  it("UUID protegido da fixture impede alteração mesmo se demais campos forem adulterados", async () => {
    await db.query(
      "update public.whatsapp_accounts set name=$1,waba_id=$2,phone_number_id=$3 where id=$4",
      [
        config.account.name,
        config.account.waba_id,
        config.account.phone_number_id,
        accountFixture.id,
      ],
    );
    const before = await snapshot();
    await expect(provisionTestAccount(db, config.account)).rejects.toThrow(
      "protegida",
    );
    expect(await snapshot()).toEqual(before);
  });
  it("falha após INSERT reverte tudo", async () => {
    const before = await snapshot();
    let reads = 0;
    const failing = {
      query: async (sql, params) => {
        if (sql.startsWith("select id,name") && ++reads === 2)
          throw new Error("forced failure");
        return db.query(sql, params);
      },
    };
    await expect(provisionTestAccount(failing, config.account)).rejects.toThrow(
      "forced failure",
    );
    expect(await snapshot()).toEqual(before);
  });
  it("falha após UPDATE reverte tudo", async () => {
    await insert(
      { ...config.account, active: false },
      "00000000-0000-4000-8000-000000000112",
    );
    const before = await snapshot();
    let reads = 0;
    const failing = {
      query: async (sql, params) => {
        if (sql.startsWith("select id,name") && ++reads === 2)
          throw new Error("forced failure");
        return db.query(sql, params);
      },
    };
    await expect(provisionTestAccount(failing, config.account)).rejects.toThrow(
      "forced failure",
    );
    expect(await snapshot()).toEqual(before);
  });
});
