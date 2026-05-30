import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Production-grade seed: creates the admin user only.
 *
 * The previous version of this script also inserted four demo servers
 * (SG-Premium-01, ID-Jakarta-01, JP-Tokyo-02, US-NewYork-01) and 16
 * randomized activity-log entries. Both were removed because:
 *
 *  - Demo servers showed fake values (e.g. "speedMbps: 940") on the
 *    public homepage of every fresh deployment, confusing operators
 *    into thinking the dashboard had real data when it didn't.
 *  - Demo activity rows generated synthetic "VLESS · JP-Tokyo-02 · 5
 *    menit lalu" entries that misled visitors about real-time usage.
 *
 * Operators add real servers via the admin UI after the first deploy.
 * Real activity rows are inserted by external API integrations (the
 * VPN reseller backend posts to /api/activity when a customer buys).
 */
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:./dev.db";
  // eslint-disable-next-line no-console
  console.warn(
    "[seed] DATABASE_URL not set — falling back to file:./dev.db (dev only).",
  );
}

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || "admin@sontoloyo.local";
  const password = process.env.ADMIN_PASSWORD || "admin123";
  const name = process.env.ADMIN_NAME || "Super Admin";
  const hash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: { password: hash, name, active: true },
    create: { email, password: hash, name, active: true },
  });

  console.log("Seed complete.");
  console.log("Admin login:", email, "/", password);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Login at /login with the credentials above");
  console.log("  2. Add your real VPS servers under /admin/servers");
  console.log("  3. Configure each server's 'Public Ping Host' for");
  console.log("     browser-side live ping & speedtest on the public page");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
