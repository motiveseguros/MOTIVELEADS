// LOCAL PostgreSQL only; no env file, remote service, provider or message dispatch.
import assert from "node:assert/strict";
import { createHarness } from "./support/outbound-postgres.mjs";
let h;
const results = [];
try {
  h = await createHarness();
  const {
    db,
    a,
    b,
    mode,
    ingest,
    event,
    claim,
    begin,
    accept,
    reset,
    waitLock,
    counts,
    role,
    admin,
  } = h;
  const pidB = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
  async function pending(work) {
    const observed = work.then(
      (value) => ({ value }),
      (error) => ({ code: error.code }),
    );
    await waitLock(pidB);
    return { observed };
  }
  async function state() {
    return (
      await db.query(
        "select id,conversation_id,status,claim_token,dispatch_started_at,cancellation_reason from whatsapp_outbound_jobs order by draft_sequence",
      )
    ).rows;
  }
  async function setup() {
    await reset();
    await mode(db);
    await ingest(db, [event()]);
    return claim(db);
  }
  async function record(name, extra = {}) {
    assert.equal((await counts()).outbound, 0);
    results.push({ case: name, ...extra, ...(await counts()) });
  }
  async function convert(conn, cid) {
    const p = (await db.query("select id from products limit 1")).rows[0].id;
    return role(
      conn,
      "authenticated",
      "select public.convert_conversation_to_lead($1,'Teste','15550000001','','','',$2,'')",
      [cid, p],
      admin,
    );
  }
  for (const first of ["inbound", "begin"]) {
    const j = await setup();
    await a.query("begin");
    if (first === "inbound") await ingest(a, [event("Ana Teste")]);
    else assert.ok(await begin(a, j));
    await b.query("begin");
    const op = await pending(
      first === "inbound" ? begin(b, j) : ingest(b, [event("Ana Teste")]),
    );
    await a.query("commit");
    const result = await op.observed;
    await b.query(result.code ? "rollback" : "commit");
    const jobs = await state();
    if (first === "inbound") {
      assert.equal(result.code, "40001");
      assert.equal(jobs[0].cancellation_reason, "PROMPT_SUPERSEDED");
      assert.equal((await claim(db)).id, jobs[1].id);
    } else {
      assert.equal(result.code, undefined);
      assert.equal(jobs[0].status, "PROCESSING");
      assert.ok(jobs[0].dispatch_started_at);
      assert.equal(await claim(db), null);
      await accept(db, j);
      assert.equal((await claim(db)).id, jobs[1].id);
    }
    await record(first + "-wins-begin-inbound", { lockObserved: true });
  }
  for (const change of ["conversion", "close"]) {
    for (const first of ["change", "begin"]) {
      const j = await setup();
      const cid = (await state())[0].conversation_id;
      const mutate = (conn) =>
        change === "conversion"
          ? convert(conn, cid)
          : conn.query(
              "update public.conversations set status='CLOSED' where id=$1",
              [cid],
            );
      await a.query("begin");
      if (first === "change") await mutate(a);
      else assert.ok(await begin(a, j));
      await b.query("begin");
      const op = await pending(first === "change" ? begin(b, j) : mutate(b));
      await a.query("commit");
      const result = await op.observed;
      await b.query(result.code ? "rollback" : "commit");
      const jobs = await state();
      if (first === "change") {
        assert.equal(result.code, "40001");
        assert.equal(jobs[0].status, "CANCELLED");
        assert.equal(jobs[0].dispatch_started_at, null);
      } else {
        assert.equal(result.code, undefined);
        assert.equal(jobs[0].status, "PROCESSING");
        assert.ok(jobs[0].dispatch_started_at);
        await accept(db, j);
      }
      assert.equal(await claim(db), null);
      await record(first + "-wins-" + change + "-begin", {
        lockObserved: true,
      });
    }
  }
  for (const first of ["draft", "claim"]) {
    await reset();
    await mode(db);
    await ingest(db, [event()]);
    await a.query("begin");
    const old = first === "claim" ? await claim(a) : null;
    if (first === "draft") await ingest(a, [event("Ana Teste")]);
    await b.query("begin");
    const op = await pending(
      first === "draft" ? claim(b) : ingest(b, [event("Ana Teste")]),
    );
    await a.query("commit");
    const result = await op.observed;
    assert.equal(result.code, undefined);
    await b.query("commit");
    const jobs = await state();
    assert.equal(jobs[0].status, "CANCELLED");
    if (first === "draft") assert.equal(result.value.id, jobs[1].id);
    else {
      await assert.rejects(begin(db, old), (e) => e.code === "40001");
      assert.equal((await claim(db)).id, jobs[1].id);
    }
    await record(first + "-wins-draft-claim", { lockObserved: true });
  }
  // Two different jobs of one conversation: successor cannot overtake committed or uncommitted begin.
  {
    const old = await setup();
    await begin(db, old);
    await ingest(db, [event("Ana Teste")]);
    assert.equal(await claim(a), null);
    assert.equal(await claim(b), null);
    await a.query("begin");
    await accept(a, old);
    assert.equal(await claim(b), null); // uncommitted acceptance remains a blocker, no wait or claim
    await a.query("commit");
    await a.query("begin");
    const next = await claim(a);
    assert.ok(next);
    assert.equal(await claim(b), null); // skips the conversation held by a
    await a.query("commit");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from whatsapp_outbound_jobs where status='PROCESSING'",
        )
      ).rows[0].n,
      1,
    );
    await record("same-conversation-predecessor-and-one-processing", {
      skippedWhileOtherTransactionOpen: true,
    });
  }
  {
    await reset();
    await mode(db);
    await ingest(db, [event("Oi", "15550000001"), event("Oi", "15550000002")]);
    await a.query("begin");
    await b.query("begin");
    const ja = await claim(a),
      jb = await claim(b);
    assert.ok(ja && jb);
    assert.notEqual(ja.id, jb.id);
    assert.ok(await begin(a, ja));
    assert.ok(await begin(b, jb)); // both progress BEFORE either commit
    await a.query("commit");
    await b.query("commit");
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from whatsapp_outbound_jobs where status='PROCESSING'",
        )
      ).rows[0].n,
      2,
    );
    await record("different-conversations-parallel", {
      bothBeforeCommit: true,
    });
  }
  console.log(
    JSON.stringify(
      {
        postgres: (await db.query("show server_version")).rows[0]
          .server_version,
        mode: "native-validity-concurrency",
        results,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(
    JSON.stringify({
      error: "Verificação LOCAL de validade falhou",
      code: e.code ?? null,
      caseCount: results.length,
      detail: e instanceof assert.AssertionError ? e.message : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  if (h) await h.close();
}
