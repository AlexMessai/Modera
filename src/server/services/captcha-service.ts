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
  challengeMessageTemplate: string;
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

  // No configurable/expiry window: the member stays muted until they pass
  // the captcha, however long that takes -- processExpiredCaptchaChallenges
  // below sweeps anyone still pending once a day, that's the only deadline.
  try {
    await prisma.chatMember.update({
      where: { id: input.membershipId },
      data: {
        status: "RESTRICTED",
        punishmentState: CAPTCHA_PUNISHMENT_STATE,
        punishmentExpiresAt: null,
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
    // Ephemeral (Bot API 10.2): visible only to this member, not the whole
    // chat -- nobody else sees the challenge or can tap the button.
    const sent = await getTelegramClient().sendMessage({
      chatId: Number(input.telegramChatId),
      receiverUserId: Number(input.telegramUserId),
      text: input.challengeMessageTemplate,
      replyMarkup: {
        inline_keyboard: [[{ text: "✅ Я не бот", callback_data: captchaCallbackData(input.telegramUserId) }]]
      }
    });
    if (sent.ephemeral_message_id === undefined) {
      // Telegram is supposed to always set this for a receiver_user_id send
      // -- if it doesn't, the callback_query handler has nothing to delete
      // later, so this is worth knowing about rather than failing silently.
      console.warn("[captcha] challenge sent without ephemeral_message_id", {
        chatId: input.chatId,
        telegramUserId: input.telegramUserId.toString(),
        messageId: sent.message_id
      });
    }
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
      metadata: {}
    }
  });

  return { outcome: "issued" as const };
}

export async function maybeIssueCaptchaChallenge(input: {
  chatId: string;
  chatType: string;
  membershipId: string;
  userId: string;
  telegramChatId: bigint;
  telegramUserId: bigint;
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
    challengeMessageTemplate: profile.settings.challengeMessageTemplate
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

// Runs once a day (the cron's own schedule, not a per-member duration -- see
// vercel.json) and kicks (never bans) anyone still unverified at that point,
// so they can rejoin and go through the same captcha flow again.
export async function processExpiredCaptchaChallenges(input?: { now?: Date; limit?: number }) {
  const now = input?.now ?? new Date();
  const limit = Math.min(100, Math.max(1, input?.limit ?? 25));
  const candidates = await prisma.chatMember.findMany({
    where: { punishmentState: CAPTCHA_PUNISHMENT_STATE },
    orderBy: { lastModerationAt: "asc" },
    take: limit,
    include: { chat: true, user: true }
  });

  let kicked = 0;
  let failed = 0;

  for (const member of candidates) {
    try {
      const client = getTelegramClient();
      const chatTelegramId = Number(member.chat.telegramChatId);
      const userTelegramId = Number(member.user.telegramUserId);

      await client.banChatMember({ chatId: chatTelegramId, userId: userTelegramId, revokeMessages: false });
      await client.unbanChatMember({ chatId: chatTelegramId, userId: userTelegramId, onlyIfBanned: true });

      await prisma.$transaction([
        prisma.chatMember.update({
          where: { id: member.id },
          data: {
            status: "LEFT",
            punishmentState: null,
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
            action: "CAPTCHA_TIMEOUT_KICK",
            metadata: {}
          }
        })
      ]);

      kicked += 1;
    } catch {
      failed += 1;
    }
  }

  return { checked: candidates.length, kicked, failed, hasMore: candidates.length === limit };
}
