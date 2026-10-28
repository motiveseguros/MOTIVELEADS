import { isDeepStrictEqual } from "node:util";
import {
  accountFixture as account,
  inboundFixture as event,
  fixtureEventKey,
  fixtureTimestamp,
  requireSafe,
} from "./whatsapp-homologation-fixture.mjs";

function matches(row, expected) {
  return Object.entries(expected).every(([key, value]) => row[key] === value);
}
function timestamp(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
async function transaction(db, work) {
  await db.query("begin");
  try {
    await db.query("set local search_path=''");
    await db.query("set local lock_timeout='5s'");
    await db.query("set local statement_timeout='15s'");
    const result = await work();
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
/** Reject collisions and all unexpected data; never log returned database rows. */
export async function inspectFixture(db, { expectedLeadId = null } = {}) {
  const accounts = (
    await db.query(
      "select * from public.whatsapp_accounts where id=$1 or phone_number_id=$2 or waba_id=$3 or name=$4 limit 2 for update",
      [account.id, account.phone_number_id, account.waba_id, account.name],
    )
  ).rows;
  requireSafe(accounts.length <= 1);
  if (accounts.length) requireSafe(matches(accounts[0], account));
  const contacts = (
    await db.query(
      "select * from public.contacts where whatsapp_account_id=$1 limit 2 for update",
      [account.id],
    )
  ).rows;
  const conversations = (
    await db.query(
      "select * from public.conversations where whatsapp_account_id=$1 limit 2 for update",
      [account.id],
    )
  ).rows;
  const messages = (
    await db.query(
      "select m.* from public.messages m where m.external_message_id=$1 or m.conversation_id in (select id from public.conversations where whatsapp_account_id=$2) limit 2 for update",
      [event.external_message_id, account.id],
    )
  ).rows;
  const events = (
    await db.query(
      "select * from public.webhook_events where event_key like $1 or event_key like $2 or payload->>'phone_number_id'=$3 limit 2 for update",
      [
        "message:" + account.id + ":%",
        "status:" + account.id + ":%",
        account.phone_number_id,
      ],
    )
  ).rows;
  const accountRow = accounts[0] ?? null;
  if (
    !contacts.length &&
    !conversations.length &&
    !messages.length &&
    !events.length
  )
    return {
      account: accountRow,
      contact: null,
      conversation: null,
      message: null,
      event: null,
    };
  requireSafe(
    Boolean(accountRow) &&
      contacts.length === 1 &&
      conversations.length === 1 &&
      messages.length === 1 &&
      events.length === 1,
  );
  const [contact] = contacts,
    [conversation] = conversations,
    [message] = messages,
    [webhookEvent] = events;
  requireSafe(
    matches(contact, {
      whatsapp_account_id: account.id,
      wa_id: event.wa_id,
      display_name: event.display_name,
      phone: null,
      email: null,
      city: null,
      state: null,
    }),
  );
  requireSafe(
    matches(conversation, {
      whatsapp_account_id: account.id,
      contact_id: contact.id,
      status: "OPEN",
      lead_id: expectedLeadId,
    }),
  );
  requireSafe(timestamp(conversation.last_message_at) === fixtureTimestamp);
  requireSafe(
    matches(message, {
      conversation_id: conversation.id,
      external_message_id: event.external_message_id,
      direction: "INBOUND",
      type: "text",
      text_body: event.text_body,
      status: "RECEIVED",
      sent_by_profile_id: null,
    }),
  );
  requireSafe(timestamp(message.provider_timestamp) === fixtureTimestamp);
  requireSafe(
    matches(webhookEvent, {
      provider: "WHATSAPP",
      event_key: fixtureEventKey,
      processing_error: null,
    }),
  );
  requireSafe(
    webhookEvent.processed_at !== null &&
      isDeepStrictEqual(webhookEvent.payload, event),
  );
  return {
    account: accountRow,
    contact,
    conversation,
    message,
    event: webhookEvent,
  };
}
export async function prepareFixtureAccount(db) {
  return transaction(db, async () => {
    const before = await inspectFixture(db);
    if (before.account) return false;
    // This is the only direct INSERT: infrastructure account. Contact/conversation/message use the RPC.
    const inserted = await db.query(
      "insert into public.whatsapp_accounts(id,name,waba_id,phone_number_id,display_phone_number,active) values($1,$2,$3,$4,$5,$6) on conflict do nothing returning id",
      [
        account.id,
        account.name,
        account.waba_id,
        account.phone_number_id,
        account.display_phone_number,
        account.active,
      ],
    );
    const after = await inspectFixture(db);
    requireSafe(Boolean(after.account));
    return inserted.rows.length === 1;
  });
}
export async function readFixtureSummary(db) {
  return transaction(db, async () => {
    const fixture = await inspectFixture(db);
    requireSafe(
      Boolean(fixture.message),
      "Ingestão não pôde ser comprovada; não há fixture completa esperada.",
    );
    // Only allowlisted, validated fixture data can leave this module.
    return {
      whatsapp_account: { id: account.id, name: account.name },
      contact: { id: fixture.contact.id, display_name: event.display_name },
      conversation: {
        id: fixture.conversation.id,
        status: "OPEN",
        lead_id: null,
      },
      messages: 1,
      text_body: event.text_body,
    };
  });
}
export async function cleanupFixture(db) {
  return transaction(db, async () => {
    // Account lock blocks the ingestion RPC; row locks protect the inspected fixture graph.
    const fixture = await inspectFixture(db);
    if (!fixture.account) return { removed: false, messages: 0 };
    const removeOne = async (sql, values) =>
      requireSafe((await db.query(sql, values)).rows.length === 1);
    if (fixture.message) {
      await removeOne(
        "delete from public.messages where id=$1 and conversation_id=$2 and external_message_id=$3 and direction='INBOUND' and type='text' and text_body=$4 and status='RECEIVED' and sent_by_profile_id is null returning id",
        [
          fixture.message.id,
          fixture.conversation.id,
          event.external_message_id,
          event.text_body,
        ],
      );
      await removeOne(
        "delete from public.webhook_events where id=$1 and provider='WHATSAPP' and event_key=$2 and payload=$3::jsonb returning id",
        [fixture.event.id, fixtureEventKey, JSON.stringify(event)],
      );
      await removeOne(
        "delete from public.conversations where id=$1 and whatsapp_account_id=$2 and contact_id=$3 and lead_id is null and status='OPEN' returning id",
        [fixture.conversation.id, account.id, fixture.contact.id],
      );
      await removeOne(
        "delete from public.contacts where id=$1 and whatsapp_account_id=$2 and wa_id=$3 and display_name=$4 returning id",
        [fixture.contact.id, account.id, event.wa_id, event.display_name],
      );
    }
    await removeOne(
      "delete from public.whatsapp_accounts where id=$1 and name=$2 and waba_id=$3 and phone_number_id=$4 and display_phone_number=$5 and active=true returning id",
      [
        account.id,
        account.name,
        account.waba_id,
        account.phone_number_id,
        account.display_phone_number,
      ],
    );
    return { removed: true, messages: fixture.message ? 1 : 0 };
  });
}
