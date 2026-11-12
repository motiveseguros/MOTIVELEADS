// Opt-in, independent native PostgreSQL connections; never a remote test or provider call.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createHarness } from "./support/outbound-postgres.mjs";
let h;
const results = [];
try {
  h = await createHarness();
  const {
    db,
    a,
    b,
    event,
    ingest,
    mode,
    claim,
    begin,
    accept,
    recover,
    reset,
    counts,
    waitLock,
  } = h;
  const pidB = (await b.query("select pg_backend_pid() pid")).rows[0].pid;
  async function pendingLock(work) {
    work.catch(() => {});
    await waitLock(pidB);
    return { work };
  }
  async function queued(n = 1) {
    await mode(db);
    for (let i = 0; i < n; i++)
      await ingest(db, [
        event("Oi", "1555000" + String(i + 1).padStart(4, "0")),
      ]);
  }
  async function record(name, extra = {}) {
    results.push({ case: name, ...extra, ...(await counts()) });
  }
  if (process.argv.includes("--benchmark")) {
    const n = 40;
    async function measure(name, operation) {
      const latencies = [];
      let next = 0;
      const start = performance.now();
      await Promise.all(
        [a, b].map(async (conn) => {
          while (next < n) {
            const i = next++;
            const t = performance.now();
            await operation(conn, i);
            latencies.push(performance.now() - t);
          }
        }),
      );
      const elapsed = performance.now() - start;
      latencies.sort((x, y) => x - y);
      await record(name, {
        operations: n,
        connections: 2,
        elapsedMs: +elapsed.toFixed(1),
        operationsPerSecond: +((n * 1000) / elapsed).toFixed(1),
        p50Ms: +latencies[Math.floor(n * 0.5)].toFixed(1),
        p95Ms: +latencies[Math.floor(n * 0.95)].toFixed(1),
      });
    }
    await mode(db);
    await ingest(db, [event()]);
    await measure("one-conversation-invalid-name-turns", (conn) =>
      ingest(conn, [event("x")]),
    );
    assert.equal((await counts()).jobs, n + 1);
    await reset();
    await mode(db);
    await measure("many-conversations-same-account", (conn, i) =>
      ingest(conn, [event("Oi", "1555000" + String(i + 1).padStart(4, "0"))]),
    );
    assert.equal((await counts()).jobs, n);
    await measure("many-jobs-two-workers-fake-acceptance", async (conn) => {
      const j = await claim(conn);
      assert.ok(j);
      assert.ok(await begin(conn, j));
      await accept(conn, j);
    });
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from whatsapp_outbound_jobs where status='ACCEPTED'",
        )
      ).rows[0].n,
      n,
    );
  } else {
    for (const commit of [true, false]) {
      await reset();
      await queued();
      await a.query("begin");
      const first = await claim(a);
      assert.ok(first);
      // b returns while a still holds the job lock: SKIP LOCKED, not waiting.
      const second = await claim(b);
      assert.equal(second, null);
      await a.query(commit ? "commit" : "rollback");
      if (commit) assert.equal(await claim(b), null);
      else assert.equal((await claim(b)).attempts, 1);
      await record(
        commit ? "same-job-one-claim" : "rolled-back-claim-can-be-reclaimed",
      );
    }
    await reset();
    await queued(2);
    await a.query("begin");
    await b.query("begin");
    const ja = await claim(a),
      jb = await claim(b);
    assert.ok(ja && jb);
    assert.notEqual(ja.id, jb.id);
    await a.query("commit");
    await b.query("commit");
    await Promise.all([begin(a, ja), begin(b, jb)]);
    await Promise.all([accept(a, ja), accept(b, jb)]);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from whatsapp_outbound_jobs where status='ACCEPTED'",
        )
      ).rows[0].n,
      2,
    );
    await record("different-jobs-parallel", { distinctJobs: true });

    await reset();
    await mode(db);
    const duplicate = event();
    await a.query("begin");
    await ingest(a, [duplicate]);
    await b.query("begin");
    var pending = ingest(b, [duplicate]);
    await pendingLock(pending);
    await a.query("commit");
    assert.equal((await pending).duplicates, 1);
    await b.query("commit");
    assert.equal((await counts()).jobs, 1);
    assert.equal((await counts()).drafts, 1);
    await record("concurrent-duplicate-webhook", { lockObserved: true });
    await assert.rejects(
      db.query(
        "insert into whatsapp_outbound_drafts(session_id,in_reply_to_message_id,text_body) select session_id,in_reply_to_message_id,text_body from whatsapp_outbound_drafts",
      ),
      (e) => e.code === "23505",
    );
    assert.equal((await counts()).jobs, 1);
    await record("duplicate-draft-rejected-one-job");

    await reset();
    await ingest(db, [event()]);
    await a.query("begin");
    const activated = await mode(a);
    await b.query("begin");
    pending = mode(b);
    await pendingLock(pending);
    await a.query("commit");
    const again = await pending;
    await b.query("commit");
    assert.equal(again.generation, "1");
    assert.equal(
      again.activation_draft_sequence,
      activated.activation_draft_sequence,
    );
    assert.equal((await counts()).jobs, 0);
    assert.equal((await counts()).events, 1);
    await record("concurrent-activation-single-boundary", {
      lockObserved: true,
      generation: again.generation,
    });

    for (const first of ["draft", "activation"]) {
      await reset();
      await a.query("begin");
      if (first === "draft") await ingest(a, [event()]);
      else await mode(a);
      await b.query("begin");
      pending = first === "draft" ? mode(b) : ingest(b, [event()]);
      await pendingLock(pending);
      await a.query("commit");
      await pending;
      await b.query("commit");
      assert.equal((await counts()).jobs, first === "draft" ? 0 : 1);
      await record(first + "-wins-activation-race", { lockObserved: true });
    }
    for (const first of ["disable", "claim"]) {
      await reset();
      await queued();
      await a.query("begin");
      let j;
      if (first === "disable") await mode(a, "DISABLED");
      else j = await claim(a);
      await b.query("begin");
      pending = first === "disable" ? claim(b) : mode(b, "DISABLED");
      await pendingLock(pending);
      await a.query("commit");
      const result = await pending;
      await b.query("commit");
      if (first === "disable") assert.equal(result, null);
      else assert.equal(await begin(db, j), null);
      await record(first + "-wins-disable-race", {
        lockObserved: true,
        dispatchBlocked: true,
      });
    }
    await reset();
    await mode(db);
    const before = await counts();
    await db.query(
      "alter table whatsapp_outbound_jobs add constraint native_forced_failure check(false) not valid",
    );
    await assert.rejects(ingest(a, [event()]), (e) => e.code === "23514");
    await db.query(
      "alter table whatsapp_outbound_jobs drop constraint native_forced_failure",
    );
    assert.deepEqual(await counts(), before);
    assert.equal(
      (await db.query("select count(*)::int n from contacts")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from conversations")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::int n from webhook_events")).rows[0].n,
      0,
    );
    await record("enqueue-failure-rolls-back-whole-inbound");

    for (const dispatched of [false, true]) {
      await reset();
      await queued();
      const worker = await h.client("outbox-crashing-worker");
      const j = await claim(worker);
      if (dispatched) assert.ok(await begin(worker, j));
      const pid = (await worker.query("select pg_backend_pid() pid")).rows[0]
        .pid;
      await db.query("select pg_terminate_backend($1)", [pid]);
      // Advance only this fixture's lease instead of waiting two minutes.
      await db.query(
        "update whatsapp_outbound_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",
        [j.id],
      );
      const recovered = await recover(db, j);
      assert.equal(
        recovered,
        dispatched ? "RECONCILIATION_REQUIRED" : "QUEUED",
      );
      assert.equal(await claim(b), null);
      await db.query(
        "update whatsapp_outbound_jobs set available_at=clock_timestamp()-interval '1 second' where id=$1",
        [j.id],
      );
      const retry = await claim(b);
      if (dispatched) assert.equal(retry, null);
      else {
        assert.ok(retry);
        assert.notEqual(retry.claim_token, j.claim_token);
      }
      await record(
        dispatched
          ? "crash-after-dispatch-no-blind-retry"
          : "crash-before-dispatch-fenced-recovery",
        { recovered, backendTerminated: true },
      );
    }
  }
  assert.equal((await counts()).outbound, 0);
  console.log(
    JSON.stringify(
      {
        postgres: (await db.query("show server_version")).rows[0]
          .server_version,
        mode: process.argv.includes("--benchmark")
          ? "local-benchmark"
          : "native-concurrency",
        results,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      error: "Verificação LOCAL da outbox falhou",
      code: typeof error.code === "string" ? error.code : null,
      caseCount: results.length,
    }),
  );
  process.exitCode = 1;
} finally {
  if (h) await h.close();
}
