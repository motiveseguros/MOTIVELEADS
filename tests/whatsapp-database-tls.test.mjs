import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { rootCertificates } from "node:tls";
import { loadDatabaseTls } from "../scripts/lib/whatsapp-database-tls.mjs";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
let directory, certificate;
const ca = rootCertificates[0]; // Public trust anchor bundled with Node; no network or credentials.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "motive-ca-test-"));
  certificate = join(directory, "ca.crt");
  await writeFile(certificate, ca);
  await writeFile(join(directory, "empty.crt"), "");
  await writeFile(
    join(directory, "invalid.crt"),
    "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----",
  );
});
afterEach(() => vi.mocked(readFile).mockClear());
afterAll(async () => {
  for (const file of ["ca.crt", "empty.crt", "invalid.crt"])
    await unlink(join(directory, file));
  await rmdir(directory);
});
describe("TLS administrativo com CA explícito", () => {
  it("lê certificado local e mantém rejectUnauthorized true", async () => {
    expect(await loadDatabaseTls(certificate)).toEqual({
      ca,
      rejectUnauthorized: true,
    });
  });
  it("resolve caminho relativo à raiz do projeto", async () => {
    const projectRoot = fileURLToPath(new URL("../", import.meta.url));
    expect(await loadDatabaseTls(relative(projectRoot, certificate))).toEqual({
      ca,
      rejectUnauthorized: true,
    });
  });
  it.each([undefined, "", " \t"])(
    "recusa CA path ausente antes de ler arquivo",
    async (value) => {
      await expect(loadDatabaseTls(value)).rejects.toThrow(
        "Configure SUPABASE_DATABASE_CA_PATH",
      );
      expect(readFile).not.toHaveBeenCalled();
    },
  );
  it("arquivo inexistente não expõe caminho ou secrets", async () => {
    const missing = join(directory, "sb_secret_TEST_ONLY-password-example.crt");
    const error = await loadDatabaseTls(missing).catch((error) => error);
    expect(error.message).toContain("Não foi possível ler");
    expect(error.message).not.toContain(missing);
    expect(error.message).not.toContain("sb_secret_TEST_ONLY");
    expect(error).not.toHaveProperty("cause");
  });
  it("recusa diretório no lugar de arquivo", async () => {
    await expect(loadDatabaseTls(directory)).rejects.toThrow("é um arquivo");
  });
  it("falha de leitura é sanitizada sem fallback TLS", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(
        new Error(
          "EACCES postgresql://fixture-user:fixture-password@fixture-host sb_secret_TEST_ONLY",
        ),
        { code: "EACCES" },
      ),
    );
    const error = await loadDatabaseTls(certificate).catch((error) => error);
    expect(error.message).toContain("permissão de leitura");
    for (const forbidden of [
      "postgresql://",
      "fixture-user",
      "fixture-password",
      "fixture-host",
      "sb_secret_TEST_ONLY",
      certificate,
    ])
      expect(error.message).not.toContain(forbidden);
    expect(error).not.toHaveProperty("cause");
  });
  it.each(["empty.crt", "invalid.crt"])(
    "recusa certificado inválido: %s",
    async (file) => {
      await expect(loadDatabaseTls(join(directory, file))).rejects.toThrow(
        "certificado CA PEM válido",
      );
    },
  );
});
