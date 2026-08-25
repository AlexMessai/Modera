import { prisma } from "@/server/db/prisma";
import { executeModerationAction, ModerationError } from "@/server/services/moderation-service";
import { escalateManualWarningAndAnnounce } from "@/server/services/moderation-escalation-service";
import { resolveEffectiveReportSettings } from "@/server/services/report-settings-service";
import { listTelegramModeratorsForChat } from "@/server/services/chat-admin-access-service";
import { getTelegramClient } from "@/server/telegram/client";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORT_CALLBACK_PREFIX = "report:";
const MAX_REASON_LENGTH = 500;

export const REPORT_CALLBACK_ACTIONS = ["DELETE", "WARN", "MUTE", "BAN", "DISMISS"] as const;
export type ReportCallbackAction = (typeof REPORT_CALLBACK_ACTIONS)[number];

export class ReportError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ReportError";
  }
}

export function buildReportCallbackData(reportId: string, action: ReportCallbackAction) {
  return `${REPORT_CALLBACK_PREFIX}${reportId}:${action}`;
}

export function parseReportCallbackData(data: string): { reportId: string; action: ReportCallbackAction } | null {
  if (!data.startsWith(REPORT_CALLBACK_PREFIX)) return null;
  const [reportId, action] = data.slice(REPORT_CALLBACK_PREFIX.length).split(":");
  if (!reportId || !UUID_PATTERN.test(reportId)) return null;
  if (!REPORT_CALLBACK_ACTIONS.includes(action as ReportCallbackAction)) return null;
  return { reportId, action: action as ReportCallbackAction };
}

function normalizeReason(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_REASON_LENGTH) : null;
}

export async function createReport(input: {
  chatId: string;
  reporterTelegramUserId: number;
  reportedTelegramUserId: number;
  messageTelegramId: number;
  reason: string | null;
}) {
  if (input.reporterTelegramUserId === input.reportedTelegramUserId) {
    return { outcome: "self_report" as const };
  }

  const { settings: reportSettings } = await resolveEffectiveReportSettings(input.chatId);
  if (!reportSettings.enabled) {
    return { outcome: "disabled" as const };
  }

  const [reporter, reportedMember] = await Promise.all([
    prisma.telegramUser.findUnique({ where: { telegramUserId: BigInt(input.reporterTelegramUserId) } }),
    prisma.chatMember.findFirst({
      where: { chatId: input.chatId, user: { telegramUserId: BigInt(input.reportedTelegramUserId) } },
      include: { user: true }
    })
  ]);
  if (!reporter) return { outcome: "reporter_not_found" as const };
  if (!reportedMember) return { outcome: "reported_user_not_found" as const };

  const reason = normalizeReason(input.reason);
  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.report.create({
      data: {
        chatId: input.chatId,
        reporterUserId: reporter.id,
        reportedUserId: reportedMember.userId,
        messageTelegramId: BigInt(input.messageTelegramId),
        reason
      }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: reportedMember.userId,
        source: "TELEGRAM",
        action: "REPORT_SUBMITTED",
        reason,
        metadata: { reportId: created.id, reporterTelegramUserId: input.reporterTelegramUserId }
      }
    });
    return created;
  });

  return {
    outcome: "submitted" as const,
    reportId: report.id,
    reporterDisplayName: reporter.displayName,
    reportedDisplayName: reportedMember.user.displayName
  };
}

function buildTelegramMessageLink(telegramChatId: bigint, username: string | null, messageTelegramId: bigint) {
  if (username) return `https://t.me/${username}/${messageTelegramId}`;
  // Private supergroups use the "internal" chat id (the -100<id> prefix
  // stripped) in t.me/c/ links -- regular groups (positive-less, no -100
  // prefix) have no such link format, so this is best-effort only.
  const idString = telegramChatId.toString();
  if (!idString.startsWith("-100")) return null;
  return `https://t.me/c/${idString.slice(4)}/${messageTelegramId}`;
}

export async function notifyAdminsOfNewReport(input: {
  reportId: string;
  chatId: string;
  chatTitle: string;
  chatTelegramId: bigint;
  chatUsername: string | null;
  reporterDisplayName: string;
  reportedDisplayName: string;
  reason: string | null;
  messageTelegramId: number;
}) {
  const telegramModeratorIds = await listTelegramModeratorsForChat(input.chatId);
  if (telegramModeratorIds.length === 0) return;

  const link = buildTelegramMessageLink(input.chatTelegramId, input.chatUsername, BigInt(input.messageTelegramId));
  const lines = [
    `🚩 Жалоба в чате «${input.chatTitle}»`,
    `На: ${input.reportedDisplayName}`,
    `От: ${input.reporterDisplayName}`,
    input.reason ? `Причина: ${input.reason}` : null,
    link ? `Сообщение: ${link}` : null
  ].filter(Boolean);

  const client = getTelegramClient();
  for (const telegramUserId of telegramModeratorIds) {
    await client.sendMessage({
      chatId: Number(telegramUserId),
      text: lines.join("\n"),
      replyMarkup: {
        inline_keyboard: [
          [
            { text: "🗑 Удалить", callback_data: buildReportCallbackData(input.reportId, "DELETE") },
            { text: "⚠️ Предупредить", callback_data: buildReportCallbackData(input.reportId, "WARN") }
          ],
          [
            { text: "🔇 Ограничить", callback_data: buildReportCallbackData(input.reportId, "MUTE") },
            { text: "⛔ Забанить", callback_data: buildReportCallbackData(input.reportId, "BAN") }
          ],
          [{ text: "❌ Отклонить", callback_data: buildReportCallbackData(input.reportId, "DISMISS") }]
        ]
      }
    }).catch(() => undefined);
  }
}

async function finalizeReport(input: {
  reportId: string;
  chatId: string;
  reportedUserId: string;
  actingAdminId: string;
  status: "RESOLVED" | "DISMISSED";
  resolutionAction: ReportCallbackAction | null;
  auditAction: "REPORT_RESOLVED" | "REPORT_DISMISSED";
}) {
  return prisma.$transaction(async (tx) => {
    const saved = await tx.report.update({
      where: { id: input.reportId },
      data: {
        status: input.status,
        resolutionAction: input.resolutionAction,
        resolvedByAdminId: input.actingAdminId,
        resolvedAt: new Date()
      }
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        affectedUserId: input.reportedUserId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: input.auditAction,
        metadata: { reportId: input.reportId, action: input.resolutionAction }
      }
    });
    return saved;
  });
}

export async function resolveReport(input: {
  reportId: string;
  actingAdminId: string;
  action: ReportCallbackAction;
}) {
  const report = await prisma.report.findUnique({
    where: { id: input.reportId },
    include: { chat: true }
  });
  if (!report) throw new ReportError("REPORT_NOT_FOUND", "Жалоба не найдена.");
  if (report.status !== "PENDING") {
    // Idempotent, like resolveAppeal -- two admins can race to tap the same
    // report's buttons, and the second tap should show what already
    // happened rather than throw.
    return { status: report.status, actionTaken: report.resolutionAction as ReportCallbackAction | null };
  }

  if (input.action === "DISMISS") {
    const saved = await finalizeReport({
      reportId: report.id,
      chatId: report.chatId,
      reportedUserId: report.reportedUserId,
      actingAdminId: input.actingAdminId,
      status: "DISMISSED",
      resolutionAction: null,
      auditAction: "REPORT_DISMISSED"
    });
    return { status: saved.status, actionTaken: null };
  }

  if (input.action === "DELETE") {
    if (report.messageTelegramId) {
      // getTelegramClient() itself throws when no bot token is configured
      // (e.g. in CI) -- must be called inside this try, not before it, or
      // the throw would escape uncaught and fail the whole resolution.
      try {
        await getTelegramClient().deleteMessage(Number(report.chat.telegramChatId), Number(report.messageTelegramId));
      } catch {
        // Best-effort: the message may already be gone, or the bot may
        // lack delete rights -- either way the report itself still resolves.
      }
    }
    const saved = await finalizeReport({
      reportId: report.id,
      chatId: report.chatId,
      reportedUserId: report.reportedUserId,
      actingAdminId: input.actingAdminId,
      status: "RESOLVED",
      resolutionAction: "DELETE",
      auditAction: "REPORT_RESOLVED"
    });
    return { status: saved.status, actionTaken: "DELETE" as const };
  }

  const member = await prisma.chatMember.findFirst({
    where: { chatId: report.chatId, userId: report.reportedUserId },
    include: { user: true }
  });
  if (!member) throw new ReportError("MEMBER_NOT_FOUND", "Участник не найден в этом чате.");

  const actionMap = { WARN: "WARNING", MUTE: "MUTE", BAN: "BAN" } as const;
  const { settings: reportSettings } = await resolveEffectiveReportSettings(report.chatId);
  const reason = report.reason ?? "Жалоба от участника чата";
  try {
    await executeModerationAction({
      membershipId: member.id,
      actingAdminId: input.actingAdminId,
      action: actionMap[input.action],
      reason,
      muteDurationMinutes: input.action === "MUTE" ? reportSettings.muteDurationMinutes : undefined
    });
  } catch (error) {
    if (error instanceof ModerationError) throw new ReportError(error.code, error.message);
    throw error;
  }

  if (input.action === "WARN") {
    await escalateManualWarningAndAnnounce({
      chatId: report.chatId,
      telegramChatId: report.chat.telegramChatId,
      targetTelegramUserId: Number(member.user.telegramUserId),
      targetDisplayName: member.user.displayName,
      reason
    }).catch(() => undefined);
  }

  const saved = await finalizeReport({
    reportId: report.id,
    chatId: report.chatId,
    reportedUserId: report.reportedUserId,
    actingAdminId: input.actingAdminId,
    status: "RESOLVED",
    resolutionAction: input.action,
    auditAction: "REPORT_RESOLVED"
  });
  return { status: saved.status, actionTaken: input.action };
}
