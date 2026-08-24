import { z } from "zod";
import { requireAdminApi, requireGlobalAdminAccess } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  getModerationNotificationProfiles,
  MODERATION_NOTIFICATION_AUDIENCES,
  MODERATION_NOTIFICATION_EVENTS,
  MODERATION_NOTIFICATION_SOURCES,
  updateModerationNotificationProfiles
} from "@/server/services/moderation-notification-settings-service";

export const dynamic = "force-dynamic";

const templateSchema = z.string().trim().min(1).max(1000);
const channelSchema = z.object({
  enabled: z.boolean(),
  templates: z.object(Object.fromEntries(MODERATION_NOTIFICATION_SOURCES.map((source) => [source, templateSchema])) as Record<(typeof MODERATION_NOTIFICATION_SOURCES)[number], typeof templateSchema>)
});
const profileSchema = z.object({
  event: z.enum(MODERATION_NOTIFICATION_EVENTS),
  channels: z.object(Object.fromEntries(MODERATION_NOTIFICATION_AUDIENCES.map((audience) => [audience, channelSchema])) as Record<(typeof MODERATION_NOTIFICATION_AUDIENCES)[number], typeof channelSchema>)
});
const settingsSchema = z.object({ profiles: z.array(profileSchema).length(MODERATION_NOTIFICATION_EVENTS.length) });

function authorize(admin: { scope: string; role: string }) {
  const globalAccess = requireGlobalAdminAccess(admin as Parameters<typeof requireGlobalAdminAccess>[0]);
  if (!globalAccess.ok) return globalAccess.response;
  if (!canManageChatSettings(admin.role as Parameters<typeof canManageChatSettings>[0])) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Центр уведомлений доступен только владельцу и администратору Modera." } }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const denied = authorize(auth.admin);
  if (denied) return denied;
  return Response.json({ data: { profiles: await getModerationNotificationProfiles() } });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const denied = authorize(auth.admin);
  if (denied) return denied;
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте настройки уведомлений." } }, { status: 400 });
  const profiles = await updateModerationNotificationProfiles({ actingAdminId: auth.admin.id, profiles: parsed.data.profiles });
  return Response.json({ data: { profiles } });
}
