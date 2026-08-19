import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  getChatManualModerationProfile,
  updateChatManualModerationProfile
} from "@/server/services/manual-moderation-settings-service";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  useGlobalProfile: z.boolean(),
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const profile = await getChatManualModerationProfile(id);
  if (!profile) {
    return Response.json({ error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." } }, { status: 404 });
  }
  return Response.json({ data: profile });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять настройки ручной модерации могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте настройки ручной модерации." } }, { status: 400 });
  }
  const { id } = await context.params;
  const saved = await updateChatManualModerationProfile({
    chatId: id,
    actingAdminId: auth.admin.id,
    useGlobalProfile: parsed.data.useGlobalProfile,
    settings: parsed.data
  });
  if (!saved) {
    return Response.json({ error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." } }, { status: 404 });
  }
  return Response.json({ data: saved });
}
