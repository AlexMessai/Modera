import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  getManualModerationVisibility,
  updateManualModerationVisibility
} from "@/server/services/manual-moderation-settings-service";

export const dynamic = "force-dynamic";

const visibilitySchema = z.object({
  publicPunishmentMessagesEnabled: z.boolean(),
  privatePunishmentMessagesEnabled: z.boolean(),
  proactiveDmNotificationsEnabled: z.boolean()
});

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  return Response.json({ data: await getManualModerationVisibility() });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять видимость уведомлений могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = visibilitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте настройки видимости." } }, { status: 400 });
  }
  const saved = await updateManualModerationVisibility({
    actingAdminId: auth.admin.id,
    visibility: parsed.data
  });
  return Response.json({ data: saved });
}
