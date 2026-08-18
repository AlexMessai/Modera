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
    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.adminUser.upsert({
      where: { email },
      create: {
        email,
        displayName,
        passwordHash,
        role: "OWNER",
        isActive: true
      },
      update: {
        displayName,
        passwordHash,
        role: "OWNER",
        isActive: true
      }
    });

    console.log(`Owner account ready: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed failed");
  process.exit(1);
});
