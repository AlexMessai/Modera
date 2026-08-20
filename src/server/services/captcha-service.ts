import { prisma } from "@/server/db/prisma";
import { resolveEffectiveCaptchaSettings } from "@/server/services/captcha-settings-service";
import {
  getTelegramClient,
  MUTED_CHAT_PERMISSIONS,
  TelegramApiError,
  UNRESTRICTED_CHAT_PERMISSIONS
} from "@/server/telegram/client";

export const CAPTCHA_PUNISHMENT_STATE = "CAPTCHA_PENDING";
const CALLBACK_DATA_PREFIX = "captcha:";

export function captchaCallbackData(telegramUserId: bigint | number) {
  return `${CALLBACK_DATA_PREFIX}${telegramUserId}`;
}

export function parseCaptchaCallbackData(data: string) {
  if (!data.startsWith(CALLBACK_DATA_PREFIX)) return null;
  const raw = data.slice(CALLBACK_DATA_PREFIX.length);
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export async function issueCaptchaChallenge(input: {
  chatId: string;
  membershipId: string;
  userId: string;
  telegramChatId: bigint;
  telegramUserId: bigint;
  displayName: string;
  timeoutMinutes: number;
}) {
  try {
    await getTelegramClient().restrictChatMember({
      chatId: Number(input.telegramChatId),
      userId: Number(input.telegramUserId),
      permissions: MUTED_CHAT_PERMISSIONS
    });
  } catch (error) {
    console.warn("[captcha] failed to restrict new member", {
      chatId: input.chatId,
      telegramUserId: input.telegramUserId.toString(),
      error: error instanceof Error ? error.message.slice(0, 300) : "Unknown Telegram error"
    });
    return { outcome: "restrict_failed" as const };
  }

  const expiresAt = new Date(Date.now() + input.timeoutMinutes * 60_000);
  try {
    await prisma.chatMember.update({
      where: { id: input.membershipId },
      data: {
        status: "RESTRICTED",
        punishmentState: CAPTCHA_PUNISHMENT_STATE,
        punishmentExpiresAt: expiresAt,
        lastModerationAt: new Date()
      }
    });
  } catch (error) {
    console.warn("[captcha] restricted member on Telegram but failed to persist pending state", {
      chatId: input.chatId,
      telegramUserId: input.telegramUserId.toString(),
      error: error instanceof Error ? error.message.slice(0, 300) : "Unknown database error"
    });
    return { outcome: "persist_failed" as const };
  }

  try {
    await getTelegramClient().sendMessage({
      chatId: Number(input.telegramChatId),
      text: `${input.displayName}, подтвердите, что вы не бот — нажмите кнопку ниже в течение ${input.timeoutMinutes} мин., иначе вы будете исключены из чата.`,
      replyMarkup: {
        inline_keyboard: [[{ text: "✅ Я не бот", callback_data: captchaCallbackData(input.telegramUserId) }]]
      }
    });
  } catch (error) {
    console.warn("[captcha] failed to send challenge message", {
      chatId: input.chatId,
      telegramUserId: input.telegramUserId.toString(),
      error: error instanceof Error ? error.message.slice(0, 300) : "Unknown Telegram error"
    });
  }

  await prisma.auditLog.create({
    data: {
      chatId: input.chatId,
      affectedUserId: input.userId,
      source: "SYSTEM",
      action: "CAPTCHA_CHALLENGE_SENT",
      metadata: { timeoutMinutes: input.timeoutMinutes, expiresAt: expiresAt.toISOString() }
    }
  });

  return { outcome: "issued" as const, expiresAt };
}

export async function maybeIssueCaptchaChallenge(input: {
  chatId: string;
  chatType: string;
  membershipId: string;
  userId: string;
  telegramChatId: bigint;
  telegramUserId: bigint;
  displayName: string;
}) {
  if (input.chatType !== "supergroup") return { outcome: "skipped_chat_type" as const };
  const profile = await resolveEffectiveCaptchaSettings(input.chatId);
  if (!profile.settings.enabled) return { outcome: "disabled" as const };

  const current = await prisma.chatMember.findUnique({
    where: { id: input.membershipId },
    select: { punishmentState: true }
  });
  if (
    current?.punishmentState === "MUTED" ||
    current?.punishmentState === "BANNED" ||
    current?.punishmentState === CAPTCHA_PUNISHMENT_STATE
  ) {
    return { outcome: "already_restricted" as const };
  }

  return issueCaptchaChallenge({
    chatId: input.chatId,
    membershipId: input.membershipId,
    userId: input.userId,
    telegramChatId: input.telegramChatId,
    telegramUserId: input.telegramUserId,
    displayName: input.displayName,
    timeoutMinutes: profile.settings.timeoutMinutes
  });
}

export async function verifyCaptchaChallenge(input: {
  chatId: string;
  telegramChatId: bigint;
  fromTelegramUserId: number;
  targetTelegramUserId: number;
}) {
  if (input.fromTelegramUserId !== input.targetTelegramUserId) {
    return { outcome: "wrong_user" as const };
  }

  const user = await prisma.telegramUser.findUnique({
    where: { telegramUserId: BigInt(input.targetTelegramUserId) },
    select: { id: true }
  });
  if (!user) return { outcome: "not_found" as const };

  const membership = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId: input.chatId, userId: user.id } }
  });
  if (!membership || membership.punishmentState !== CAPTCHA_PUNISHMENT_STATE) {
    return { outcome: "not_pending" as const };
  }

  try {
    await getTelegramClient().restrictChatMember({
      chatId: Number(input.telegramChatId),
      userId: input.targetTelegramUserId,
      permissions: UNRESTRICTED_CHAT_PERMISSIONS
    });
  } catch (error) {
    console.warn("[captcha] failed to lift restriction after verification", {
      chatId: input.chatId,
      telegramUserId: input.targetTelegramUserId,
      error: error instanceof TelegramApiError ? error.message : "Unknown Telegram error"
    });
    return { outcome: "telegram_error" as const };
  }

  const now = new Date();
  try {
    await prisma.$transaction([
      prisma.chatMember.update({
        where: { id: membership.id },
        data: { status: "MEMBER", punishmentState: null, punishmentExpiresAt: null, lastModerationAt: now }
      }),
      prisma.auditLog.create({
        data: {
          chatId: input.chatId,
          affectedUserId: user.id,
          source: "SYSTEM",
          action: "CAPTCHA_PASSED",
          metadata: {}
        }
      })
    ]);
  } catch (error) {
    console.warn("[captcha] lifted restriction on Telegram but failed to clear pending state", {
      chatId: input.chatId,
      telegramUserId: input.targetTelegramUserId,
      error: error instanceof Error ? error.message.slice(0, 300) : "Unknown database error"
    });
    return { outcome: "db_error" as const };
  }

  return { outcome: "verified" as const };
}

export async function processExpiredCaptchaChallenges(input?: { now?: Date; limit?: number }) {
  const now = input?.now ?? new Date();
  const limit = Math.min(100, Math.max(1, input?.limit ?? 25));
  const candidates = await prisma.chatMember.findMany({
    where: {
      punishmentState: CAPTCHA_PUNISHMENT_STATE,
      punishmentExpiresAt: { lte: now }
    },
    orderBy: { punishmentExpiresAt: "asc" },
    take: limit,
    include: { chat: true, user: true }
  });

  let kicked = 0;
  let banned = 0;
  let failed = 0;

  for (const member of candidates) {
    try {
      const client = getTelegramClient();
      const profile = await resolveEffectiveCaptchaSettings(member.chatId);
      const chatTelegramId = Number(member.chat.telegramChatId);
      const userTelegramId = Number(member.user.telegramUserId);
      const nextStatus = profile.settings.failAction === "BAN" ? "BANNED" : "LEFT";
      const auditAction = profile.settings.failAction === "BAN" ? "CAPTCHA_TIMEOUT_BAN" : "CAPTCHA_TIMEOUT_KICK";

      await client.banChatMember({ chatId: chatTelegramId, userId: userTelegramId, revokeMessages: false });
      if (profile.settings.failAction === "KICK") {
        await client.unbanChatMember({ chatId: chatTelegramId, userId: userTelegramId, onlyIfBanned: true });
      }

      await prisma.$transaction([
        prisma.chatMember.update({
          where: { id: member.id },
          data: {
            status: nextStatus,
            punishmentState: profile.settings.failAction === "BAN" ? "BANNED" : null,
            punishmentExpiresAt: null,
            leftAt: now,
            lastModerationAt: now
          }
        }),
        prisma.auditLog.create({
          data: {
            chatId: member.chatId,
            affectedUserId: member.userId,
            source: "SYSTEM",
            action: auditAction,
            metadata: {}
          }
        })
      ]);

      if (profile.settings.failAction === "BAN") banned += 1;
      else kicked += 1;
    } catch {
      failed += 1;
    }
  }

  return { checked: candidates.length, kicked, banned, failed, hasMore: candidates.length === limit };
}
