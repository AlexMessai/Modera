import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  getChatModerationProfile,
  updateChatModerationSettings
} from "@/server/services/chat-moderation-settings-service";
import { LINK_PROTECTION_MODES, MEDIA_FILTER_TYPES } from "@/server/services/global-moderation-service";

export const dynamic = "force-dynamic";

const escalationRuleSchema = z.object({
  order: z.number().int().min(1).max(20),
  thresholdWarnings: z.number().int().min(1).max(999),
  action: z.enum(["MUTE", "BAN"]),
  durationMinutes: z.number().int().min(1).max(527040).nullable()
});

const mediaFilterRuleSchema = z.object({
  type: z.enum(MEDIA_FILTER_TYPES),
  enabled: z.boolean(),
  deleteMessage: z.boolean(),
  punishmentEnabled: z.boolean(),
  punishmentAction: z.enum(["WARN", "MUTE"]),
  muteDurationMinutes: z.number().int().min(15).max(43200),
  warnOnTrigger: z.boolean(),
  notifyEnabled: z.boolean(),
  notifyText: z.string().max(1000)
});

const automodRuleActionSchema = z.object({
  rule: z.enum(["LINK", "TERM", "SPAM", "DUPLICATE", "MENTIONS"]),
  deleteMessage: z.boolean(),
  punishmentEnabled: z.boolean(),
  punishmentAction: z.enum(["WARN", "MUTE"]),
  muteDurationMinutes: z.number().int().min(15).max(43200),
  notifyEnabled: z.boolean(),
  notifyText: z.string().max(1000)
});

const settingsSchema = z.object({
  linkEnabled: z.boolean(),
  linkProtectionMode: z.enum(LINK_PROTECTION_MODES),
  allowedDomains: z.array(z.string().trim().min(1).max(255)).max(100),
  blockedDomains: z.array(z.string().trim().min(1).max(255)).max(100),
  spamEnabled: z.boolean(),
  spamWindowSeconds: z.number().int().min(3).max(120),
  spamMaxMessages: z.number().int().min(2).max(50),
  blockedTermsEnabled: z.boolean(),
  blockedTerms: z.array(z.string().trim().min(1).max(160)).max(200),
  massMentionsEnabled: z.boolean(),
  maxMentions: z.number().int().min(1).max(50),
  duplicateEnabled: z.boolean(),
  duplicateWindowSeconds: z.number().int().min(5).max(3600),
  duplicateMaxMessages: z.number().int().min(1).max(20),
  ignoreAdmins: z.boolean(),
  autoEscalationEnabled: z.boolean(),
  escalationRules: z.array(escalationRuleSchema).max(20),
  warningExpiryDays: z.number().int().min(0).max(3650),
  announceEscalationEnabled: z.boolean(),
  escalationMuteMessageTemplate: z.string().min(1).max(1000),
  escalationBanMessageTemplate: z.string().min(1).max(1000),
  mediaFilters: z.array(mediaFilterRuleSchema).max(MEDIA_FILTER_TYPES.length),
  ruleActions: z.array(automodRuleActionSchema).max(5)
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const access = await requireChatAccess(auth.admin, id);
  if (!access.ok) return access.response;
  const profile = await getChatModerationProfile(id);
  if (!profile) return Response.json({ error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." } }, { status: 404 });
  return Response.json({ data: profile });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const access = await requireChatAccess(auth.admin, id);
  if (!access.ok) return access.response;
  const effectiveRole = await resolveEffectiveChatRole(auth.admin, id);
  if (!canManageChatSettings(effectiveRole)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять правила чата могут только владелец и администратор Modera." } }, { status: 403 });
  }

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте настройки автомодерации." } }, { status: 400 });

  const saved = await updateChatModerationSettings({ chatId: id, actingAdminId: auth.admin.id, ...parsed.data });
  if (!saved) return Response.json({ error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." } }, { status: 404 });
  return Response.json({ data: saved });
}
