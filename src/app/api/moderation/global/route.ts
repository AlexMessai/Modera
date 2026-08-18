import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import { RESTRICTABLE_MESSAGE_TYPES } from "@/server/services/automod-service";
import {
  getGlobalModerationProfile,
  updateGlobalModerationProfile
} from "@/server/services/global-moderation-service";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  blockLinks: z.boolean(),
  allowedDomains: z.array(z.string().trim().min(1).max(255)).max(100),
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
  blockedMessageTypes: z.array(z.enum(RESTRICTABLE_MESSAGE_TYPES)).max(20),
  ignoreAdmins: z.boolean(),
  autoEscalationEnabled: z.boolean(),
  muteAfterWarnings: z.number().int().min(2).max(20),
  muteDurationMinutes: z.number().int().min(1).max(10080),
  banAfterWarnings: z.number().int().min(3).max(50),
  warningExpiryDays: z.number().int().min(0).max(3650)
}).refine((value) => value.banAfterWarnings > value.muteAfterWarnings, {
  message: "Порог блокировки должен быть выше порога mute.",
  path: ["banAfterWarnings"]
});

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  return Response.json({ data: await getGlobalModerationProfile() });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять глобальную политику могут только владелец и администратор Modera." } }, { status: 403 });
  }

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте настройки глобальной автомодерации." } }, { status: 400 });

  const saved = await updateGlobalModerationProfile({ actingAdminId: auth.admin.id, settings: parsed.data });
  return Response.json({ data: saved });
}