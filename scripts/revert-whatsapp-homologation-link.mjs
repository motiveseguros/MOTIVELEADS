import { loadEnvFile } from "node:process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { Client } from "pg";
import { readConfiguration } from "./lib/whatsapp-homologation-runtime.mjs";
import { loadDatabaseTls } from "./lib/whatsapp-database-tls.mjs";
import { connectionDiagnostic } from "./lib/whatsapp-connection-diagnostic.mjs";
import {
  HomologationError,
  requireSafe,
} from "./lib/whatsapp-homologation-fixture.mjs";
import { revertFixtureLeadLink } from "./lib/whatsapp-homologation-link.mjs";

let db;
try {
  requireSafe(process.argv.length === 2, "Argumentos não são aceitos.");
  try {
    loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
  } catch {
    throw new HomologationError("Não foi possível carregar .env.local.");
  }
  const config = readConfiguration(process.env);
  let receipt;
  try {
    receipt = JSON.parse(
      await readFile(
        new URL("../.homologation/whatsapp-lead-link.json", import.meta.url),
        "utf8",
      ),
    );
  } catch {
    throw new HomologationError(
      "Registro local de reversão ausente, ilegível ou inválido.",
    );
  }
  requireSafe(
    receipt?.projectRef === config.projectRef &&
      /^[0-9a-f-]{36}$/i.test(receipt?.conversationId ?? "") &&
      /^[0-9a-f-]{36}$/i.test(receipt?.leadId ?? ""),
    "Registro de reversão inválido ou de outro projeto.",
  );
  requireSafe(
    process.stdin.isTTY && process.stdout.isTTY,
    "Execute em terminal interativo; confirmação por pipe ou flag não é aceita.",
  );
  console.log("Destino REMOTO: " + config.origin);
  console.log(
    "Remover somente o vínculo da conversa " +
      receipt.conversationId +
      " com o lead " +
      receipt.leadId +
      ". Nenhum registro será excluído.",
  );
  const phrase =
    "DESVINCULAR " + config.projectRef + " " + receipt.conversationId;
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    requireSafe(
      (await prompt.question('Digite exatamente "' + phrase + '": ')) ===
        phrase,
      "Confirmação não fornecida; nenhuma operação remota iniciada.",
    );
  } finally {
    prompt.close();
  }
  db = new Client({ ...config.pg, ssl: await loadDatabaseTls(config.caPath) });
  db.on("error", () => {});
  await db.connect();
  console.log(
    JSON.stringify(
      await revertFixtureLeadLink(db, receipt, config.projectRef),
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof HomologationError
      ? error.message
      : JSON.stringify(connectionDiagnostic(error)),
  );
  process.exitCode = 1;
} finally {
  if (db) await db.end().catch(() => {});
}
