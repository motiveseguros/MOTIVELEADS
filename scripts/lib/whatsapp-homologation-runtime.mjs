import { connectionDiagnostic } from "./whatsapp-connection-diagnostic.mjs";
import { loadDatabaseTls } from "./whatsapp-database-tls.mjs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  accountFixture,
  inboundFixture,
  HomologationError,
  requireSafe,
} from "./whatsapp-homologation-fixture.mjs";

export function readConfiguration(env) {
  requireSafe(
    Boolean(env.NEXT_PUBLIC_SUPABASE_URL?.trim()) &&
      Boolean(env.SUPABASE_SECRET_KEY?.trim()),
    "Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY em .env.local.",
  );
  let url, database;
  try {
    url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    database = new URL(env.WHATSAPP_HOMOLOGATION_DATABASE_URL);
  } catch {
    throw new HomologationError(
      "Configure URLs válidas, incluindo WHATSAPP_HOMOLOGATION_DATABASE_URL administrativa.",
    );
  }
  const match = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
  requireSafe(
    Boolean(match) &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash,
    "Use a URL HTTPS padrão do projeto Supabase, sem credenciais, caminho ou parâmetros.",
  );
  const projectRef = match[1];
  requireSafe(
    env.SUPABASE_SECRET_KEY.startsWith("sb_secret_"),
    "Use uma SUPABASE_SECRET_KEY atual, exclusivamente server-side.",
  );
  const username = decodeURIComponent(database.username);
  const direct =
    database.hostname === "db." + projectRef + ".supabase.co" &&
    username === "postgres";
  const sessionPooler =
    /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname) &&
    username === "postgres." + projectRef;
  requireSafe(
    ["postgres:", "postgresql:"].includes(database.protocol) &&
      (direct || sessionPooler) &&
      (!database.port || database.port === "5432") &&
      database.pathname === "/postgres" &&
      Boolean(database.password) &&
      !database.hash,
    "A conexão administrativa deve ser do mesmo projeto, direta ou pooler de sessão, porta 5432. Pooler transacional é recusado.",
  );
  requireSafe(
    [...database.searchParams].every(
      ([key, value]) =>
        key === "sslmode" && ["require", "verify-full"].includes(value),
    ),
    "Parâmetros de conexão não permitidos. TLS com verificação de certificado é obrigatório.",
  );
  requireSafe(
    Boolean(env.SUPABASE_DATABASE_CA_PATH?.trim()),
    "Configure SUPABASE_DATABASE_CA_PATH com o certificado CA oficial do Supabase.",
  );
  return {
    origin: url.origin,
    projectRef,
    secret: env.SUPABASE_SECRET_KEY,
    caPath: env.SUPABASE_DATABASE_CA_PATH,
    pg: {
      host: database.hostname,
      port: 5432,
      user: username,
      password: decodeURIComponent(database.password),
      database: "postgres",
      ssl: { rejectUnauthorized: true },
      application_name: "motive-whatsapp-homologation",
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 30000,
    },
  };
}
export async function confirmOperation(mode, config, io) {
  requireSafe(mode === "ingest" || mode === "cleanup", "Operação inválida.");
  requireSafe(
    io.isTTY,
    "Execute em terminal interativo; confirmação por pipe ou flag não é aceita.",
  );
  const phrase =
    (mode === "cleanup" ? "LIMPAR " : "HOMOLOGAR ") + config.projectRef;
  io.log("Destino REMOTO: " + config.origin);
  io.log(
    "Fixture: " +
      accountFixture.name +
      " / " +
      inboundFixture.external_message_id,
  );
  io.log(
    mode === "cleanup"
      ? "Serão removidas somente as fixtures exatas deste teste. Dados divergentes interrompem o cleanup."
      : "Será criada/reutilizada a conta fictícia e a mensagem será ingerida pela RPC existente.",
  );
  requireSafe(
    (await io.ask('Digite exatamente "' + phrase + '" para confirmar: ')) ===
      phrase,
    "Confirmação não fornecida; nenhuma operação remota iniciada.",
  );
}
export async function ingestFixture(config) {
  const client = createClient(config.origin, config.secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        }),
    },
  });
  const { data, error } = await client.rpc("ingest_whatsapp_events", {
    p_events: [{ ...inboundFixture }],
  });
  requireSafe(
    !error &&
      data &&
      [0, 1].includes(data.inserted) &&
      [0, 1].includes(data.duplicates) &&
      data.inserted + data.duplicates === 1 &&
      data.statuses === 0,
    "RPC não confirmada. O resultado pode ser indeterminado após falha de rede; repetir com os mesmos IDs é seguro.",
  );
  return { inserted: data.inserted, duplicates: data.duplicates };
}
/** Confirmation precedes connection and every write. No CLI flag bypasses it. */
export async function runControlled(mode, config, io, connect, operation) {
  await confirmOperation(mode, config, io);
  const db = await connect();
  let acquired = false;
  try {
    // Session lock coordinates these scripts; session pooler/direct connection only.
    const lock = await db.query(
      "select pg_catalog.pg_try_advisory_lock($1,$2) as acquired",
      [20261027, 202],
    );
    acquired = lock.rows[0]?.acquired === true;
    requireSafe(
      acquired,
      "Outra homologação/limpeza está em execução; tente novamente depois.",
    );
    return await operation(db);
  } finally {
    // Explicit unlock before returning a session-pooler connection.
    try {
      if (acquired)
        await db.query(
          "select pg_catalog.pg_advisory_unlock($1,$2)",
          [20261027, 202],
        );
    } finally {
      await db.end();
    }
  }
}
export async function main(
  mode,
  operation,
  { connectionDiagnostics = false } = {},
) {
  try {
    requireSafe(
      process.argv.length === 2,
      "Argumentos não são aceitos; confirme a operação no terminal.",
    );
    try {
      loadEnvFile(fileURLToPath(new URL("../../.env.local", import.meta.url)));
    } catch {
      throw new HomologationError(
        "Não foi possível carregar .env.local do projeto.",
      );
    }
    const config = readConfiguration(process.env);
    const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const io = {
      isTTY,
      log: (line) => console.log(line),
      ask: async (question) => {
        const prompt = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        try {
          return await prompt.question(question);
        } finally {
          prompt.close();
        }
      },
    };
    const summary = await runControlled(
      mode,
      config,
      io,
      async () => {
        const ssl = await loadDatabaseTls(config.caPath);
        const db = new Client({ ...config.pg, ssl });
        db.on("error", () => {}); // Never dump driver errors/connection details.
        try {
          await db.connect();
        } catch (error) {
          await db.end().catch(() => {});
          if (connectionDiagnostics)
            throw new HomologationError(
              JSON.stringify(connectionDiagnostic(error), null, 2),
            );
          throw new HomologationError(
            "Conexão administrativa recusada. Confira configuração e certificado TLS localmente.",
          );
        }
        return db;
      },
      (db) => operation(db, config),
    );
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(
      error instanceof HomologationError
        ? error.message
        : "Operação não concluída. Nenhum detalhe de conexão ou erro remoto será exibido. Confira as fixtures e a configuração localmente.",
    );
    process.exitCode = 1;
  }
}
