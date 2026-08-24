import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import { MEDIA_FILTER_TYPES } from "@/server/services/global-moderation-service";
import { getSystemMessages, updateSystemMessages } from "@/server/services/system-messages-service";

export const dynamic = "force-dynamic";

const mediaFilterRuleSchema = z.object({
  type: z.enum(MEDIA_FILTER_TYPES),
  enabled: z.boolean(),
  warnOnTrigger: z.boolean(),
  notifyEnabled: z.boolean(),
  notifyText: z.string().min(1).max(1000)
});

const settingsSchema = z.object({
  automod: z.object({
    escalationMuteMessageTemplate: z.string().min(1).max(1000),
    escalationBanMessageTemplate: z.string().min(1).max(1000),
    mediaFilters: z.array(mediaFilterRuleSchema).max(MEDIA_FILTER_TYPES.length)
  }),
  manualModeration: z.object({
    warnMessageTemplate: z.string().min(1).max(1000),
    warnEphemeralMessageTemplate: z.string().min(1).max(1000),
    unwarnMessageTemplate: z.string().min(1).max(1000),
    muteMessageTemplate: z.string().min(1).max(1000),
    muteEphemeralMessageTemplate: z.string().min(1).max(1000),
    unmuteMessageTemplate: z.string().min(1).max(1000),
    banMessageTemplate: z.string().min(1).max(1000),
    banEphemeralMessageTemplate: z.string().min(1).max(1000),
    unbanMessageTemplate: z.string().min(1).max(1000),
    kickMessageTemplate: z.string().min(1).max(1000)
  }),
  captcha: z.object({
    challengeMessageTemplate: z.string().min(1).max(1000)
  }),
  content: z.object({
    welcomeMessageTemplate: z.string().min(1).max(2000)
  }),
  appeals: z.object({
    appealSubmittedMessageTemplate: z.string().min(1).max(1000),
    appealNotifyAdminsMessageTemplate: z.string().min(1).max(1000),
    appealApprovedMessageTemplate: z.string().min(1).max(1000),
    appealRejectedMessageTemplate: z.string().min(1).max(1000)
  })
});

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  return Response.json({ data: await getSystemMessages() });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять системные сообщения могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте тексты сообщений." } }, { status: 400 });
  }
  const saved = await updateSystemMessages({
    actingAdminId: auth.admin.id,
    ...parsed.data
  });
  return Response.json({ data: saved });
}
