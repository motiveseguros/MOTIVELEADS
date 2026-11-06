import {
  accountFixture,
  HomologationError,
  requireSafe,
} from "./whatsapp-homologation-fixture.mjs";

// Explicitly authorized Meta TEST number. Changing .env.local cannot select an official number.
const authorizedTest = Object.freeze({
  waba_id: "1169885138706340",
  phone_number_id: "1519898697862586",
  digits: "+15551564835",
});
function readTestAccount(env) {
  const waba = env.WHATSAPP_TEST_WABA_ID;
  const phone = env.WHATSAPP_TEST_PHONE_NUMBER_ID;
  const display = env.WHATSAPP_TEST_DISPLAY_PHONE_NUMBER;
  requireSafe(
    typeof waba === "string" &&
      /^[0-9]{1,64}$/.test(waba) &&
      typeof phone === "string" &&
      /^[0-9]{1,64}$/.test(phone),
    "Configure WHATSAPP_TEST_WABA_ID e WHATSAPP_TEST_PHONE_NUMBER_ID com IDs numéricos válidos.",
  );
  requireSafe(
    typeof display === "string" &&
      display.length <= 40 &&
      /^\+[0-9 ()-]+$/.test(display) &&
      display.replace(/[ ()-]/g, "") === authorizedTest.digits,
    "WHATSAPP_TEST_DISPLAY_PHONE_NUMBER deve corresponder ao número de teste autorizado.",
  );
  requireSafe(
    waba === authorizedTest.waba_id && phone === authorizedTest.phone_number_id,
    "Os IDs não correspondem ao número de TESTE autorizado; nenhuma outra conta pode ser provisionada.",
  );
  return {
    name: "META TEST NUMBER",
    waba_id: waba,
    phone_number_id: phone,
    display_phone_number: display,
    active: true,
  };
}
export function readTestConfiguration(env) {
  const account = readTestAccount(env);
  let database, username, password;
  try {
    database = new URL(env.WHATSAPP_HOMOLOGATION_DATABASE_URL);
    username = decodeURIComponent(database.username);
    password = decodeURIComponent(database.password);
  } catch {
    throw new HomologationError(
      "Configure WHATSAPP_HOMOLOGATION_DATABASE_URL administrativa válida.",
    );
  }
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(database.hostname);
  const poolerUser = /^postgres\.([a-z0-9]+)$/.exec(username);
  const projectRef =
    direct && username === "postgres"
      ? direct[1]
      : /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname) &&
          poolerUser
        ? poolerUser[1]
        : null;
  requireSafe(
    Boolean(projectRef) &&
      ["postgres:", "postgresql:"].includes(database.protocol) &&
      (!database.port || database.port === "5432") &&
      database.pathname === "/postgres" &&
      Boolean(password) &&
      !database.hash &&
      [...database.searchParams].every(
        ([key, value]) =>
          key === "sslmode" && ["require", "verify-full"].includes(value),
      ),
    "Use conexão Supabase administrativa direta ou pooler de sessão, porta 5432, sem parâmetros adicionais. TLS verificado é obrigatório.",
  );
  requireSafe(
    Boolean(env.SUPABASE_DATABASE_CA_PATH?.trim()),
    "Configure SUPABASE_DATABASE_CA_PATH com o CA oficial do Supabase.",
  );
  return {
    projectRef,
    caPath: env.SUPABASE_DATABASE_CA_PATH,
    account,
    pg: {
      host: database.hostname,
      port: 5432,
      user: username,
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: true },
      application_name: "motive-whatsapp-test-provision",
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 30000,
    },
  };
}
function assertOwned(row, account) {
  requireSafe(
    row &&
      row.id !== accountFixture.id &&
      row.name === account.name &&
      row.waba_id === account.waba_id &&
      row.phone_number_id === account.phone_number_id,
    "Conta existente divergente ou protegida; provisionamento recusado sem alteração.",
  );
}
/** Only the authorized account is selected or written. All checks/writes are atomic. */
export async function provisionTestAccount(db, account) {
  // Revalidate the target even for callers other than the CLI.
  readTestAccount({
    WHATSAPP_TEST_WABA_ID: account.waba_id,
    WHATSAPP_TEST_PHONE_NUMBER_ID: account.phone_number_id,
    WHATSAPP_TEST_DISPLAY_PHONE_NUMBER: account.display_phone_number,
  });
  requireSafe(
    account.name === "META TEST NUMBER" && account.active === true,
    "Destino de provisionamento inválido.",
  );
  await db.query("begin");
  try {
    await db.query("set local search_path=''");
    await db.query("set local lock_timeout='5s'");
    await db.query("set local statement_timeout='15s'");
    await db.query(
      "select pg_catalog.pg_advisory_xact_lock($1,$2)",
      [20261105, 203],
    );
    const read = async () =>
      (
        await db.query(
          "select id,name,waba_id,phone_number_id,display_phone_number,active from public.whatsapp_accounts where phone_number_id=$1 for update",
          [account.phone_number_id],
        )
      ).rows[0];
    let row = await read();
    if (!row) {
      await db.query(
        "insert into public.whatsapp_accounts(name,waba_id,phone_number_id,display_phone_number,active) values($1,$2,$3,$4,true) on conflict(phone_number_id) do nothing",
        [
          account.name,
          account.waba_id,
          account.phone_number_id,
          account.display_phone_number,
        ],
      );
      row = await read();
    }
    assertOwned(row, account);
    if (
      row.display_phone_number !== account.display_phone_number ||
      row.active !== true
    ) {
      const changed = await db.query(
        "update public.whatsapp_accounts set display_phone_number=$1,active=true where id=$2 and name=$3 and waba_id=$4 and phone_number_id=$5 returning id",
        [
          account.display_phone_number,
          row.id,
          account.name,
          account.waba_id,
          account.phone_number_id,
        ],
      );
      requireSafe(changed.rows.length === 1, "Conta mudou; operação recusada.");
    }
    const final = await read();
    assertOwned(final, account);
    requireSafe(
      final.display_phone_number === account.display_phone_number &&
        final.active === true,
      "Não foi possível confirmar o provisionamento.",
    );
    const summary = {
      name: final.name,
      waba_id: final.waba_id,
      phone_number_id: final.phone_number_id,
      display_phone_number: final.display_phone_number,
      active: final.active,
    };
    await db.query("commit");
    return summary;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
export async function runTestProvision(config, io, connect) {
  requireSafe(
    io.isTTY,
    "Execute em terminal interativo; confirmação por pipe/flag não é aceita.",
  );
  io.log("Projeto remoto Supabase: " + config.projectRef);
  io.log(JSON.stringify(config.account, null, 2));
  const phrase =
    "PROVISIONAR TESTE " +
    config.projectRef +
    " " +
    config.account.phone_number_id;
  requireSafe(
    (await io.ask('Digite exatamente "' + phrase + '" para confirmar: ')) ===
      phrase,
    "Confirmação não fornecida; nenhuma conexão remota iniciada.",
  );
  const db = await connect();
  try {
    return await provisionTestAccount(db, config.account);
  } finally {
    await db.end();
  }
}
export function provisioningError(error) {
  return error instanceof HomologationError
    ? error.message
    : "Provisionamento não confirmado. Detalhes remotos foram ocultados; confira a configuração localmente. Repetir com os mesmos IDs é seguro.";
}
