import { PrismaNeonHttp } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (process.env.DATABASE_ADAPTER === "neon-http") {
    const adapter = new PrismaNeonHttp(connectionString, {});
    return new PrismaClient({ adapter });
  }

  // Neon's direct (non-pooled) connection has a low concurrent-connection ceiling, and
  // node-postgres's default Pool max (10) per serverless instance blows past it once
  // several instances are warm at once -- capped low here to stay well under that limit
  // rather than the app failing outright with "too many database connections opened".
  const adapter = new PrismaPg({ connectionString, max: 3 });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
