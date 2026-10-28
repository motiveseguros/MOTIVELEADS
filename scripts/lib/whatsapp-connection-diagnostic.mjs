// Temporary, opt-in diagnostics: never forward arbitrary driver text or properties.
const categories = {
  authentication: ["28P01", "28000"],
  DNS: ["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"],
  TLS: [
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "ERR_SSL_WRONG_VERSION_NUMBER",
  ],
  timeout: ["ETIMEDOUT", "ESOCKETTIMEDOUT", "CONNECT_TIMEOUT"],
  connection_refused: ["ECONNREFUSED"],
};
// Only fixed, recognized driver wording is retained. Suffixes may contain URLs,
// credentials, certificate identities or hostnames, so they are always discarded.
const messages = [
  [
    /^password authentication failed for user\b/i,
    "password authentication failed for user [redigido]",
    "authentication",
  ],
  [
    /^no pg_hba.conf entry for host\b/i,
    "no pg_hba.conf entry for host [redigido]",
    "authentication",
  ],
  [
    /^Tenant or user not found\b/i,
    "Tenant or user not found [redigido]",
    "authentication",
  ],
  [
    /^SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string\b/i,
    "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string",
    "authentication",
  ],
  [/^getaddrinfo ENOTFOUND\b/i, "getaddrinfo ENOTFOUND [redigido]", "DNS"],
  [/^getaddrinfo EAI_AGAIN\b/i, "getaddrinfo EAI_AGAIN [redigido]", "DNS"],
  [
    /^self[- ]signed certificate in certificate chain\b/i,
    "self-signed certificate in certificate chain",
    "TLS",
  ],
  [/^self[- ]signed certificate\b/i, "self-signed certificate", "TLS"],
  [
    /^unable to verify the first certificate\b/i,
    "unable to verify the first certificate",
    "TLS",
  ],
  [
    /^unable to get local issuer certificate\b/i,
    "unable to get local issuer certificate",
    "TLS",
  ],
  [/^certificate has expired\b/i, "certificate has expired", "TLS"],
  [
    /^Hostname\/IP does not match certificate's altnames\b/i,
    "Hostname/IP does not match certificate's altnames [redigido]",
    "TLS",
  ],
  [
    /^The server does not support SSL connections\b/i,
    "The server does not support SSL connections",
    "TLS",
  ],
  [/^connect ETIMEDOUT\b/i, "connect ETIMEDOUT [redigido]", "timeout"],
  [
    /^Connection terminated due to connection timeout\b/i,
    "Connection terminated due to connection timeout",
    "timeout",
  ],
  [/^timeout expired\b/i, "timeout expired", "timeout"],
  [
    /^connect ECONNREFUSED\b/i,
    "connect ECONNREFUSED [redigido]",
    "connection_refused",
  ],
];
export function connectionDiagnostic(error) {
  const name = [
    "Error",
    "error",
    "DatabaseError",
    "AggregateError",
    "TypeError",
  ].includes(error?.name)
    ? error.name
    : "Error";
  const category = Object.entries(categories).find(([, codes]) =>
    codes.includes(error?.code),
  );
  const message =
    typeof error?.message === "string"
      ? error.message.slice(0, 4096).trimStart()
      : "";
  const recognized = messages.find(([pattern]) => pattern.test(message));
  return {
    name,
    code: category ? error.code : null,
    message:
      recognized?.[1] ??
      "Mensagem do driver ocultada: formato não reconhecido com segurança.",
    category: category?.[0] ?? recognized?.[2] ?? "unknown",
  };
}
