// Independent TCP sessions, LOCAL empty PostgreSQL only; synthetic provider IDs, ZERO HTTP.
import assert from "node:assert/strict";
import { createHarness } from "./support/outbound-postgres.mjs";
let h;
const results = [];
try {
  h = await createHarness();
  const { db, a, b, reset, mode, ingest, event, claim, begin, role, waitLock } =
    h;
  const pidB = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
  async function accepted(conn, j, id = "wamid.NATIVE_FIXTURE") {
    return (
      await role(
        conn,
        "service_role",
        "select public.accept_meta_whatsapp_outbound($1,$2,$3) id",
        [j.id, j.claim_token, id],
      )
    ).rows[0].id;
  }
  async function failed(conn, j) {
    return role(
      conn,
      "service_role",
      "select public.fail_meta_whatsapp_outbound_job($1,$2,'NETWORK_UNCERTAIN')",
      [j.id, j.claim_token],
    );
  }
  async function callback(conn, id, s = "READ") {
    return ingest(conn, [
      {
        kind: "status",
        waba_id: "10001",
        phone_number_id: "20001",
        external_message_id: id,
        provider_timestamp: "1800000000",
        wa_id: "15550000001",
        status: s,
      },
    ]);
  }
  async function setup() {
    await reset();
    await mode(db);
    await ingest(db, [event()]);
    const j = await claim(db);
    assert.ok(j);
    return j;
  }
  async function count() {
    return (
      await db.query(
        "select count(*)::int n from messages where direction='OUTBOUND'",
      )
    ).rows[0].n;
  }
  async function pending(p) {
    const observed = p.then(
      (value) => ({ value }),
      (e) => ({ code: e.code }),
    );
    await waitLock(pidB);
    return { observed };
  }
  function record(name) {
    results.push({ case: name, passed: true, externalCalls: 0 });
  }
  {
    await reset();
    await mode(db);
    await ingest(db, [event()]);
    await a.query("begin");
    const j = await claim(a);
    assert.ok(j);
    assert.equal(await claim(b), null);
    assert.ok(await begin(a, j));
    await b.query("begin");
    const op = await pending(begin(b, j));
    await a.query("commit");
    assert.equal((await op.observed).code, "40001");
    await b.query("rollback");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from whatsapp_outbound_events where action='DISPATCH_STARTED'",
        )
      ).rows[0].n,
      1,
    );
    record("same-job-one-logical-authorization");
  }
  {
    await reset();
    await mode(db);
    await ingest(db, [event("Oi", "15550000001"), event("Oi", "15550000002")]);
    await a.query("begin");
    await b.query("begin");
    const ja = await claim(a),
      jb = await claim(b);
    assert.notEqual(ja.id, jb.id);
    await begin(a, ja);
    await begin(b, jb);
    await accepted(a, ja, "wamid.PARALLEL_A");
    await accepted(b, jb, "wamid.PARALLEL_B");
    await a.query("commit");
    await b.query("commit");
    assert.equal(await count(), 2);
    record("different-conversations-accept-before-either-commit");
  }
  {
    const j = await setup();
    await a.query("begin");
    await ingest(a, [event("Ana Teste")]);
    await b.query("begin");
    const op = await pending(begin(b, j));
    await a.query("commit");
    assert.equal((await op.observed).code, "40001");
    await b.query("rollback");
    assert.equal(await count(), 0);
    record("inbound-supersede-fences-begin");
  }
  {
    const j = await setup();
    await begin(db, j);
    await a.query("begin");
    const mid = await accepted(a, j);
    await b.query("begin");
    const op = await pending(accepted(b, j));
    await a.query("commit");
    assert.equal((await op.observed).value, mid);
    await b.query("commit");
    assert.equal(await count(), 1);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from whatsapp_outbound_events where action='ACCEPTED_META'",
        )
      ).rows[0].n,
      1,
    );
    record("duplicate-concurrent-accept-one-message-event");
  }
  for (const first of ["accept", "callback"]) {
    const j = await setup();
    await begin(db, j);
    await a.query("begin");
    if (first === "accept") await accepted(a, j);
    else await callback(a, "wamid.NATIVE_FIXTURE");
    await b.query("begin");
    const op = await pending(
      first === "accept" ? callback(b, "wamid.NATIVE_FIXTURE") : accepted(b, j),
    );
    await a.query("commit");
    assert.equal((await op.observed).code, undefined);
    await b.query("commit");
    assert.equal(await count(), 1);
    assert.equal(
      (await db.query("select status from messages where direction='OUTBOUND'"))
        .rows[0].status,
      "READ",
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from whatsapp_pending_statuses where resolved_message_id is null",
        )
      ).rows[0].n,
      0,
    );
    record(first + "-wins-accept-callback");
  }
  {
    const j = await setup();
    await begin(db, j);
    await a.query("begin");
    await failed(a, j);
    await b.query("begin");
    const op = await pending(callback(b, "wamid.UNCERTAIN_FIXTURE"));
    await a.query("commit");
    assert.equal((await op.observed).code, undefined);
    await b.query("commit");
    assert.equal(await count(), 0);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from whatsapp_pending_statuses where resolved_message_id is null",
        )
      ).rows[0].n,
      1,
    );
    await ingest(db, [event("Ana Teste")]);
    assert.equal(await claim(b), null);
    record("failure-callback-durable-and-reconciliation-blocks-successor");
  }
  {
    const j = await setup();
    await begin(db, j);
    await ingest(db, [event("Ana Teste")]);
    await a.query("begin");
    await accepted(a, j);
    assert.equal(await claim(b), null);
    await a.query("rollback");
    assert.equal(await count(), 0);
    assert.equal(await claim(b), null);
    record("accept-rollback-never-releases-successor");
  }
  {
    const j = await setup();
    await begin(db, j);
    await ingest(db, [event("Ana Teste")]);
    assert.equal(await claim(b), null);
    await accepted(a, j);
    const next = await claim(b);
    assert.ok(next);
    assert.notEqual(next.id, j.id);
    assert.ok(await begin(b, next));
    assert.equal(await count(), 1);
    record("accepted-predecessor-releases-only-current-successor");
  }
  {
    const j = await setup();
    await begin(db, j);
    await accepted(db, j);
    await a.query("begin");
    await callback(a, "wamid.NATIVE_FIXTURE", "READ");
    await b.query("begin");
    const op = await pending(callback(b, "wamid.NATIVE_FIXTURE", "FAILED"));
    await a.query("commit");
    assert.equal((await op.observed).code, undefined);
    await b.query("commit");
    assert.equal(
      (await db.query("select status from messages where direction='OUTBOUND'"))
        .rows[0].status,
      "READ",
    );
    assert.equal(await count(), 1);
    record("concurrent-out-of-order-status-monotonic");
  }
  console.log(
    JSON.stringify(
      {
        postgres: (await db.query("show server_version")).rows[0]
          .server_version,
        mode: "LOCAL_META_NO_HTTP",
        results,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      error: "Native LOCAL Meta verification failed",
      caseCount: results.length,
      code: e.code ?? null,
      detail: e instanceof assert.AssertionError ? e.message : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  if (h) await h.close();
}
