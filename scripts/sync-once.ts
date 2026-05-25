// One-shot sync runner — usable from cron.
// Usage:  tsx scripts/sync-once.ts
import "dotenv/config";
import { syncAll } from "../src/lib/monitor";

syncAll()
  .then((r) => {
    console.log("sync result:", r);
    process.exit(0);
  })
  .catch((e) => {
    console.error("sync failed:", e);
    process.exit(1);
  });
