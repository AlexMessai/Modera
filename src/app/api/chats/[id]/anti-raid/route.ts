import { z } from "zod";
import { requireAdminApi, requireChatAccess } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  getChatAntiRaidProfile,
  updateChatAntiRaidSettings
} from "@/server/services/anti-raid-settings-service";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  enabled: z.boolean(),
  joinThreshold: z.number().int().min(3).max(500),
  windowSeconds: z.number().int().min(5).max(600),
  cooldownMinutes: z.number().int().min(1).max(1440),
  forceCaptcha: z.boolean()
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
  const profile = await getChatAntiRaidProfile(id);
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
  const { id } = await context.params;
  const access = await requireChatAccess(auth.admin, id);
  if (!access.ok) return access.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять настройки Anti-Raid могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте настройки Anti-Raid." } }, { status: 400 });
  }
  const saved = await updateChatAntiRaidSettings({
    chatId: id,
    actingAdminId: auth.admin.id,
    settings: parsed.data
  });
  if (!saved) {
    return Response.json({ error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." } }, { status: 404 });
  }
  return Response.json({ data: saved });
}
