import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  getGlobalContentProfile,
  updateGlobalContentProfile
} from "@/server/services/content-settings-service";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  welcomeEnabled: z.boolean(),
  welcomeMessageTemplate: z.string().min(1).max(2000),
  rulesText: z.string().max(4000)
});

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  return Response.json({ data: await getGlobalContentProfile() });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять глобальные приветствие/правила могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте текст приветствия и правил." } }, { status: 400 });
  }
  const saved = await updateGlobalContentProfile({
    actingAdminId: auth.admin.id,
    settings: parsed.data
  });
  return Response.json({ data: saved });
}
