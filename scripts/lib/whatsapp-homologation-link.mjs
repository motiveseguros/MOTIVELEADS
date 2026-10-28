import { inspectFixture } from "./whatsapp-homologation-db.mjs";
import {
  accountFixture,
  requireSafe,
} from "./whatsapp-homologation-fixture.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateTarget(target) {
  requireSafe(
    target &&
      [
        "conversationId",
        "contactId",
        "leadId",
        "employeeId",
        "productId",
      ].every((key) => uuid.test(target[key] ?? "")),
    "Identificadores do vínculo inválidos.",
  );
  requireSafe(
    /^[a-z0-9]+$/.test(target.projectRef ?? ""),
    "Projeto do vínculo inválido.",
  );
  requireSafe(
    typeof target.previousRevision === "string" &&
      target.previousRevision.length > 0,
    "Revisão original ausente.",
  );
}
async function transaction(db, work) {
  await db.query("begin");
  try {
    await db.query("set local search_path=''");
    await db.query("set local lock_timeout='5s'");
    await db.query("set local statement_timeout='15s'");
    const lock = await db.query(
      "select pg_catalog.pg_try_advisory_xact_lock($1,$2) as acquired",
      [20261027, 202],
    );
    requireSafe(
      lock.rows[0]?.acquired === true,
      "Outra operação de homologação está em execução.",
    );
    const result = await work();
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
/** Operational exception for the exact fictitious conversation, not an application RPC. */
export async function linkFixtureToLead(db, target, saveReceipt) {
  validateTarget(target);
  requireSafe(
    typeof saveReceipt === "function",
    "Registro local de reversão obrigatório.",
  );
  return transaction(db, async () => {
    const fixture = await inspectFixture(db);
    requireSafe(
      fixture.conversation?.id === target.conversationId &&
        fixture.contact?.id === target.contactId,
      "Fixture alvo não corresponde à conversa inspecionada.",
    );
    const revision = (
      await db.query(
        "select updated_at::text as revision from public.conversations where id=$1",
        [target.conversationId],
      )
    ).rows[0]?.revision;
    requireSafe(
      revision === target.previousRevision,
      "Conversa mudou após a inspeção; vínculo recusado.",
    );
    const leads = (
      await db.query(
        "select l.id from public.leads l join public.employees e on e.id=l.assigned_employee_id join public.products p on p.id=l.product_id where l.id=$1 and e.id=$2 and p.id=$3 and e.active and p.active and e.name ~* '^bruna([[:space:]]|$)' and lower(p.name)=lower($4) and l.status in ('ASSIGNED','IN_PROGRESS') for update of l,e,p",
        [target.leadId, target.employeeId, target.productId, "Consórcio"],
      )
    ).rows;
    requireSafe(
      leads.length === 1,
      "Lead não está aberto e atribuído à Bruna ativa em Consórcio ativo; vínculo recusado.",
    );
    const updated = await db.query(
      "update public.conversations set lead_id=$1 where id=$2 and whatsapp_account_id=$3 and contact_id=$4 and lead_id is null and status='OPEN' and updated_at=$5::timestamptz returning updated_at::text as revision",
      [
        target.leadId,
        target.conversationId,
        accountFixture.id,
        target.contactId,
        target.previousRevision,
      ],
    );
    requireSafe(
      updated.rows.length === 1,
      "Vínculo não confirmado; transação revertida.",
    );
    const receipt = {
      version: 1,
      accountId: accountFixture.id,
      ...target,
      previousLeadId: null,
      linkedRevision: updated.rows[0].revision,
    };
    // Persist recovery information before COMMIT. On an ambiguous commit, keep it for inspection.
    await saveReceipt(receipt);
    return receipt;
  });
}
/** Remove only the recorded link. Never delete fixtures or modify a lead/assignment. */
export async function revertFixtureLeadLink(db, receipt, projectRef) {
  validateTarget(receipt);
  requireSafe(
    receipt.version === 1 &&
      receipt.accountId === accountFixture.id &&
      receipt.previousLeadId === null &&
      receipt.projectRef === projectRef &&
      typeof receipt.linkedRevision === "string" &&
      receipt.linkedRevision.length > 0,
    "Registro de reversão inválido ou de outro projeto.",
  );
  return transaction(db, async () => {
    const fixture = await inspectFixture(db, {
      expectedLeadId: receipt.leadId,
    });
    requireSafe(
      fixture.conversation?.id === receipt.conversationId &&
        fixture.contact?.id === receipt.contactId,
      "Fixture de reversão divergente.",
    );
    const result = await db.query(
      "update public.conversations set lead_id=null where id=$1 and whatsapp_account_id=$2 and contact_id=$3 and lead_id=$4 and status='OPEN' and updated_at=$5::timestamptz returning id",
      [
        receipt.conversationId,
        receipt.accountId,
        receipt.contactId,
        receipt.leadId,
        receipt.linkedRevision,
      ],
    );
    requireSafe(
      result.rows.length === 1,
      "Conversa alterada desde o vínculo; reversão automática recusada.",
    );
    return {
      reverted: true,
      conversationId: receipt.conversationId,
      leadId: receipt.leadId,
      currentLeadId: null,
    };
  });
}
