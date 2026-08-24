import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import {
  getTelegramBotProfile,
  getTelegramClient,
  TelegramApiError,
  type TelegramClient
} from "@/server/telegram/client";
import { extractBotPermissions } from "@/server/telegram/status";

type MemberTagClient = Pick<
  TelegramClient,
  "getChatMember" | "setChatMemberTag"
>;

const MEMBER_TAG_EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u200D\uFE0F\u20E3]/u;

export class MemberTagError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "MemberTagError";
  }
}

export function normalizeMemberTag(value: string | null) {
  const tag = value?.trim() || null;
  if (!tag) return null;

  if (Array.from(tag).length > 16) {
    throw new MemberTagError(
      "TAG_TOO_LONG",
      "Telegram-тег должен содержать не более 16 символов.",
      400
    );
  }
  if (MEMBER_TAG_EMOJI.test(tag)) {
    throw new MemberTagError(
      "TAG_EMOJI_NOT_ALLOWED",
      "Telegram не разрешает эмодзи в тегах участников.",
      400
    );
  }

  return tag;
}

export async function getMemberTagState(membershipId: string) {
  const membership = await prisma.chatMember.findUnique({
    where: { id: membershipId },
    select: {
      id: true,
      chatId: true,
      status: true,
      telegramCustomTitle: true,
      memberTag: { select: { tag: true, updatedAt: true } }
    }
  });
  if (!membership) return null;

  return {
    membershipId: membership.id,
    chatId: membership.chatId,
    status: membership.status,
    telegramCustomTitle: membership.telegramCustomTitle,
    tag: membership.memberTag?.tag ?? null,
    tagUpdatedAt: membership.memberTag?.updatedAt.toISOString() ?? null,
    editable:
      membership.status === "MEMBER" || membership.status === "RESTRICTED"
  };
}

export async function updateTelegramMemberTag(
  input: {
    membershipId: string;
    actingAdminId: string;
    tag: string | null;
  },
  dependencies: {
    client?: MemberTagClient;
    botTelegramId?: number;
  } = {}
) {
  const tag = normalizeMemberTag(input.tag);
  const membership = await prisma.chatMember.findUnique({
    where: { id: input.membershipId },
    include: {
      memberTag: true,
      chat: {
        select: { id: true, telegramChatId: true, title: true, type: true }
      },
      user: {
        select: { id: true, telegramUserId: true, displayName: true, isBot: true }
      }
    }
  });

  if (!membership) {
    throw new MemberTagError(
      "MEMBER_NOT_FOUND",
      "Участник не найден.",
      404
    );
  }
  if (membership.chat.type !== "group" && membership.chat.type !== "supergroup") {
    throw new MemberTagError(
      "CHAT_TAGS_UNSUPPORTED",
      "Telegram-теги доступны только в группах и супергруппах.",
      409
    );
  }
  if (membership.status !== "MEMBER" && membership.status !== "RESTRICTED") {
    throw new MemberTagError(
      "MEMBER_TAG_UNSUPPORTED",
      "Теги можно изменять только у обычных или ограниченных участников. Для администраторов Telegram использует отдельный title.",
      409
    );
  }

  const client = dependencies.client ?? getTelegramClient();
  const botTelegramId =
    dependencies.botTelegramId ?? (await getTelegramBotProfile()).id;

  try {
    const [botMember, targetMember] = await Promise.all([
      client.getChatMember(Number(membership.chat.telegramChatId), botTelegramId),
      client.getChatMember(
        Number(membership.chat.telegramChatId),
        Number(membership.user.telegramUserId)
      )
    ]);
    const permissions = extractBotPermissions(botMember);
    if (
      (botMember.status !== "administrator" && botMember.status !== "creator") ||
      !permissions.canManageTags
    ) {
      throw new MemberTagError(
        "BOT_TAG_PERMISSION_REQUIRED",
        "У бота нет Telegram-права «Управление тегами» в этом чате.",
        409
      );
    }
    if (targetMember.status !== "member" && targetMember.status !== "restricted") {
      throw new MemberTagError(
        "MEMBER_TAG_UNSUPPORTED",
        "Текущий статус участника в Telegram не позволяет изменить тег.",
        409
      );
    }

    await client.setChatMemberTag({
      chatId: Number(membership.chat.telegramChatId),
      userId: Number(membership.user.telegramUserId),
      tag: tag ?? ""
    });
  } catch (error) {
    const message =
      error instanceof MemberTagError || error instanceof TelegramApiError
        ? error.message
        : "Telegram не выполнил изменение тега.";

    await prisma.auditLog.create({
      data: {
        chatId: membership.chatId,
        affectedUserId: membership.userId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "MEMBER_TAG_UPDATE_FAILED",
        reason: message,
        metadata: {
          previousTag: membership.memberTag?.tag ?? null,
          requestedTag: tag
        }
      }
    });

    if (error instanceof MemberTagError) throw error;
    throw new MemberTagError("TELEGRAM_TAG_UPDATE_FAILED", message, 502);
  }

  const tagMutation = tag
    ? prisma.chatMemberTag.upsert({
        where: { chatMemberId: membership.id },
        create: { chatMemberId: membership.id, tag },
        update: { tag }
      })
    : prisma.chatMemberTag.deleteMany({
        where: { chatMemberId: membership.id }
      });
  const auditMutation = prisma.auditLog.create({
      data: {
        chatId: membership.chatId,
        affectedUserId: membership.userId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: tag ? "MEMBER_TAG_UPDATED" : "MEMBER_TAG_REMOVED",
        metadata: {
          previousTag: membership.memberTag?.tag ?? null,
          tag,
          telegramUserId: membership.user.telegramUserId.toString()
        } as Prisma.InputJsonObject
      }
    });
  const [, audit] = await prisma.$transaction([tagMutation, auditMutation]);

  return {
    membershipId: membership.id,
    tag,
    tagUpdatedAt: new Date().toISOString(),
    auditId: audit.id
  };
}
