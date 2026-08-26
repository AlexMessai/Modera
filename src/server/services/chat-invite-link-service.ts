import { prisma } from "@/server/db/prisma";
import { getTelegramClient } from "@/server/telegram/client";
import type { ChatInviteLink } from "@/generated/prisma/client";

export const MAX_INVITE_LINKS_PER_CHAT = 30;

export class ChatInviteLinkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus = 400
  ) {
    super(message);
    this.name = "ChatInviteLinkError";
  }
}

export type ChatInviteLinkValue = {
  id: string;
  telegramInviteLink: string;
  name: string | null;
  memberLimit: number | null;
  expiresAt: string | null;
  createsJoinRequest: boolean;
  isRevoked: boolean;
  isExpired: boolean;
  isActive: boolean;
  joinedCount: number;
  leftCount: number;
  remaining: number | null;
  createdAt: string;
};

function serialize(link: ChatInviteLink): ChatInviteLinkValue {
  const isExpired = link.expiresAt !== null && link.expiresAt.getTime() <= Date.now();
  const isFull = link.memberLimit !== null && link.joinedCount >= link.memberLimit;
  return {
    id: link.id,
    telegramInviteLink: link.telegramInviteLink,
    name: link.name,
    memberLimit: link.memberLimit,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    createsJoinRequest: link.createsJoinRequest,
    isRevoked: link.isRevoked,
    isExpired,
    isActive: !link.isRevoked && !isExpired && !isFull,
    joinedCount: link.joinedCount,
    leftCount: link.leftCount,
    remaining: link.memberLimit !== null ? Math.max(0, link.memberLimit - link.joinedCount) : null,
    createdAt: link.createdAt.toISOString()
  };
}

export async function listChatInviteLinks(chatId: string): Promise<ChatInviteLinkValue[]> {
  const links = await prisma.chatInviteLink.findMany({ where: { chatId }, orderBy: { createdAt: "desc" } });
  return links.map(serialize);
}

function normalizeName(value: string | undefined) {
  const trimmed = (value ?? "").trim().slice(0, 32);
  return trimmed || null;
}

function toExpireDateSeconds(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new ChatInviteLinkError("INVALID_DATE", "Некорректная дата.", 422);
  }
  if (date.getTime() <= Date.now()) {
    throw new ChatInviteLinkError("DATE_IN_PAST", "Дата окончания действия должна быть в будущем.", 422);
  }
  return Math.floor(date.getTime() / 1000);
}

export async function createChatInviteLink(input: {
  chatId: string;
  actingAdminId: string;
  name?: string;
  memberLimit?: number | null;
  expiresAt?: string | null;
  createsJoinRequest: boolean;
}): Promise<ChatInviteLinkValue> {
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true, telegramChatId: true } });
  if (!chat) throw new ChatInviteLinkError("CHAT_NOT_FOUND", "Чат не найден.", 404);

  const count = await prisma.chatInviteLink.count({ where: { chatId: input.chatId } });
  if (count >= MAX_INVITE_LINKS_PER_CHAT) {
    throw new ChatInviteLinkError("LIMIT_REACHED", `Достигнут лимит ссылок на чат (${MAX_INVITE_LINKS_PER_CHAT}).`, 422);
  }

  const name = normalizeName(input.name);
  const expireDate = toExpireDateSeconds(input.expiresAt);

  let created;
  try {
    created = await getTelegramClient().createChatInviteLink({
      chatId: Number(chat.telegramChatId),
      name: name ?? undefined,
      expireDate,
      memberLimit: input.memberLimit ?? undefined,
      createsJoinRequest: input.createsJoinRequest
    });
  } catch (error) {
    throw new ChatInviteLinkError("TELEGRAM_ERROR", error instanceof Error ? error.message : "Не удалось создать ссылку в Telegram.", 502);
  }

  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.chatInviteLink.create({
      data: {
        chatId: input.chatId,
        telegramInviteLink: created.invite_link,
        name,
        memberLimit: created.member_limit ?? null,
        expiresAt: created.expire_date ? new Date(created.expire_date * 1000) : null,
        createsJoinRequest: created.creates_join_request,
        createdByAdminId: input.actingAdminId
      }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CHAT_INVITE_LINK_CREATED",
        metadata: { inviteLinkId: row.id, name: row.name }
      }
    });
    return row;
  });

  return serialize(saved);
}

export async function updateChatInviteLink(input: {
  chatId: string;
  linkId: string;
  actingAdminId: string;
  name?: string;
  memberLimit?: number | null;
  expiresAt?: string | null;
  createsJoinRequest: boolean;
}): Promise<ChatInviteLinkValue> {
  const existing = await prisma.chatInviteLink.findUnique({
    where: { id: input.linkId },
    include: { chat: { select: { telegramChatId: true } } }
  });
  if (!existing || existing.chatId !== input.chatId) {
    throw new ChatInviteLinkError("LINK_NOT_FOUND", "Ссылка не найдена в этом чате.", 404);
  }
  if (existing.isRevoked) {
    throw new ChatInviteLinkError("LINK_REVOKED", "Ссылка уже отозвана, изменить её нельзя.", 422);
  }

  const name = normalizeName(input.name);
  const expireDate = toExpireDateSeconds(input.expiresAt);

  let edited;
  try {
    edited = await getTelegramClient().editChatInviteLink({
      chatId: Number(existing.chat.telegramChatId),
      inviteLink: existing.telegramInviteLink,
      name: name ?? "",
      expireDate,
      memberLimit: input.memberLimit ?? undefined,
      createsJoinRequest: input.createsJoinRequest
    });
  } catch (error) {
    throw new ChatInviteLinkError("TELEGRAM_ERROR", error instanceof Error ? error.message : "Не удалось изменить ссылку в Telegram.", 502);
  }

  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.chatInviteLink.update({
      where: { id: input.linkId },
      data: {
        name,
        memberLimit: edited.member_limit ?? null,
        expiresAt: edited.expire_date ? new Date(edited.expire_date * 1000) : null,
        createsJoinRequest: edited.creates_join_request
      }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CHAT_INVITE_LINK_UPDATED",
        metadata: { inviteLinkId: row.id, name: row.name }
      }
    });
    return row;
  });

  return serialize(saved);
}

/**
 * Telegram has no hard "delete" for invite links, only revoke -- this
 * revokes on Telegram (permanent, can never be un-revoked) and then removes
 * our row entirely, since the panel's "Удалить" action is meant to make the
 * link gone, not kept around as inactive history.
 */
export async function deleteChatInviteLink(input: { chatId: string; linkId: string; actingAdminId: string }) {
  const existing = await prisma.chatInviteLink.findUnique({
    where: { id: input.linkId },
    include: { chat: { select: { telegramChatId: true } } }
  });
  if (!existing || existing.chatId !== input.chatId) {
    throw new ChatInviteLinkError("LINK_NOT_FOUND", "Ссылка не найдена в этом чате.", 404);
  }

  if (!existing.isRevoked) {
    try {
      await getTelegramClient().revokeChatInviteLink(Number(existing.chat.telegramChatId), existing.telegramInviteLink);
    } catch (error) {
      throw new ChatInviteLinkError("TELEGRAM_ERROR", error instanceof Error ? error.message : "Не удалось отозвать ссылку в Telegram.", 502);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.chatInviteLink.delete({ where: { id: input.linkId } });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "CHAT_INVITE_LINK_REVOKED",
        metadata: { inviteLinkId: input.linkId, telegramInviteLink: existing.telegramInviteLink }
      }
    });
  });
}

/** Best-effort, called from update-handler.ts on a tracked join -- never blocks the underlying membership sync. */
export async function recordInviteLinkJoin(input: { chatId: string; telegramInviteLink: string; membershipId: string }) {
  try {
    const link = await prisma.chatInviteLink.findUnique({
      where: { telegramInviteLink: input.telegramInviteLink },
      select: { id: true, chatId: true }
    });
    if (!link || link.chatId !== input.chatId) return;

    await prisma.$transaction([
      prisma.chatInviteLink.update({ where: { id: link.id }, data: { joinedCount: { increment: 1 } } }),
      prisma.chatMember.update({ where: { id: input.membershipId }, data: { joinedViaInviteLinkId: link.id } })
    ]);
  } catch {
    // Best-effort: stats tracking must never block the real membership sync.
  }
}

/**
 * Best-effort, called from update-handler.ts when a tracked member leaves.
 * Clears joinedViaInviteLinkId after counting so a later organic leave
 * (no fresh tracked join in between) is never double-counted.
 */
export async function recordInviteLinkLeft(membershipId: string) {
  try {
    const member = await prisma.chatMember.findUnique({
      where: { id: membershipId },
      select: { joinedViaInviteLinkId: true }
    });
    if (!member?.joinedViaInviteLinkId) return;

    await prisma.$transaction([
      prisma.chatInviteLink.update({ where: { id: member.joinedViaInviteLinkId }, data: { leftCount: { increment: 1 } } }),
      prisma.chatMember.update({ where: { id: membershipId }, data: { joinedViaInviteLinkId: null } })
    ]);
  } catch {
    // Best-effort: stats tracking must never block the real membership sync.
  }
}
