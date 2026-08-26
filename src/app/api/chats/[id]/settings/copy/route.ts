import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  ChatSettingsCopyError,
  COPYABLE_SETTINGS_SECTIONS,
  copyChatSettings
} from "@/server/services/chat-settings-copy-service";

export const dynamic = "force-dynamic";

const copySchema = z.object({
  sourceChatId: z.string().uuid(),
  sections: z.array(z.enum(COPYABLE_SETTINGS_SECTIONS)).min(1)
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const targetAccess = await requireChatAccess(auth.admin, id);
  if (!targetAccess.ok) return targetAccess.response;
  const effectiveRole = await resolveEffectiveChatRole(auth.admin, id);
  if (!canManageChatSettings(effectiveRole)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Копировать настройки могут только владелец и администратор Modera." } }, { status: 403 });
  }

  const parsed = copySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте параметры копирования." } }, { status: 400 });
  }

  const sourceAccess = await requireChatAccess(auth.admin, parsed.data.sourceChatId);
  if (!sourceAccess.ok) return sourceAccess.response;

  try {
    const result = await copyChatSettings({
      sourceChatId: parsed.data.sourceChatId,
      targetChatId: id,
      actingAdminId: auth.admin.id,
      sections: parsed.data.sections
    });
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof ChatSettingsCopyError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось скопировать настройки." } }, { status: 500 });
  }
}
