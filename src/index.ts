import { serve } from "@hono/node-server";
import { openStore } from "./db.ts";
import { systemClock } from "./domain/clock.ts";
import { createApp } from "./http/app.ts";

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? ":memory:";

serve({ fetch: createApp({ store: openStore(dbPath), clock: systemClock }).fetch, port }, () => {
  console.log(`script-review on http://localhost:${port} (db: ${dbPath})`);
});
