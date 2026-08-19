import { prisma } from "@/server/db/prisma";
import { executeSelfServiceUnmute, ModerationError } from "@/server/services/moderation-service";

export const MAX_SELF_UNMUTES = 3;

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(value);
}

export async function listActiveMutes(telegramUserId: number) {
  const user = await prisma.telegramUser.findUnique({
    where: { telegramUserId: BigInt(telegramUserId) },
    select: { id: true }
  });
  if (!user) return [];

  return prisma.chatMember.findMany({
    where: { userId: user.id, punishmentState: "MUTED" },
    orderBy: { lastModerationAt: "desc" },
    include: { chat: { select: { id: true, title: true } } }
  });
}

export async function selfUnmute(input: { telegramUserId: number; chatId: string }) {
  const user = await prisma.telegramUser.findUnique({
    where: { telegramUserId: BigInt(input.telegramUserId) },
    select: { id: true }
  });
  if (!user) {
    return { outcome: "not_found" as const, message: "Не удалось найти ваш профиль." };
  }

  const membership = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId: input.chatId, userId: user.id } },
    include: { chat: { select: { title: true } } }
  });
  if (!membership || membership.punishmentState !== "MUTED") {
    return { outcome: "not_muted" as const, message: "Вы не находитесь под ограничением в этом чате." };
  }

  if (membership.selfUnmuteCount >= MAX_SELF_UNMUTES) {
    return {
      outcome: "quota_exhausted" as const,
      message: `Вы уже использовали все ${MAX_SELF_UNMUTES} самостоятельные разблокировки в чате «${membership.chat.title}». Обратитесь к администратору или ответьте /appeal на моё сообщение о наказании, чтобы подать апелляцию.`
    };
  }

  try {
    await executeSelfServiceUnmute({ membershipId: membership.id });
  } catch (error) {
    const detail = error instanceof ModerationError ? error.message : "Не удалось снять ограничение в Telegram.";
    return { outcome: "telegram_error" as const, message: `${detail} Попробуйте позже или обратитесь к администратору.` };
  }

  const updated = await prisma.chatMember.update({
    where: { id: membership.id },
    data: { selfUnmuteCount: { increment: 1 } },
    select: { selfUnmuteCount: true }
  });
  const remaining = Math.max(0, MAX_SELF_UNMUTES - updated.selfUnmuteCount);

  return {
    outcome: "unmuted" as const,
    message: `Вы разблокированы и можете продолжить общение в чате «${membership.chat.title}». Просьба не нарушать правила вновь.\n\nОсталось самостоятельных разблокировок в этом чате: ${remaining}.`
  };
}

export async function getSelfServiceStatusMessage(telegramUserId: number) {
  const user = await prisma.telegramUser.findUnique({
    where: { telegramUserId: BigInt(telegramUserId) },
    select: { id: true, username: true, displayName: true }
  });
  if (!user) {
    return "Вы пока не встречались ни в одном из наших чатов.";
  }

  const [activeMute, lastMuteAction] = await Promise.all([
    prisma.chatMember.findFirst({
      where: { userId: user.id, punishmentState: "MUTED" },
      orderBy: { lastModerationAt: "desc" },
      include: { chat: { select: { id: true, title: true } } }
    }),
    prisma.moderationAction.findFirst({
      where: { affectedUserId: user.id, type: "MUTE", status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      include: {
        chat: { select: { title: true } },
        actingAdmin: { select: { displayName: true } }
      }
    })
  ]);

  const relevantChatId = activeMute?.chatId ?? lastMuteAction?.chatId ?? null;
  let selfUnmuteCount: number | null = null;
  if (relevantChatId) {
    const membership = await prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: relevantChatId, userId: user.id } },
      select: { selfUnmuteCount: true }
    });
    selfUnmuteCount = membership?.selfUnmuteCount ?? 0;
  }

  const lines = [
    `Пользователь: ${user.username ? `@${user.username}` : user.displayName}`,
    `user id: ${telegramUserId}`,
    `Статус: ${
      activeMute
        ? `mute в чате «${activeMute.chat.title}»${activeMute.punishmentExpiresAt ? ` до ${formatDate(activeMute.punishmentExpiresAt)}` : " (без срока)"}`
        : "без ограничений"
    }`
  ];

  if (selfUnmuteCount !== null) {
    lines.push(`Осталось разблоков: ${Math.max(0, MAX_SELF_UNMUTES - selfUnmuteCount)}`);
  }

  if (lastMuteAction) {
    lines.push(
      "",
      "Последний мьют",
      `Причина: ${lastMuteAction.reason ?? "не указана"}`,
      `Чат: ${lastMuteAction.chat.title}`,
      `Админ: ${lastMuteAction.actingAdmin?.displayName ?? "Автомодерация"}`,
      `Дата мьюта: ${formatDate(lastMuteAction.createdAt)}`
    );
  }

  return lines.join("\n");
}
