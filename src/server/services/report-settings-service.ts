import { prisma } from "@/server/db/prisma";

export type ReportSettingsValue = {
  enabled: boolean;
  /** Fixed duration used by the report card's "Ограничить" quick action -- see report-service.ts. */
  muteDurationMinutes: number;
};

export const DEFAULT_REPORT_SETTINGS: ReportSettingsValue = {
  enabled: true,
  muteDurationMinutes: 60
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function normalizeReportSettings(input: ReportSettingsValue): ReportSettingsValue {
  return {
    enabled: Boolean(input.enabled),
    muteDurationMinutes: boundedInteger(input.muteDurationMinutes, 1, 10080)
  };
}

export function serializeReportSettings(settings: ReportSettingsValue): ReportSettingsValue {
  return {
    enabled: settings.enabled,
    muteDurationMinutes: settings.muteDurationMinutes
  };
}

export async function getChatReportProfile(chatId: string) {
  if (!UUID_PATTERN.test(chatId)) return null;
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { reportSettings: true }
  });
  if (!chat) return null;

  const local = chat.reportSettings;

  return {
    chat: {
      id: chat.id,
      telegramChatId: chat.telegramChatId.toString(),
      title: chat.title,
      username: chat.username,
      type: chat.type
    },
    settings: serializeReportSettings(local ?? DEFAULT_REPORT_SETTINGS)
  };
}

export async function updateChatReportSettings(input: {
  chatId: string;
  actingAdminId: string;
  settings: ReportSettingsValue;
}) {
  if (!UUID_PATTERN.test(input.chatId)) return null;
  const chat = await prisma.chat.findUnique({ where: { id: input.chatId }, select: { id: true } });
  if (!chat) return null;
  const normalized = normalizeReportSettings(input.settings);
  const saved = await prisma.$transaction(async (tx) => {
    const settings = await tx.chatReportSettings.upsert({
      where: { chatId: input.chatId },
      create: { chatId: input.chatId, ...normalized },
      update: normalized
    });
    await tx.auditLog.create({
      data: {
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        source: "ADMIN",
        action: "REPORT_SETTINGS_UPDATED",
        metadata: serializeReportSettings(settings)
      }
    });
    return settings;
  });
  return serializeReportSettings(saved);
}

export async function resolveEffectiveReportSettings(chatId: string) {
  const local = await prisma.chatReportSettings.findUnique({ where: { chatId } });
  return {
    source: "CHAT" as const,
    settings: serializeReportSettings(local ?? DEFAULT_REPORT_SETTINGS)
  };
}
