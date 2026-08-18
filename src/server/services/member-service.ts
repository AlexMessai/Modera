import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import type {
  TelegramChatMember,
  TelegramChatMemberUpdated,
  TelegramMessage,
  TelegramUser
} from "@/server/telegram/types";

export const MEMBERSHIP_STATUSES = [
  "CREATOR",
  "ADMINISTRATOR",
  "MEMBER",
  "RESTRICTED",
  "PENDING",
  "LEFT",
  "BANNED",
  "UNKNOWN"
] as const;

export type MembershipStatusValue = (typeof MEMBERSHIP_STATUSES)[number];

const ACTIVE_STATUSES = new Set<MembershipStatusValue>([
  "CREATOR",
  "ADMINISTRATOR",
  "MEMBER",
  "RESTRICTED"
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function eventDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000);
}

function displayName(user: TelegramUser) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (user.username) return `@${user.username}`;
  return `Telegram ${user.id}`;
}

export function isMembershipStatus(value: string): value is MembershipStatusValue {
  return MEMBERSHIP_STATUSES.includes(value as MembershipStatusValue);
}

export function mapTelegramMembershipStatus(status: string): MembershipStatusValue {
  switch (status) {
    case "creator":
      return "CREATOR";
    case "administrator":
      return "ADMINISTRATOR";
    case "member":
      return "MEMBER";
    case "restricted":
      return "RESTRICTED";
    case "left":
      return "LEFT";
    case "kicked":
      return "BANNED";
    default:
      return "UNKNOWN";
  }
}

function observedActiveStatus(current?: MembershipStatusValue | null): MembershipStatusValue {
  if (current === "CREATOR" || current === "ADMINISTRATOR" || current === "RESTRICTED") {
    return current;
  }
  return "MEMBER";
}

function messageType(message: TelegramMessage) {
  if (message.text) return "TEXT";
  if (message.photo) return "PHOTO";
  if (message.video) return "VIDEO";
  if (message.animation) return "ANIMATION";
  if (message.document) return "DOCUMENT";
  if (message.sticker) return "STICKER";
  if (message.voice) return "VOICE";
  if (message.audio) return "AUDIO";
  if (message.video_note) return "VIDEO_NOTE";
  if (message.poll) return "POLL";
  if (message.dice) return "DICE";
  if (message.location) return "LOCATION";
  if (message.contact) return "CONTACT";
  if (message.new_chat_members || message.left_chat_member) return "SERVICE";
  return "OTHER";
}

async function upsertUser(
  tx: Prisma.TransactionClient,
  user: TelegramUser,
  seenAt: Date
) {
  const record = await tx.telegramUser.upsert({
    where: { telegramUserId: BigInt(user.id) },
    create: {
      telegramUserId: BigInt(user.id),
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      displayName: displayName(user),
      isBot: user.is_bot,
      languageCode: user.language_code,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt
    },
    update: {
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      displayName: displayName(user),
      isBot: user.is_bot,
      languageCode: user.language_code
    }
  });

  await tx.telegramUser.updateMany({
    where: { id: record.id, lastSeenAt: { lt: seenAt } },
    data: { lastSeenAt: seenAt }
  });

  return record;
}

async function syncMembership(
  tx: Prisma.TransactionClient,
  input: {
    chatId: string;
    user: TelegramUser;
    seenAt: Date;
    updateId: number;
    status?: MembershipStatusValue;
    auditAction?: string;
  }
) {
  const user = await upsertUser(tx, input.user, input.seenAt);
  const incomingUpdateId = BigInt(input.updateId);
  const existing = await tx.chatMember.findUnique({
    where: {
      chatId_userId: { chatId: input.chatId, userId: user.id }
    },
    select: {
      id: true,
      status: true,
      joinedAt: true,
      lastTelegramUpdateId: true,
      lastModerationAt: true
    }
  });

  const previousStatus = existing?.status as MembershipStatusValue | undefined;
  const staleByUpdateId = Boolean(
    existing?.lastTelegramUpdateId !== null &&
      existing?.lastTelegramUpdateId !== undefined &&
      incomingUpdateId <= existing.lastTelegramUpdateId
  );
  const staleByModeration = Boolean(
    existing?.lastModerationAt && input.seenAt < existing.lastModerationAt
  );
  const isStale = staleByUpdateId || staleByModeration;
  const proposedStatus = input.status ?? observedActiveStatus(previousStatus);
  const nextStatus = isStale && previousStatus ? previousStatus : proposedStatus;
  const becameActive =
    !isStale &&
    ACTIVE_STATUSES.has(nextStatus) &&
    !ACTIVE_STATUSES.has(previousStatus ?? "UNKNOWN");
  const becameInactive =
    !isStale &&
    (nextStatus === "LEFT" || nextStatus === "BANNED" || nextStatus === "PENDING");

  const membership = await tx.chatMember.upsert({
    where: {
      chatId_userId: { chatId: input.chatId, userId: user.id }
    },
    create: {
      chatId: input.chatId,
      userId: user.id,
      status: nextStatus,
      joinedAt: ACTIVE_STATUSES.has(nextStatus) ? input.seenAt : null,
      leftAt: nextStatus === "LEFT" || nextStatus === "BANNED" ? input.seenAt : null,
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
      lastTelegramUpdateId: incomingUpdateId
    },
    update: isStale
      ? {}
      : {
          status: nextStatus,
          joinedAt: becameActive ? input.seenAt : existing?.joinedAt ?? undefined,
          leftAt: becameInactive
            ? nextStatus === "PENDING"
              ? null
              : input.seenAt
            : null,
          lastSeenAt: input.seenAt,
          lastTelegramUpdateId: incomingUpdateId
        }
  });

  if (!isStale && input.auditAction && previousStatus !== nextStatus) {
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: user.id,
        source: "TELEGRAM",
        action: input.auditAction,
        metadata: {
          telegramUserId: String(input.user.id),
          telegramUpdateId: input.updateId,
          previousStatus: previousStatus ?? null,
          status: nextStatus
        }
      }
    });
  }

  return { user, membership, previousStatus, nextStatus, isStale };
}

export async function observeMember(input: {
  chatId: string;
  user: TelegramUser;
  date: number;
  updateId: number;
}) {
  return prisma.$transaction((tx) =>
    syncMembership(tx, {
      chatId: input.chatId,
      user: input.user,
      seenAt: eventDate(input.date),
      updateId: input.updateId
    })
  );
}

export async function syncMemberStatus(input: {
  chatId: string;
  member: TelegramChatMember;
  date: number;
  updateId: number;
}) {
  return prisma.$transaction((tx) =>
    syncMembership(tx, {
      chatId: input.chatId,
      user: input.member.user,
      seenAt: eventDate(input.date),
      updateId: input.updateId,
      status: mapTelegramMembershipStatus(input.member.status),
      auditAction: "MEMBER_STATUS_CHANGED"
    })
  );
}

export async function syncChatMemberUpdate(input: {
  chatId: string;
  update: TelegramChatMemberUpdated;
  updateId: number;
}) {
  const result = await syncMemberStatus({
    chatId: input.chatId,
    member: input.update.new_chat_member,
    date: input.update.date,
    updateId: input.updateId
  });

  if (input.update.from.id !== input.update.new_chat_member.user.id) {
    await observeMember({
      chatId: input.chatId,
      user: input.update.from,
      date: input.update.date,
      updateId: input.updateId
    });
  }

  return result;
}

export async function syncJoinRequest(input: {
  chatId: string;
  user: TelegramUser;
  date: number;
  updateId: number;
}) {
  return prisma.$transaction((tx) =>
    syncMembership(tx, {
      chatId: input.chatId,
      user: input.user,
      seenAt: eventDate(input.date),
      updateId: input.updateId,
      status: "PENDING",
      auditAction: "MEMBER_JOIN_REQUESTED"
    })
  );
}

export async function syncObservedMessage(input: {
  chatId: string;
  message: TelegramMessage;
  isEdited: boolean;
  updateId: number;
}) {
  const seenAt = eventDate(input.message.edit_date ?? input.message.date);
  const messageDate = eventDate(input.message.date);

  return prisma.$transaction(async (tx) => {
    let senderUserId: string | null = null;
    let membershipId: string | null = null;

    if (input.message.from) {
      const synced = await syncMembership(tx, {
        chatId: input.chatId,
        user: input.message.from,
        seenAt,
        updateId: input.updateId
      });
      senderUserId = synced.user.id;
      membershipId = synced.membership.id;
    }

    const inserted = await tx.message.createMany({
      data: [{
        chatId: input.chatId,
        senderUserId,
        telegramMessageId: BigInt(input.message.message_id),
        telegramDate: messageDate,
        editedAt: input.isEdited ? seenAt : null,
        text: input.message.text,
        caption: input.message.caption,
        messageType: messageType(input.message),
        isEdited: input.isEdited
      }],
      skipDuplicates: true
    });

    await tx.message.update({
      where: {
        chatId_telegramMessageId: {
          chatId: input.chatId,
          telegramMessageId: BigInt(input.message.message_id)
        }
      },
      data: {
        senderUserId,
        editedAt: input.isEdited ? seenAt : undefined,
        text: input.message.text,
        caption: input.message.caption,
        messageType: messageType(input.message),
        isEdited: input.isEdited ? true : undefined
      }
    });

    if (inserted.count === 1 && membershipId) {
      await tx.chatMember.update({
        where: { id: membershipId },
        data: { messageCount: { increment: 1 } }
      });
    }

    return { inserted: inserted.count === 1 };
  });
}

export async function syncServiceMemberships(input: {
  chatId: string;
  message: TelegramMessage;
  updateId: number;
  skipTelegramUserId?: number;
}) {
  const jobs: Promise<unknown>[] = [];

  for (const user of input.message.new_chat_members ?? []) {
    if (user.id === input.skipTelegramUserId) continue;
    jobs.push(syncMemberStatus({
      chatId: input.chatId,
      member: { status: "member", user },
      date: input.message.date,
      updateId: input.updateId
    }));
  }

  if (
    input.message.left_chat_member &&
    input.message.left_chat_member.id !== input.skipTelegramUserId
  ) {
    jobs.push(syncMemberStatus({
      chatId: input.chatId,
      member: { status: "left", user: input.message.left_chat_member },
      date: input.message.date,
      updateId: input.updateId
    }));
  }

  await Promise.all(jobs);
}

export async function syncKnownAdministrators(input: {
  chatId: string;
  administrators: TelegramChatMember[];
  date: number;
  updateId: number;
  currentBotTelegramId: number;
}) {
  for (const member of input.administrators) {
    if (member.user.id === input.currentBotTelegramId) continue;
    await syncMemberStatus({
      chatId: input.chatId,
      member,
      date: input.date,
      updateId: input.updateId
    });
  }
}

export async function listMembers(input: {
  page: number;
  pageSize: number;
  search?: string;
  chatId?: string;
  status?: MembershipStatusValue;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const search = input.search?.trim();

  const userWhere: Prisma.TelegramUserWhereInput | undefined = search
    ? {
        OR: [
          { displayName: { contains: search, mode: "insensitive" } },
          { username: { contains: search, mode: "insensitive" } },
          ...(BigIntSafe(search) ? [{ telegramUserId: BigInt(search) }] : [])
        ]
      }
    : undefined;

  const where: Prisma.ChatMemberWhereInput = {
    ...(input.chatId ? { chatId: input.chatId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(userWhere ? { user: userWhere } : {})
  };

  const [total, memberships] = await prisma.$transaction([
    prisma.chatMember.count({ where }),
    prisma.chatMember.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: true,
        chat: {
          select: { id: true, telegramChatId: true, title: true, username: true }
        }
      }
    })
  ]);

  return {
    items: memberships.map((membership) => ({
      id: membership.id,
      status: membership.status,
      internalRole: membership.internalRole,
      joinedAt: membership.joinedAt?.toISOString() ?? null,
      leftAt: membership.leftAt?.toISOString() ?? null,
      firstSeenAt: membership.firstSeenAt.toISOString(),
      lastSeenAt: membership.lastSeenAt.toISOString(),
      messageCount: membership.messageCount,
      warningCount: membership.warningCount,
      punishmentState: membership.punishmentState,
      user: {
        id: membership.user.id,
        telegramUserId: membership.user.telegramUserId.toString(),
        username: membership.user.username,
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
        displayName: membership.user.displayName,
        isBot: membership.user.isBot,
        languageCode: membership.user.languageCode
      },
      chat: {
        id: membership.chat.id,
        telegramChatId: membership.chat.telegramChatId.toString(),
        title: membership.chat.title,
        username: membership.chat.username
      }
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
}

export async function getMemberProfile(membershipId: string) {
  if (!UUID_PATTERN.test(membershipId)) return null;

  const membership = await prisma.chatMember.findUnique({
    where: { id: membershipId },
    include: {
      chat: true,
      user: {
        include: {
          memberships: {
            orderBy: { lastSeenAt: "desc" },
            include: {
              chat: {
                select: { id: true, telegramChatId: true, title: true, username: true }
              }
            }
          }
        }
      }
    }
  });

  if (!membership) return null;

  const auditLogs = await prisma.auditLog.findMany({
    where: { affectedUserId: membership.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      chat: { select: { id: true, title: true } },
      actingAdmin: { select: { displayName: true } }
    }
  });

  return {
    id: membership.id,
    status: membership.status,
    joinedAt: membership.joinedAt,
    leftAt: membership.leftAt,
    firstSeenAt: membership.firstSeenAt,
    lastSeenAt: membership.lastSeenAt,
    messageCount: membership.messageCount,
    warningCount: membership.warningCount,
    punishmentState: membership.punishmentState,
    chat: {
      id: membership.chat.id,
      telegramChatId: membership.chat.telegramChatId.toString(),
      title: membership.chat.title,
      username: membership.chat.username
    },
    user: {
      id: membership.user.id,
      telegramUserId: membership.user.telegramUserId.toString(),
      username: membership.user.username,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      displayName: membership.user.displayName,
      isBot: membership.user.isBot,
      languageCode: membership.user.languageCode,
      firstSeenAt: membership.user.firstSeenAt,
      lastSeenAt: membership.user.lastSeenAt,
      memberships: membership.user.memberships.map((item) => ({
        id: item.id,
        status: item.status,
        lastSeenAt: item.lastSeenAt,
        messageCount: item.messageCount,
        chat: {
          id: item.chat.id,
          telegramChatId: item.chat.telegramChatId.toString(),
          title: item.chat.title,
          username: item.chat.username
        }
      }))
    },
    auditLogs: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      reason: log.reason,
      source: log.source,
      metadata: log.metadata,
      createdAt: log.createdAt,
      chat: log.chat,
      actingAdmin: log.actingAdmin
    }))
  };
}

function BigIntSafe(value: string) {
  return /^-?\d{1,20}$/.test(value);
}
