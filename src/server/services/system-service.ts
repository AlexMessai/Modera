import { prisma } from "@/server/db/prisma";
import {
  getTelegramClient,
  TelegramApiError
} from "@/server/telegram/client";

export type SystemCheckStatus = "ok" | "warning" | "error" | "not_configured";

function elapsedMs(start: number) {
  return Math.max(0, Date.now() - start);
}

function expectedWebhookUrl() {
  return process.env.TELEGRAM_WEBHOOK_URL?.trim() || null;
}

function safeAppUrl() {
  return process.env.APP_URL?.trim() || null;
}

export async function getSystemDiagnostics() {
  const checkedAt = new Date();

  const database = {
    status: "error" as SystemCheckStatus,
    latencyMs: null as number | null,
    error: null as string | null
  };

  const telegram = {
    status: process.env.TELEGRAM_BOT_TOKEN
      ? ("error" as SystemCheckStatus)
      : ("not_configured" as SystemCheckStatus),
    latencyMs: null as number | null,
    botId: null as string | null,
    username: null as string | null,
    firstName: null as string | null,
    error: null as string | null
  };

  const webhook = {
    status: process.env.TELEGRAM_BOT_TOKEN
      ? ("error" as SystemCheckStatus)
      : ("not_configured" as SystemCheckStatus),
    url: null as string | null,
    expectedUrl: expectedWebhookUrl(),
    urlMatchesExpected: null as boolean | null,
    pendingUpdateCount: null as number | null,
    lastErrorAt: null as string | null,
    lastErrorMessage: null as string | null,
    error: null as string | null
  };

  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    database.status = "ok";
    database.latencyMs = elapsedMs(dbStart);
  } catch (error) {
    database.latencyMs = elapsedMs(dbStart);
    database.error = error instanceof Error ? error.message.slice(0, 300) : "PostgreSQL недоступен";
  }

  if (process.env.TELEGRAM_BOT_TOKEN) {
    const telegramStart = Date.now();
    try {
      const client = getTelegramClient();
      const [profile, info] = await Promise.all([
        client.getMe(),
        client.getWebhookInfo()
      ]);

      telegram.status = "ok";
      telegram.latencyMs = elapsedMs(telegramStart);
      telegram.botId = String(profile.id);
      telegram.username = profile.username ?? null;
      telegram.firstName = profile.first_name;

      webhook.url = info.url || null;
      webhook.pendingUpdateCount = info.pending_update_count;
      webhook.lastErrorAt = info.last_error_date
        ? new Date(info.last_error_date * 1000).toISOString()
        : null;
      webhook.lastErrorMessage = info.last_error_message ?? null;
      webhook.urlMatchesExpected = webhook.expectedUrl
        ? info.url === webhook.expectedUrl
        : null;

      if (!info.url) {
        webhook.status = "error";
        webhook.error = "Webhook в Telegram не зарегистрирован.";
      } else if (webhook.urlMatchesExpected === false) {
        webhook.status = "error";
        webhook.error = "Telegram webhook указывает на другой URL.";
      } else if (info.pending_update_count >= 100) {
        webhook.status = "warning";
        webhook.error = "Очередь Telegram updates заметно выросла.";
      } else {
        webhook.status = "ok";
      }
    } catch (error) {
      telegram.latencyMs = elapsedMs(telegramStart);
      telegram.error =
        error instanceof TelegramApiError || error instanceof Error
          ? error.message.slice(0, 300)
          : "Telegram API недоступен";
      webhook.error = "Не удалось получить getWebhookInfo.";
    }
  }

  let application = {
    chats: 0,
    activeBotLinks: 0,
    problematicBotLinks: 0,
    pendingModerationActions: 0,
    failedModerationActions24h: 0,
    automodDeleteErrors24h: 0,
    messages24h: 0
  };

  let problemChats: Array<{
    id: string;
    title: string;
    telegramChatId: string;
    status: string;
    lastError: string | null;
    updatedAt: string;
  }> = [];

  let recentErrors: Array<{
    id: string;
    action: string;
    reason: string | null;
    createdAt: string;
    chat: { id: string; title: string } | null;
    affectedUser: { id: string; displayName: string } | null;
  }> = [];

  if (database.status === "ok") {
    const since24h = new Date(checkedAt.getTime() - 24 * 60 * 60 * 1000);
    const problemStatuses = [
      "NOT_ADMIN",
      "INSUFFICIENT_PERMISSIONS",
      "REMOVED",
      "DISABLED",
      "TELEGRAM_ERROR"
    ] as const;

    try {
      const [
        chats,
        activeBotLinks,
        problematicBotLinks,
        pendingModerationActions,
        failedModerationActions24h,
        automodDeleteErrors24h,
        messages24h,
        problemRows,
        errorRows
      ] = await prisma.$transaction([
        prisma.chat.count(),
        prisma.botChat.count({ where: { status: "ACTIVE" } }),
        prisma.botChat.count({ where: { status: { in: [...problemStatuses] } } }),
        prisma.moderationAction.count({ where: { status: "PENDING" } }),
        prisma.moderationAction.count({
          where: { status: "FAILED", createdAt: { gte: since24h } }
        }),
        prisma.auditLog.count({
          where: {
            action: { in: ["AUTOMOD_DELETE_FAILED", "AUTOMOD_ESCALATION_FAILED"] },
            createdAt: { gte: since24h }
          }
        }),
        prisma.message.count({ where: { telegramDate: { gte: since24h } } }),
        prisma.botChat.findMany({
          where: { status: { in: [...problemStatuses] } },
          orderBy: { updatedAt: "desc" },
          take: 20,
          include: {
            chat: { select: { id: true, title: true, telegramChatId: true } }
          }
        }),
        prisma.auditLog.findMany({
          where: {
            action: {
              in: [
                "MODERATION_ACTION_FAILED",
                "AUTOMOD_DELETE_FAILED",
                "AUTOMOD_ESCALATION_FAILED",
                "MANUAL_MESSAGE_DELETE_FAILED"
              ]
            },
            createdAt: { gte: since24h }
          },
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            chat: { select: { id: true, title: true } },
            affectedUser: { select: { id: true, displayName: true } }
          }
        })
      ]);

      application = {
        chats,
        activeBotLinks,
        problematicBotLinks,
        pendingModerationActions,
        failedModerationActions24h,
        automodDeleteErrors24h,
        messages24h
      };
      problemChats = problemRows.map((row) => ({
        id: row.chat.id,
        title: row.chat.title,
        telegramChatId: row.chat.telegramChatId.toString(),
        status: row.status,
        lastError: row.lastError,
        updatedAt: row.updatedAt.toISOString()
      }));
      recentErrors = errorRows.map((row) => ({
        id: row.id,
        action: row.action,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
        chat: row.chat,
        affectedUser: row.affectedUser
      }));
    } catch (error) {
      database.status = "warning";
      database.error =
        error instanceof Error
          ? `База отвечает, но диагностика завершилась ошибкой: ${error.message.slice(0, 240)}`
          : "База отвечает, но диагностика завершилась ошибкой.";
    }
  }

  return {
    checkedAt: checkedAt.toISOString(),
    checks: {
      database,
      telegram,
      webhook
    },
    application,
    configuration: {
      appUrlConfigured: Boolean(process.env.APP_URL),
      appUrl: safeAppUrl(),
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      telegramBotTokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      telegramWebhookSecretConfigured: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
      telegramWebhookUrlConfigured: Boolean(process.env.TELEGRAM_WEBHOOK_URL),
      adminEmailConfigured: Boolean(process.env.ADMIN_EMAIL),
      adminPasswordConfigured: Boolean(process.env.ADMIN_PASSWORD),
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      nodeEnv: process.env.NODE_ENV ?? "unknown"
    },
    problemChats,
    recentErrors
  };
}