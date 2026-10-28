import { main } from "./lib/whatsapp-homologation-runtime.mjs";
import { cleanupFixture } from "./lib/whatsapp-homologation-db.mjs";
await main("cleanup", cleanupFixture);
