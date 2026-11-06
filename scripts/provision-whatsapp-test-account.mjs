import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { Client } from "pg";
import { loadDatabaseTls } from "./lib/whatsapp-database-tls.mjs";
import {
  HomologationError,
  requireSafe,
} from "./lib/whatsapp-homologation-fixture.mjs";
import {
  readTestConfiguration,
  runTestProvision,
  provisioningError,
} from "./lib/whatsapp-test-provisioning.mjs";

try {
  requireSafe(
    process.argv.length === 2,
    "Argumentos não são aceitos; use a confirmação interativa.",
  );
  try {
    loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
  } catch {
    throw new HomologationError(
      "Não foi possível carregar .env.local do projeto.",
    );
  }
  const config = readTestConfiguration(process.env);
  const summary = await runTestProvision(
    config,
    {
      isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
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
    },
    async () => {
      // CA validation and all networking happen only after explicit confirmation.
      const ssl = await loadDatabaseTls(config.caPath);
      const db = new Client({ ...config.pg, ssl });
      db.on("error", () => {});
      try {
        await db.connect();
      } catch {
        await db.end().catch(() => {});
        throw new HomologationError(
          "Conexão administrativa recusada. Confira configuração e certificado CA; detalhes do driver foram ocultados.",
        );
      }
      return db;
    },
  );
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(provisioningError(error));
  process.exitCode = 1;
}
