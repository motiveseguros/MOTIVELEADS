import { main, ingestFixture } from "./lib/whatsapp-homologation-runtime.mjs";
import {
  prepareFixtureAccount,
  readFixtureSummary,
} from "./lib/whatsapp-homologation-db.mjs";
await main(
  "ingest",
  async (db, config) => {
    const accountCreated = await prepareFixtureAccount(db);
    // Commit account creation before HTTP RPC: do not hold its row lock across requests.
    const rpc = await ingestFixture(config);
    const summary = await readFixtureSummary(db);
    return { ...summary, accountCreated, rpc };
  },
  { connectionDiagnostics: true },
);
