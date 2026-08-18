import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_NAME?.trim() || "Владелец";

  if (!connectionString) throw new Error("DATABASE_URL is required");
  if (!email) throw new Error("ADMIN_EMAIL is required");
  if (!password || password.length < 12) {
    throw new Error("ADMIN_PASSWORD must contain at least 12 characters");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString })
  });

  try {
    const existing = await prisma.adminUser.findUnique({
      where: { email },
      select: { id: true }
    });

    if (existing) {
      console.log(`Admin bootstrap already initialized: ${email}`);
      return;
    }

    const adminCount = await prisma.adminUser.count();
    if (adminCount > 0) {
      console.log("Admin bootstrap skipped: administrator accounts already exist");
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.adminUser.create({
      data: {
        email,
        displayName,
        passwordHash,
        role: "OWNER",
        isActive: true
      }
    });

    console.log(`Initial owner account created: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed failed");
  process.exit(1);
});
