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
  warnDeleteCommandMessage: z.boolean(),
  warnDeleteTargetMessage: z.boolean(),
  muteMessageTemplate: z.string().min(1).max(1000),
  muteDeleteCommandMessage: z.boolean(),
  muteDeleteTargetMessage: z.boolean(),
  banMessageTemplate: z.string().min(1).max(1000),
  banDeleteCommandMessage: z.boolean(),
  banDeleteTargetMessage: z.boolean(),
  unbanMessageTemplate: z.string().min(1).max(1000),
  unbanDeleteCommandMessage: z.boolean(),
  unbanDeleteTargetMessage: z.boolean()
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
