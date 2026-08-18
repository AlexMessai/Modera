import { prisma } from "@/server/db/prisma";
import { getTelegramClient } from "@/server/telegram/client";
import { resolveTelegramWebhookUrl } from "@/server/telegram/webhook-url";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = {
    backend: "ok" as "ok" | "error" | "not_configured",
    database: "error" as "ok" | "error" | "not_configured",
    telegram: "not_configured" as "ok" | "error" | "not_configured",
    webhook: "not_configured" as "ok" | "error" | "not_configured"
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      const client = getTelegramClient();
      const [bot, info] = await Promise.all([
        client.getMe(),
        client.getWebhookInfo()
      ]);
      checks.telegram = bot.id ? "ok" : "error";

      const expectedUrl = resolveTelegramWebhookUrl();
      if (!expectedUrl) {
        checks.webhook = "not_configured";
      } else {
        checks.webhook = info.url === expectedUrl ? "ok" : "error";
      }
    } catch {
      checks.telegram = "error";
      if (process.env.TELEGRAM_WEBHOOK_URL) checks.webhook = "error";
    }
  }

  const healthy =
    checks.backend === "ok" &&
    checks.database === "ok" &&
    checks.telegram === "ok" &&
    checks.webhook === "ok";

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      checks,
      timestamp: new Date().toISOString()
    },
    { status: healthy ? 200 : 503 }
  );
}
