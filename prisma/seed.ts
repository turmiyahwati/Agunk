import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Defensive: if .env failed to load (Windows BOM, missing file, etc.) we
// still want the seed to succeed in development. Production should always
// have DATABASE_URL set explicitly.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:./dev.db";
  // eslint-disable-next-line no-console
  console.warn(
    "[seed] DATABASE_URL not set — falling back to file:./dev.db (dev only).",
  );
}

const ServerStatus = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  FULL: "FULL",
  WARNING: "WARNING",
  UNKNOWN: "UNKNOWN",
} as const;

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

  // Demo servers (skipped if any server already exists)
  const existing = await prisma.server.count();
  if (existing === 0) {
    const demos = [
      {
        name: "SG-Premium-01",
        domain: "sg1.example.com",
        country: "SG",
        countryName: "Singapore",
        provider: "DigitalOcean",
        maxSlot: 200,
        activeUsers: 87,
        pingMs: 14,
        speedMbps: 940,
        status: ServerStatus.ONLINE,
        cpuPercent: 32,
        ramPercent: 41,
        sshActive: true,
        xrayActive: true,
        nginxActive: true,
        udpActive: true,
        totalSsh: 120,
        totalXray: 80,
        uptimeSec: 60 * 60 * 72,
      },
      {
        name: "ID-Jakarta-01",
        domain: "jkt1.example.com",
        country: "ID",
        countryName: "Indonesia",
        provider: "BiznetGio",
        maxSlot: 150,
        activeUsers: 142,
        pingMs: 8,
        speedMbps: 800,
        status: ServerStatus.WARNING,
        cpuPercent: 71,
        ramPercent: 65,
        sshActive: true,
        xrayActive: true,
        nginxActive: true,
        udpActive: false,
        totalSsh: 180,
        totalXray: 60,
        uptimeSec: 60 * 60 * 220,
      },
      {
        name: "JP-Tokyo-02",
        domain: "tyo2.example.com",
        country: "JP",
        countryName: "Japan",
        provider: "Vultr",
        maxSlot: 120,
        activeUsers: 0,
        pingMs: 0,
        speedMbps: 0,
        status: ServerStatus.OFFLINE,
      },
      {
        name: "US-NewYork-01",
        domain: "nyc1.example.com",
        country: "US",
        countryName: "United States",
        provider: "Linode",
        maxSlot: 100,
        activeUsers: 100,
        pingMs: 220,
        speedMbps: 500,
        status: ServerStatus.FULL,
        cpuPercent: 88,
        ramPercent: 82,
        sshActive: true,
        xrayActive: true,
        nginxActive: true,
        udpActive: true,
        totalSsh: 90,
        totalXray: 110,
        uptimeSec: 60 * 60 * 50,
      },
    ];
    for (const d of demos) await prisma.server.create({ data: d as any });
  }

  console.log("Seed complete.");
  console.log("Admin login:", email, "/", password);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
