import { readFile, stat } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HomologationError,
  requireSafe,
} from "./whatsapp-homologation-fixture.mjs";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Local CA only; never fall back to an unverified TLS connection. */
export async function loadDatabaseTls(caPath) {
  requireSafe(
    typeof caPath === "string" && Boolean(caPath.trim()),
    "Configure SUPABASE_DATABASE_CA_PATH com o certificado CA oficial do Supabase.",
  );
  let ca;
  try {
    const filename = resolve(projectRoot, caPath);
    if (!(await stat(filename)).isFile()) throw new Error();
    ca = await readFile(filename, "utf8");
  } catch {
    // Paths and OS/driver errors can contain credentials; never forward them.
    throw new HomologationError(
      "Não foi possível ler o arquivo CA indicado por SUPABASE_DATABASE_CA_PATH. Verifique se existe, é um arquivo e possui permissão de leitura.",
    );
  }
  try {
    if (!ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error();
    new X509Certificate(ca);
  } catch {
    throw new HomologationError(
      "O arquivo de SUPABASE_DATABASE_CA_PATH deve conter um certificado CA PEM válido baixado do painel oficial do Supabase.",
    );
  }
  return { ca, rejectUnauthorized: true };
}
