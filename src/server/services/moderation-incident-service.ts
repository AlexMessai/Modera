import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";
import { deleteStoredMessage } from "@/server/services/message-service";
import { incidentSeverityFor } from "@/server/services/moderation-incident-rules";
import { executeModerationAction } from "@/server/services/moderation-service";

export const INCIDENT_STATUSES = ["NEW", "IN_REVIEW", "RESOLVED", "SKIPPED", "AUTO_RESOLVED"] as const;
export const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const INCIDENT_DECISIONS = ["REVIEW", "SKIP", "FALSE_POSITIVE", "RESOLVE", "DELETE_MESSAGE", "WARNING", "MUTE", "BAN", "UNBAN", "NOTE"] as const;

export type IncidentStatusValue = (typeof INCIDENT_STATUSES)[number];
export type IncidentSeverityValue = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentDecisionValue = (typeof INCIDENT_DECISIONS)[number];

const RULE_REASONS: Record<string, string> = {
  LINK: "Обнаружена запрещённая ссылка",
  TERM: "Обнаружено запрещённое слово или фраза",
  MEDIA: "Отправлен запрещённый тип контента",
  MENTIONS: "Превышен лимит упоминаний",
  DUPLICATE: "Обнаружены повторяющиеся сообщения",
  SPAM: "Обнаружен флуд"
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class IncidentError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus: number) {
    super(message);
    this.name = "IncidentError";
  }
}

export async function recordAutomodIncident(input: {
  chatId: string;
  telegramUserId: number;
  telegramMessageId: string;
  rule: string;
}) {
  const [user, message] = await Promise.all([
    prisma.telegramUser.findUnique({ where: { telegramUserId: BigInt(input.telegramUserId) }, select: { id: true } }),
    prisma.message.findUnique({
      where: { chatId_telegramMessageId: { chatId: input.chatId, telegramMessageId: BigInt(input.telegramMessageId) } },
      select: { id: true }
    })
  ]);
  if (!user || !message) return null;

  const existing = await prisma.moderationIncident.findUnique({
    where: { messageId_rule: { messageId: message.id, rule: input.rule } }
  });
  if (existing) return existing;

  const previousViolationCount = await prisma.moderationIncident.count({
    where: { chatId: input.chatId, affectedUserId: user.id }
  });
  const incident = await prisma.moderationIncident.create({
    data: {
      chatId: input.chatId,
      affectedUserId: user.id,
      messageId: message.id,
      type: "AUTOMOD",
      rule: input.rule,
      severity: incidentSeverityFor(input.rule, previousViolationCount),
      reason: RULE_REASONS[input.rule] ?? "Сработало правило автоматической модерации",
      previousViolationCount,
      metadata: { automodActionApplied: true }
    }
  });
  await prisma.auditLog.create({
    data: {
      chatId: input.chatId,
      affectedUserId: user.id,
      source: "SYSTEM",
      action: "MODERATION_INCIDENT_CREATED",
      reason: incident.reason,
      metadata: { incidentId: incident.id, rule: input.rule, severity: incident.severity }
    }
  });
  return incident;
}

export async function listModerationIncidents(input: {
  page: number;
  pageSize: number;
  status?: IncidentStatusValue;
  severity?: IncidentSeverityValue;
  chatId?: string;
  type?: string;
  search?: string;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(100, Math.max(1, input.pageSize));
  const search = input.search?.trim();
  const where: Prisma.ModerationIncidentWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.chatId && UUID_PATTERN.test(input.chatId) ? { chatId: input.chatId } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(search
      ? {
          OR: [
            { reason: { contains: search, mode: "insensitive" } },
            { affectedUser: { displayName: { contains: search, mode: "insensitive" } } },
            { affectedUser: { username: { contains: search.replace(/^@/, ""), mode: "insensitive" } } },
            { chat: { title: { contains: search, mode: "insensitive" } } }
          ]
        }
      : {})
  };

  const [total, items, chats] = await Promise.all([
    prisma.moderationIncident.count({ where }),
    prisma.moderationIncident.findMany({
      where,
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        chat: { select: { id: true, title: true } },
        affectedUser: { select: { id: true, displayName: true, username: true, telegramUserId: true } },
        message: { select: { id: true, text: true, caption: true, telegramDate: true, deletedAt: true } },
        assignedAdmin: { select: { id: true, displayName: true } }
      }
    }),
    prisma.chat.findMany({ orderBy: { title: "asc" }, take: 200, select: { id: true, title: true } })
  ]);

  return {
    items: items.map((item) => ({
      ...item,
      affectedUser: { ...item.affectedUser, telegramUserId: item.affectedUser.telegramUserId.toString() },
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      reviewedAt: item.reviewedAt?.toISOString() ?? null,
      resolvedAt: item.resolvedAt?.toISOString() ?? null,
      message: item.message ? { ...item.message, telegramDate: item.message.telegramDate.toISOString(), deletedAt: item.message.deletedAt?.toISOString() ?? null } : null
    })),
    chats,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  };
}

export async function getModerationIncident(id: string) {
  if (!UUID_PATTERN.test(id)) throw new IncidentError("NOT_FOUND", "Инцидент не найден.", 404);
  const incident = await prisma.moderationIncident.findUnique({
    where: { id },
    include: {
      chat: { select: { id: true, title: true } },
      affectedUser: { select: { id: true, displayName: true, username: true, telegramUserId: true } },
      message: { select: { id: true, text: true, caption: true, messageType: true, telegramDate: true, deletedAt: true } },
      assignedAdmin: { select: { id: true, displayName: true } },
      resolvedByAdmin: { select: { id: true, displayName: true } }
    }
  });
  if (!incident) throw new IncidentError("NOT_FOUND", "Инцидент не найден.", 404);

  const anchor = incident.message?.telegramDate ?? incident.createdAt;
  const [before, after, previous, membership] = await Promise.all([
    prisma.message.findMany({
      where: { chatId: incident.chatId, telegramDate: { lt: anchor } },
      orderBy: { telegramDate: "desc" }, take: 5,
      include: { sender: { select: { displayName: true, username: true } } }
    }),
    prisma.message.findMany({
      where: { chatId: incident.chatId, telegramDate: { gt: anchor } },
      orderBy: { telegramDate: "asc" }, take: 5,
      include: { sender: { select: { displayName: true, username: true } } }
    }),
    prisma.moderationIncident.findMany({
      where: { chatId: incident.chatId, affectedUserId: incident.affectedUserId, createdAt: { lt: incident.createdAt } },
      orderBy: { createdAt: "desc" }, take: 10,
      select: { id: true, reason: true, severity: true, status: true, createdAt: true }
    }),
    prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId: incident.chatId, userId: incident.affectedUserId } },
      select: { id: true, status: true, warningCount: true, punishmentState: true, punishmentExpiresAt: true }
    })
  ]);

  const serializeMessage = (message: (typeof before)[number]) => ({
    id: message.id,
    text: message.text,
    caption: message.caption,
    messageType: message.messageType,
    telegramDate: message.telegramDate.toISOString(),
    sender: message.sender
  });
  return {
    incident: {
      ...incident,
      affectedUser: { ...incident.affectedUser, telegramUserId: incident.affectedUser.telegramUserId.toString() },
      createdAt: incident.createdAt.toISOString(), updatedAt: incident.updatedAt.toISOString(),
      reviewedAt: incident.reviewedAt?.toISOString() ?? null, resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      message: incident.message ? { ...incident.message, telegramDate: incident.message.telegramDate.toISOString(), deletedAt: incident.message.deletedAt?.toISOString() ?? null } : null
    },
    context: [...before.reverse().map(serializeMessage), ...(incident.message ? [{ ...incident.message, telegramDate: incident.message.telegramDate.toISOString(), deletedAt: incident.message.deletedAt?.toISOString() ?? null, sender: incident.affectedUser, isIncident: true }] : []), ...after.map(serializeMessage)],
    previous: previous.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    membership: membership ? { ...membership, punishmentExpiresAt: membership.punishmentExpiresAt?.toISOString() ?? null } : null
  };
}

export async function decideModerationIncident(input: {
  id: string;
  actingAdminId: string;
  action: IncidentDecisionValue;
  reason?: string;
  note?: string;
  muteDurationMinutes?: number | null;
}) {
  const incident = await prisma.moderationIncident.findUnique({ where: { id: input.id } });
  if (!incident) throw new IncidentError("NOT_FOUND", "Инцидент не найден.", 404);
  const reason = input.reason?.trim().slice(0, 500) || incident.reason;
  const note = input.note?.trim().slice(0, 1000) || null;
  const now = new Date();

  if (input.action === "REVIEW") {
    const updated = await prisma.moderationIncident.update({ where: { id: incident.id }, data: { status: "IN_REVIEW", assignedAdminId: input.actingAdminId, reviewedAt: now, moderatorNote: note ?? undefined } });
    await prisma.auditLog.create({ data: { chatId: incident.chatId, affectedUserId: incident.affectedUserId, actingAdminId: input.actingAdminId, source: "ADMIN", action: "MODERATION_INCIDENT_REVIEW_STARTED", reason, metadata: { incidentId: incident.id } } });
    return updated;
  }
  if (input.action === "NOTE") {
    if (!note) throw new IncidentError("NOTE_REQUIRED", "Введите заметку модератора.", 400);
    const updated = await prisma.moderationIncident.update({ where: { id: incident.id }, data: { moderatorNote: note, assignedAdminId: input.actingAdminId, reviewedAt: incident.reviewedAt ?? now } });
    await prisma.auditLog.create({ data: { chatId: incident.chatId, affectedUserId: incident.affectedUserId, actingAdminId: input.actingAdminId, source: "ADMIN", action: "MODERATION_INCIDENT_NOTE_UPDATED", reason: note, metadata: { incidentId: incident.id } } });
    return updated;
  }

  if (input.action === "DELETE_MESSAGE") {
    if (!incident.messageId) throw new IncidentError("MESSAGE_NOT_FOUND", "У инцидента нет сохранённого сообщения.", 409);
    await deleteStoredMessage({ messageId: incident.messageId, actingAdminId: input.actingAdminId, reason });
  } else if (["WARNING", "MUTE", "BAN", "UNBAN"].includes(input.action)) {
    const membership = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: incident.chatId, userId: incident.affectedUserId } }, select: { id: true } });
    if (!membership) throw new IncidentError("MEMBER_NOT_FOUND", "Участник не найден в этом чате.", 409);
    await executeModerationAction({ membershipId: membership.id, actingAdminId: input.actingAdminId, action: input.action as "WARNING" | "MUTE" | "BAN" | "UNBAN", reason, muteDurationMinutes: input.action === "MUTE" ? input.muteDurationMinutes : null });
  }

  const status = input.action === "SKIP" ? "SKIPPED" : "RESOLVED";
  const updated = await prisma.moderationIncident.update({
    where: { id: incident.id },
    data: { status, resolvedByAdminId: input.actingAdminId, resolvedAt: now, moderatorNote: note ?? undefined, metadata: { ...(typeof incident.metadata === "object" && incident.metadata ? incident.metadata : {}), decision: input.action, falsePositive: input.action === "FALSE_POSITIVE" } }
  });
  await prisma.auditLog.create({ data: { chatId: incident.chatId, affectedUserId: incident.affectedUserId, actingAdminId: input.actingAdminId, source: "ADMIN", action: input.action === "FALSE_POSITIVE" ? "MODERATION_INCIDENT_FALSE_POSITIVE" : "MODERATION_INCIDENT_RESOLVED", reason, metadata: { incidentId: incident.id, decision: input.action } } });
  return updated;
}
