// Isolated LOCAL fixtures only. Never reads .env.local or a linked Supabase project.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
export function localOutboundUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "Configure OUTBOUND_TEST_DATABASE_URL para PostgreSQL LOCAL vazio motive_outbound_test_<sufixo>.",
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^\/motive_outbound_test_[a-z0-9]+$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    !url.port ||
    Number(url.port) < 1024
  )
    throw new Error(
      "Recusado: somente loopback, porta explícita e banco isolado de teste.",
    );
  return raw;
}
export async function createHarness() {
  const raw = localOutboundUrl(process.env.OUTBOUND_TEST_DATABASE_URL),
    clients = [];
  async function client(name) {
    const db = new Client({
      connectionString: raw,
      application_name: name,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      lock_timeout: 5000,
    });
    clients.push(db);
    db.on("error", () => {});
    await db.connect();
    return db;
  }
  async function close() {
    for (const db of clients) {
      await db.query("rollback").catch(() => {});
      await db.end().catch(() => {});
    }
  }
  try {
    const db = await client("outbox-coordinator"),
      a = await client("outbox-worker-a"),
      b = await client("outbox-worker-b");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from pg_tables where schemaname in ('public','auth')",
        )
      ).rows[0].n,
      0,
      "Banco local deve estar vazio",
    );
    for (const role of ["anon", "authenticated", "service_role"])
      if (
        !(await db.query("select 1 from pg_roles where rolname=$1", [role]))
          .rowCount
      )
        await db.query("create role " + role);
    await db.query(
      "grant usage on schema public to anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
    );
    for (const f of (
      await readdir(new URL("../../supabase/migrations/", import.meta.url))
    ).sort())
      await db.query(
        await readFile(
          new URL("../../supabase/migrations/" + f, import.meta.url),
          "utf8",
        ),
      );
    const account = (
      await db.query(
        "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Teste local outbox','10001','20001','15550000000',true) returning id",
      )
    ).rows[0].id;
    const admin = randomUUID(),
      product = (await db.query("select id from products limit 1")).rows[0].id;
    await db.query("insert into auth.users values($1)", [admin]);
    await db.query(
      "select public.provision_employee($1,'Admin local','outbox@example.com','',$2,'ADMIN')",
      [admin, [product]],
    );
    let serial = 0;
    function event(text = "Oi", wa = "15550000001") {
      serial++;
      return {
        kind: "inbound",
        waba_id: "10001",
        phone_number_id: "20001",
        external_message_id: "outbox.native." + serial,
        provider_timestamp: String(1800000000 + serial),
        wa_id: wa,
        type: "text",
        text_body: text,
        display_name: "Fixture local",
      };
    }
    async function role(conn, name, sql, args = [], user = "") {
      await conn.query("set role " + name);
      await conn.query("select set_config('request.jwt.claim.sub',$1,false)", [
        user,
      ]);
      try {
        return await conn.query(sql, args);
      } finally {
        await conn.query("reset role").catch(() => {});
        await conn
          .query("select set_config('request.jwt.claim.sub','',false)")
          .catch(() => {});
      }
    }
    async function ingest(conn, events) {
      return (
        await role(
          conn,
          "service_role",
          "select public.ingest_whatsapp_events($1::jsonb) result",
          [JSON.stringify(events)],
        )
      ).rows[0].result;
    }
    async function mode(conn, value = "LIVE") {
      return (
        await role(
          conn,
          "authenticated",
          "select * from public.set_whatsapp_outbound_transport($1,$2)",
          [account, value],
          admin,
        )
      ).rows[0];
    }
    async function claim(conn) {
      return (
        await role(
          conn,
          "service_role",
          "select public.claim_whatsapp_outbound_job($1) result",
          [account],
        )
      ).rows[0].result;
    }
    async function begin(conn, j) {
      return (
        await role(
          conn,
          "service_role",
          "select public.begin_whatsapp_outbound_dispatch($1,$2) result",
          [j.id, j.claim_token],
        )
      ).rows[0].result;
    }
    async function accept(conn, j) {
      return role(
        conn,
        "service_role",
        "select public.accept_fake_whatsapp_outbound($1,$2,$3)",
        [j.id, j.claim_token, randomUUID()],
      );
    }
    async function recover(conn, j) {
      return (
        await role(
          conn,
          "service_role",
          "select public.recover_whatsapp_outbound_job($1) result",
          [j.id],
        )
      ).rows[0].result;
    }
    async function reset() {
      await db.query(
        "truncate contacts,conversations,messages,webhook_events,leads,lead_events,whatsapp_outbound_transport_config,whatsapp_outbound_events cascade",
      );
    }
    async function counts() {
      return (
        await db.query(
          "select (select count(*)::int from whatsapp_outbound_jobs) jobs,(select count(*)::int from whatsapp_outbound_drafts) drafts,(select count(*)::int from messages where direction='INBOUND') inbound,(select count(*)::int from messages where direction='OUTBOUND') outbound,(select count(*)::int from whatsapp_outbound_events) events",
        )
      ).rows[0];
    }
    async function waitLock(pid) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (
          (
            await db.query(
              "select wait_event_type from pg_stat_activity where pid=$1",
              [pid],
            )
          ).rows[0]?.wait_event_type === "Lock"
        )
          return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("Espera por lock não observada");
    }
    return {
      client,
      db,
      a,
      b,
      account,
      admin,
      event,
      role,
      ingest,
      mode,
      claim,
      begin,
      accept,
      recover,
      reset,
      counts,
      waitLock,
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}
