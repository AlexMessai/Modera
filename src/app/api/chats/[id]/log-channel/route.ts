import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  getChatLogChannelProfile,
  unlinkLogChannel,
  updateChatLogChannelSettings
} from "@/server/services/log-channel-service";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({ enabled: z.boolean() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const access = await requireChatAccess(auth.admin, id);
  if (!access.ok) return access.response;
  const profile = await getChatLogChannelProfile(id);
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
  const effectiveRole = await resolveEffectiveChatRole(auth.admin, id);
  if (!canManageChatSettings(effectiveRole)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять настройки канала логов могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте настройки канала логов." } }, { status: 400 });
  }
  const saved = await updateChatLogChannelSettings({
    chatId: id,
    actingAdminId: auth.admin.id,
    enabled: parsed.data.enabled
  });
  if (!saved) {
    return Response.json({ error: { code: "NO_CHANNEL_LINKED", message: "Сначала подключите канал командой /settings в Telegram." } }, { status: 409 });
  }
  return Response.json({ data: saved });
}

export async function DELETE(
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
  const effectiveRole = await resolveEffectiveChatRole(auth.admin, id);
  if (!canManageChatSettings(effectiveRole)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Отключать канал логов могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const saved = await unlinkLogChannel({ chatId: id, actingAdminId: auth.admin.id });
  if (!saved) {
    return Response.json({ error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." } }, { status: 404 });
  }
  return Response.json({ data: saved });
}
