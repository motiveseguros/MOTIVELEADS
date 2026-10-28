import { describe, expect, it } from "vitest";
import { connectionDiagnostic } from "../scripts/lib/whatsapp-connection-diagnostic.mjs";

describe("diagnóstico temporário PostgreSQL sem credenciais", () => {
  it.each([
    [
      "28P01",
      'password authentication failed for user "fixture-user"',
      "authentication",
      "password authentication failed for user [redigido]",
    ],
    [
      "ENOTFOUND",
      "getaddrinfo ENOTFOUND fixture-host",
      "DNS",
      "getaddrinfo ENOTFOUND [redigido]",
    ],
    [
      "SELF_SIGNED_CERT_IN_CHAIN",
      "self-signed certificate in certificate chain",
      "TLS",
      "self-signed certificate in certificate chain",
    ],
    [
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "Hostname/IP does not match certificate's altnames: Host: fixture-host",
      "TLS",
      "Hostname/IP does not match certificate's altnames [redigido]",
    ],
    [
      "ETIMEDOUT",
      "connect ETIMEDOUT fixture-host:5432",
      "timeout",
      "connect ETIMEDOUT [redigido]",
    ],
    [
      "ECONNREFUSED",
      "connect ECONNREFUSED fixture-host:5432",
      "connection_refused",
      "connect ECONNREFUSED [redigido]",
    ],
    [
      undefined,
      "Connection terminated due to connection timeout",
      "timeout",
      "Connection terminated due to connection timeout",
    ],
    [
      undefined,
      "Tenant or user not found",
      "authentication",
      "Tenant or user not found [redigido]",
    ],
  ])(
    "classifica %s e conserva somente a mensagem segura",
    (code, message, category, safeMessage) => {
      expect(connectionDiagnostic({ name: "Error", code, message })).toEqual({
        name: "Error",
        code: code ?? null,
        message: safeMessage,
        category,
      });
    },
  );
  it.each([
    "password authentication failed for user ",
    "getaddrinfo ENOTFOUND ",
    "self-signed certificate in certificate chain ",
    "unexpected driver detail ",
  ])(
    "não repassa dados variáveis, stack ou propriedades extras: %s",
    (prefix) => {
      const credentials =
        "postgresql://fixture-user:p%40ss%3Aword@fixture-host/postgres password=p@ss:word sb_secret_TEST_ONLY";
      const diagnostic = connectionDiagnostic({
        name: "DatabaseError",
        code: "28P01",
        message: prefix + credentials + "\n" + credentials,
        stack: credentials,
        detail: credentials,
        hint: credentials,
        cause: new Error(credentials),
      });
      expect(Object.keys(diagnostic)).toEqual([
        "name",
        "code",
        "message",
        "category",
      ]);
      for (const secret of [
        "postgresql://",
        "fixture-user",
        "fixture-host",
        "p%40ss%3Aword",
        "p@ss:word",
        "sb_secret_TEST_ONLY",
      ])
        expect(JSON.stringify(diagnostic)).not.toContain(secret);
    },
  );
  it("campos name/code desconhecidos e erros sem mensagem não vazam dados", () => {
    const diagnostic = connectionDiagnostic({
      name: "sb_secret_TEST_ONLY",
      code: "password=TEST_ONLY",
      message: "postgres://TEST_ONLY",
    });
    expect(diagnostic).toEqual({
      name: "Error",
      code: null,
      message:
        "Mensagem do driver ocultada: formato não reconhecido com segurança.",
      category: "unknown",
    });
    expect(connectionDiagnostic(null)).toEqual(diagnostic);
  });
});
