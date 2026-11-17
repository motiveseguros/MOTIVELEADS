// Manual operational entrypoint only. Never imported by an application route or cron.
import "server-only";
import { loadEnvFile } from "node:process";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import {
  createOutboundProvider,
  metaExecutionConfig,
} from "../src/lib/whatsapp/meta-provider";
import { createOutboundStore } from "../src/lib/whatsapp/outbound-store";
import { runOutboundOnce } from "../src/lib/whatsapp/outbound-worker";
async function main() {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    process.argv.length !== 3
  )
    throw new Error("Interactive only");
  const accountId = z.uuid().parse(process.argv[2]);
  loadEnvFile(new URL("../.env.local", import.meta.url));
  const config = metaExecutionConfig();
  if (
    !config ||
    config.WHATSAPP_OUTBOUND_ALLOWED_PHONE_NUMBER_ID !== "1519898697862586"
  )
    throw new Error("Test target only");
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid project");
  const project = url.hostname.split(".")[0];
  if (!process.env.SUPABASE_SECRET_KEY) throw new Error("Missing server key");
  console.log(
    "Projeto: " +
      project +
      " · conta: " +
      accountId +
      " · número Meta de TESTE: " +
      config.WHATSAPP_OUTBOUND_ALLOWED_PHONE_NUMBER_ID,
  );
  console.log(
    "No máximo um job atual. Este comando pode enviar UMA mensagem real. Não há retry.",
  );
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const phrase = "ENVIAR UMA " + project + " " + accountId;
  let answer: string;
  try {
    answer = await prompt.question("Confirme digitando " + phrase + ": ");
  } finally {
    prompt.close();
  }
  if (answer !== phrase) throw new Error("Not confirmed");
  const store = createOutboundStore();
  if (
    !(await store.metaTarget(
      accountId,
      config.WHATSAPP_OUTBOUND_ALLOWED_PHONE_NUMBER_ID,
    ))
  )
    throw new Error("Wrong account");
  const result = await runOutboundOnce(
    accountId,
    store,
    createOutboundProvider(),
  );
  console.log("Resultado: " + result);
  if (result === "RECOVERY_REQUIRED") process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Execução recusada/interrompida. Confira configuração, alvo e confirmação; não repita um envio de resultado incerto.",
  );
  process.exitCode = 1;
});
