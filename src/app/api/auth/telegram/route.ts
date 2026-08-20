import { z } from "zod";
import { prisma } from "@/server/db/prisma";
import { createAdminSession } from "@/server/auth/session";
import { isSameOrigin } from "@/server/http/origin";
import { TelegramLoginError, verifyTelegramLoginPayload } from "@/server/auth/telegram-login";

const schema = z.object({
  id: z.number(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string()
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } },
      { status: 403 }
    );
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Response.json(
      { error: { code: "TELEGRAM_LOGIN_DISABLED", message: "Вход через Telegram недоступен: бот не настроен." } },
      { status: 503 }
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Некорректные данные Telegram." } },
      { status: 400 }
    );
  }

  try {
    verifyTelegramLoginPayload(parsed.data, botToken);
  } catch (error) {
    const message = error instanceof TelegramLoginError ? error.message : "Не удалось проверить данные Telegram.";
    return Response.json({ error: { code: "INVALID_TELEGRAM_LOGIN", message } }, { status: 401 });
  }

  const admin = await prisma.adminUser.findUnique({ where: { telegramUserId: BigInt(parsed.data.id) } });
  if (!admin || !admin.isActive) {
    return Response.json(
      {
        error: {
          code: "TELEGRAM_NOT_LINKED",
          message: "Этот Telegram-аккаунт не привязан ни к одному администратору. Войдите по email и привяжите Telegram в разделе «Система → Аккаунты»."
        }
      },
      { status: 401 }
    );
  }

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() }
  });

  await createAdminSession({
    adminId: admin.id,
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent")
  });

  return Response.json({ data: { id: admin.id, displayName: admin.displayName, role: admin.role } });
}
