import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  getGlobalAntiRaidProfile,
  updateGlobalAntiRaidProfile
} from "@/server/services/anti-raid-settings-service";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  enabled: z.boolean(),
  joinThreshold: z.number().int().min(3).max(500),
  windowSeconds: z.number().int().min(5).max(600),
  cooldownMinutes: z.number().int().min(1).max(1440),
  forceCaptcha: z.boolean()
});

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  return Response.json({ data: await getGlobalAntiRaidProfile() });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять политику Anti-Raid могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте настройки Anti-Raid." } }, { status: 400 });
  }
  const saved = await updateGlobalAntiRaidProfile({
    actingAdminId: auth.admin.id,
    settings: parsed.data
  });
  return Response.json({ data: saved });
}
