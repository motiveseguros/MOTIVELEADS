import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { inboundEvent } from "./fixtures/whatsapp";
async function legacy() {
  const db = new PGlite(),
    admin = randomUUID();
  await db.exec(
    "create role anon;create role authenticated;create role service_role;grant usage on schema public to anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const f of (await readdir("supabase/migrations"))
    .sort()
    .filter((f) => f < "202611160013"))
    await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
  const account = (
    await db.query<{ id: string }>(
      "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Upgrade local','10001','20001','15550000000',true) returning id",
    )
  ).rows[0].id;
  await db.query("insert into auth.users values($1)", [admin]);
  await db.query(
    "select public.provision_employee($1,'Admin local','upgrade@example.com','',array(select id from products),'ADMIN')",
    [admin],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    admin,
  ]);
  let serial = 0;
  async function ingest(text: string) {
    serial++;
    await db.query("select public.ingest_whatsapp_events($1::jsonb)", [
      JSON.stringify([
        inboundEvent({
          text_body: text,
          external_message_id: "upgrade." + serial,
          provider_timestamp: String(1800000000 + serial),
        }),
      ]),
    ]);
  }
  async function mode(m: string) {
    return db.query("select public.set_whatsapp_outbound_transport($1,$2)", [
      account,
      m,
    ]);
  }
  async function claim() {
    return (
      await db.query<{ j: { id: string; claim_token: string } }>(
        "select public.claim_whatsapp_outbound_job($1) j",
        [account],
      )
    ).rows[0].j;
  }
  return { db, account, ingest, mode, claim };
}
it("upgrade 012→013 retém os dois jobs sem tocar tentativas, config, eventos ou drafts", async () => {
  const h = await legacy();
  const { db, mode, ingest, account } = h;
  try {
    await mode("LIVE");
    await ingest("Oi");
    await mode("DISABLED");
    await ingest("Ana Teste");
    await mode("LIVE");
    await ingest("Consórcio");
    await mode("DISABLED");
    const before = (
      await db.query<{ status: string }>(
        "select * from whatsapp_outbound_jobs order by created_at",
      )
    ).rows;
    const conf = (
      await db.query("select * from whatsapp_outbound_transport_config")
    ).rows;
    const events = (
      await db.query("select * from whatsapp_outbound_events order by id")
    ).rows;
    const drafts = (
      await db.query("select * from whatsapp_outbound_drafts order by sequence")
    ).rows;
    expect(before).toHaveLength(2);
    await db.exec(
      await readFile(
        "supabase/migrations/202611160013_whatsapp_prompt_validity.sql",
        "utf8",
      ),
    );
    const after = (
      await db.query<Record<string, unknown>>(
        "select * from whatsapp_outbound_jobs order by created_at",
      )
    ).rows;
    expect(
      after.map((j) =>
        Object.fromEntries(
          Object.entries(j).filter(
            ([k]) =>
              ![
                "draft_sequence",
                "validity_version",
                "cancellation_reason",
              ].includes(k),
          ),
        ),
      ),
    ).toEqual(before);
    expect(
      after.every(
        (j) =>
          j.validity_version === 0 &&
          j.cancellation_reason === null &&
          j.status === "QUEUED" &&
          j.attempts === 0,
      ),
    ).toBe(true);
    expect(
      (await db.query("select * from whatsapp_outbound_transport_config")).rows,
    ).toEqual(conf);
    expect(
      (await db.query("select * from whatsapp_outbound_events order by id"))
        .rows,
    ).toEqual(events);
    expect(
      (
        await db.query(
          "select * from whatsapp_outbound_drafts order by sequence",
        )
      ).rows,
    ).toEqual(drafts);
    await mode("LIVE");
    expect(
      (
        await db.query("select public.claim_whatsapp_outbound_job($1) j", [
          account,
        ])
      ).rows,
    ).toEqual([{ j: null }]);
    // Even a matching generation cannot promote a legacy job. Owner mutation only in this isolated test.
    await db.exec(
      "update whatsapp_outbound_jobs set activation_generation=(select generation from whatsapp_outbound_transport_config)",
    );
    expect(
      (
        await db.query("select public.claim_whatsapp_outbound_job($1) j", [
          account,
        ])
      ).rows,
    ).toEqual([{ j: null }]);
    expect(
      (
        await db.query(
          "select count(*)::int n from messages where direction='OUTBOUND'",
        )
      ).rows[0],
    ).toEqual({ n: 0 });
  } finally {
    await db.close();
  }
});
it("upgrade recusa estado legado com dois PROCESSING na mesma conversa sem apagar evidência", async () => {
  const h = await legacy();
  const { db, mode, ingest, claim } = h;
  try {
    await mode("LIVE");
    await ingest("Oi");
    await claim();
    await ingest("Ana Teste");
    await claim();
    const before = (
      await db.query<{ status: string }>(
        "select * from whatsapp_outbound_jobs order by created_at",
      )
    ).rows;
    expect(before).toHaveLength(2);
    expect(before.every((j) => j.status === "PROCESSING")).toBe(true);
    await expect(
      db.exec(
        await readFile(
          "supabase/migrations/202611160013_whatsapp_prompt_validity.sql",
          "utf8",
        ),
      ),
    ).rejects.toThrow("Upgrade requer reconciliação");
    expect(
      (
        await db.query(
          "select * from whatsapp_outbound_jobs order by created_at",
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await db.query(
          "select column_name from information_schema.columns where table_name='whatsapp_outbound_jobs' and column_name='validity_version'",
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    await db.close();
  }
});
