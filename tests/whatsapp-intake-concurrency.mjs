// Opt-in native PostgreSQL integration test. Never loads .env.local or remote credentials.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const raw = process.env.INTAKE_TEST_DATABASE_URL;
if (!raw)
  throw new Error(
    "Configure INTAKE_TEST_DATABASE_URL para um banco LOCAL vazio motive_intake_test_<sufixo>.",
  );
let url;
try {
  url = new URL(raw);
} catch {
  throw new Error("URL de teste local inválida.");
}
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !/^\/motive_intake_test_[a-z0-9]+$/.test(url.pathname) ||
  url.search ||
  url.hash ||
  Number(url.port) < 1024
) {
  throw new Error(
    "Teste recusado: somente PostgreSQL loopback, porta explícita e banco de teste vazio.",
  );
}
const clients = [];
async function client(name) {
  const db = new Client({
    connectionString: raw,
    application_name: name,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    lock_timeout: 5000,
  });
  db.on("error", () => {});
  clients.push(db);
  await db.connect();
  return db;
}
let serial = 0;
function event(text, wa = "15550000001") {
  serial++;
  return {
    kind: "inbound",
    waba_id: "10001",
    phone_number_id: "20001",
    external_message_id: "wamid.native." + serial,
    provider_timestamp: String(1800000000 + serial),
    wa_id: wa,
    type: "text",
    text_body: text,
    display_name: "Fixture local",
  };
}
async function ingest(db, events) {
  await db.query("set role service_role");
  const r = await db.query(
    "select public.ingest_whatsapp_events($1::jsonb) result",
    [JSON.stringify(events)],
  );
  await db.query("reset role");
  return r.rows[0].result;
}
async function seed(db, wa = "15550000001") {
  await ingest(
    db,
    ["Oi", "Ana Teste", "consórcio", "Vitória/ES", "teste@example.com"].map(
      (t) => event(t, wa),
    ),
  );
  return (
    await db.query(
      "select c.id from conversations c join contacts ct on ct.id=c.contact_id where ct.wa_id=$1",
      [wa],
    )
  ).rows[0].id;
}
async function counts(db) {
  return (
    await db.query(
      "select (select count(*)::int from leads) leads,(select count(*)::int from lead_events) events,(select count(*)::int from leads l where not exists(select 1 from conversations c where c.lead_id=l.id)) orphans,(select count(*)::int from whatsapp_intake_sessions where status='COMPLETE') completed",
    )
  ).rows[0];
}
async function blocked(db, pid) {
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
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Segunda conexão não apresentou espera por lock.");
}
try {
  const coordinator = await client("intake-test-coordinator"),
    a = await client("intake-test-a"),
    b = await client("intake-test-b");
  assert.equal(
    (
      await coordinator.query(
        "select count(*)::int count from pg_tables where schemaname in ('public','auth')",
      )
    ).rows[0].count,
    0,
    "Banco deve estar vazio",
  );
  for (const role of ["anon", "authenticated", "service_role"])
    if (
      !(
        await coordinator.query("select 1 from pg_roles where rolname=$1", [
          role,
        ])
      ).rowCount
    )
      await coordinator.query("create role " + role);
  await coordinator.query(
    "grant usage on schema public to anon,authenticated,service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const f of (
    await readdir(new URL("../supabase/migrations/", import.meta.url))
  ).sort())
    await coordinator.query(
      await readFile(
        new URL("../supabase/migrations/" + f, import.meta.url),
        "utf8",
      ),
    );
  await coordinator.query(
    "insert into whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values('Teste local','10001','20001','15550000000',true)",
  );
  const admin = randomUUID(),
    product = (
      await coordinator.query("select id from products where name='Consórcio'")
    ).rows[0].id;
  await coordinator.query("insert into auth.users values($1)", [admin]);
  await coordinator.query(
    "select public.provision_employee($1,'Admin local','admin@example.com','',$2,'ADMIN')",
    [admin, [product]],
  );
  const pid = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
  async function reset() {
    await coordinator.query(
      "truncate contacts,conversations,messages,webhook_events,leads,lead_events cascade",
    );
  }
  async function manual(db, cid) {
    await db.query("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    const result = await db.query(
      "select public.convert_conversation_to_lead($1,'Manual','15550000001','','','',$2,'') id",
      [cid, product],
    );
    await db.query("reset role");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    return result.rows[0].id;
  }
  const results = [];
  await ingest(coordinator, [event("Oi")]);
  await a.query("begin");
  await ingest(a, [event("Ana Teste")]);
  await b.query("begin");
  const productPending = ingest(b, [event("consórcio")]);
  productPending.catch(() => {});
  await blocked(coordinator, pid);
  await a.query("commit");
  await productPending;
  await b.query("commit");
  const advanced = (
    await coordinator.query(
      "select name,product_id,current_step from whatsapp_intake_sessions",
    )
  ).rows[0];
  assert.deepEqual(advanced, {
    name: "Ana Teste",
    product_id: product,
    current_step: "LOCATION",
  });
  results.push({
    case: "concurrent-step-advancement",
    lockObserved: true,
    step: advanced.current_step,
  });
  for (const mode of [
    "same-message",
    "different-messages",
    "winner-rollback",
  ]) {
    await reset();
    const cid = await seed(coordinator);
    const first = event("não");
    await a.query("begin");
    await ingest(a, [first]);
    const uncommitted = (
      await coordinator.query("select lead_id from conversations where id=$1", [
        cid,
      ])
    ).rows[0];
    assert.equal(
      uncommitted.lead_id,
      null,
      "Leitor não deve ver vínculo parcial",
    );
    await b.query("begin");
    const pending = ingest(b, [
      mode === "different-messages" ? event("Complemento posterior") : first,
    ]);
    // Attach a rejection handler immediately while the coordinator proves lock contention.
    pending.catch(() => {});
    await blocked(coordinator, pid);
    await a.query(mode === "winner-rollback" ? "rollback" : "commit");
    const response = await pending;
    await b.query("commit");
    const total = await counts(coordinator);
    assert.deepEqual(total, { leads: 1, events: 2, orphans: 0, completed: 1 });
    if (mode === "same-message") assert.equal(response.duplicates, 1);
    const before = JSON.stringify(total);
    await ingest(coordinator, [first]);
    assert.equal(JSON.stringify(await counts(coordinator)), before);
    results.push({
      case: mode,
      lockObserved: true,
      ...total,
      second: response,
    });
  }
  await reset();
  await seed(coordinator, "15550000001");
  await seed(coordinator, "15550000002");
  await Promise.all([
    ingest(a, [event("não", "15550000001")]),
    ingest(b, [event("nada", "15550000002")]),
  ]);
  const independent = await counts(coordinator);
  assert.deepEqual(independent, {
    leads: 2,
    events: 4,
    orphans: 0,
    completed: 2,
  });
  results.push({ case: "different-conversations", ...independent });
  for (const winner of ["auto", "manual"]) {
    await reset();
    const cid = await seed(coordinator);
    await a.query("begin");
    if (winner === "auto") await ingest(a, [event("não")]);
    else await manual(a, cid);
    await b.query("begin");
    const pending =
      winner === "auto" ? manual(b, cid) : ingest(b, [event("não")]);
    pending.catch(() => {});
    await blocked(coordinator, pid);
    await a.query("commit");
    await pending;
    await b.query("commit");
    const total = await counts(coordinator);
    assert.equal(total.leads, 1);
    assert.equal(total.events, 2);
    assert.equal(total.orphans, 0);
    assert.equal(total.completed, winner === "auto" ? 1 : 0);
    results.push({
      case: winner + "-wins-manual-race",
      lockObserved: true,
      ...total,
    });
  }
  console.log(
    JSON.stringify(
      {
        postgres: (await coordinator.query("show server_version")).rows[0]
          .server_version,
        results,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: "Teste local de concorrência falhou",
      code: typeof error.code === "string" ? error.code : null,
    }),
  );
  process.exitCode = 1;
} finally {
  for (const db of clients) {
    await db.query("rollback").catch(() => {});
    await db.end().catch(() => {});
  }
}
