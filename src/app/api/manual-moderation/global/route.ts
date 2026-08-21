import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  getGlobalManualModerationProfile,
  updateGlobalManualModerationProfile
} from "@/server/services/manual-moderation-settings-service";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  warnMessageTemplate: z.string().min(1).max(1000),
  warnDeleteTargetMessage: z.boolean(),
  warnAnnounceInChat: z.boolean(),
  warnEphemeralMessageTemplate: z.string().min(1).max(1000),
  unwarnMessageTemplate: z.string().min(1).max(1000),
  unwarnDeleteTargetMessage: z.boolean(),
  unwarnAnnounceInChat: z.boolean(),
  muteMessageTemplate: z.string().min(1).max(1000),
  muteDeleteTargetMessage: z.boolean(),
  muteAnnounceInChat: z.boolean(),
  muteEphemeralMessageTemplate: z.string().min(1).max(1000),
  unmuteMessageTemplate: z.string().min(1).max(1000),
  unmuteDeleteTargetMessage: z.boolean(),
  unmuteAnnounceInChat: z.boolean(),
  banMessageTemplate: z.string().min(1).max(1000),
  banDeleteTargetMessage: z.boolean(),
  banAnnounceInChat: z.boolean(),
  banEphemeralMessageTemplate: z.string().min(1).max(1000),
  unbanMessageTemplate: z.string().min(1).max(1000),
  unbanDeleteTargetMessage: z.boolean(),
  unbanAnnounceInChat: z.boolean(),
  kickMessageTemplate: z.string().min(1).max(1000),
  kickDeleteTargetMessage: z.boolean(),
  kickAnnounceInChat: z.boolean()
});

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  return Response.json({ data: await getGlobalManualModerationProfile() });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять политику ручной модерации могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте настройки ручной модерации." } }, { status: 400 });
  }
  const saved = await updateGlobalManualModerationProfile({
    actingAdminId: auth.admin.id,
    settings: parsed.data
  });
  return Response.json({ data: saved });
}
