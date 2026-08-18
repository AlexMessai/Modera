import { prisma } from "@/server/db/prisma";
import { getTelegramClient } from "@/server/telegram/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    backend: "ok" as "ok" | "error" | "not_configured",
    database: "error" as "ok" | "error" | "not_configured",
    telegram: "not_configured" as "ok" | "error" | "not_configured"
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      await getTelegramClient().getMe();
      checks.telegram = "ok";
    } catch {
      checks.telegram = "error";
    }
  }

  const healthy =
    checks.backend === "ok" &&
    checks.database === "ok" &&
    checks.telegram === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      timestamp: new Date().toISOString()
    },
    { status: healthy ? 200 : 503 }
  );
}
