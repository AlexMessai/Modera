import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/http/origin";
import { prisma } from "@/server/db/prisma";
import { TelegramLoginError, verifyTelegramLoginPayload } from "@/server/auth/telegram-login";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.number(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.number(),
  hash: z.string()
});

function serialize(admin: { telegramUserId: bigint | null; telegramUsername: string | null; telegramFirstName: string | null }) {
  return {
    telegramUserId: admin.telegramUserId?.toString() ?? null,
    telegramUsername: admin.telegramUsername,
    telegramFirstName: admin.telegramFirstName
  };
}

// Self-service: any logged-in admin links/unlinks their OWN Telegram account
// here, regardless of role — this isn't the OWNER-only admin-management API.
export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return Response.json(
      { error: { code: "TELEGRAM_LOGIN_DISABLED", message: "Привязка Telegram недоступна: бот не настроен." } },
      { status: 503 }
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Некорректные данные Telegram." } }, { status: 400 });
  }

  try {
    verifyTelegramLoginPayload(parsed.data, botToken);
  } catch (error) {
    const message = error instanceof TelegramLoginError ? error.message : "Не удалось проверить данные Telegram.";
    return Response.json({ error: { code: "INVALID_TELEGRAM_LOGIN", message } }, { status: 401 });
  }

  const telegramUserId = BigInt(parsed.data.id);
  const owner = await prisma.adminUser.findUnique({ where: { telegramUserId }, select: { id: true } });
  if (owner && owner.id !== auth.admin.id) {
    return Response.json(
      { error: { code: "TELEGRAM_ALREADY_LINKED", message: "Этот Telegram-аккаунт уже привязан к другому администратору." } },
      { status: 409 }
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const admin = await tx.adminUser.update({
      where: { id: auth.admin.id },
      data: {
        telegramUserId,
        telegramUsername: parsed.data.username ?? null,
        telegramFirstName: parsed.data.first_name
      }
    });
    await tx.auditLog.create({
      data: {
        actingAdminId: auth.admin.id,
        source: "ADMIN",
        action: "ADMIN_TELEGRAM_LINKED",
        metadata: { telegramUserId: telegramUserId.toString(), telegramUsername: admin.telegramUsername }
      }
    });
    return admin;
  });

  return Response.json({ data: serialize(updated) });
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const updated = await prisma.$transaction(async (tx) => {
    const admin = await tx.adminUser.update({
      where: { id: auth.admin.id },
      data: { telegramUserId: null, telegramUsername: null, telegramFirstName: null }
    });
    await tx.auditLog.create({
      data: { actingAdminId: auth.admin.id, source: "ADMIN", action: "ADMIN_TELEGRAM_UNLINKED" }
    });
    return admin;
  });

  return Response.json({ data: serialize(updated) });
}
