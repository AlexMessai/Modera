import { z } from "zod";
import { requireAdminApi, requireChatAccess } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  AUTO_RESPONSE_MATCH_TYPES,
  AutoResponseError,
  createAutoResponseRule,
  listAutoResponseRules
} from "@/server/services/auto-response-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  trigger: z.string().min(1).max(200),
  matchType: z.enum(AUTO_RESPONSE_MATCH_TYPES),
  responseText: z.string().min(1).max(1000),
  enabled: z.boolean()
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
  const rules = await listAutoResponseRules(id);
  return Response.json({ data: rules });
}

export async function POST(
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
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять автоответы могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте триггер и текст ответа." } }, { status: 400 });
  }
  try {
    const rule = await createAutoResponseRule({ chatId: id, actingAdminId: auth.admin.id, ...parsed.data });
    return Response.json({ data: rule });
  } catch (error) {
    if (error instanceof AutoResponseError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: 400 });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось создать автоответ." } }, { status: 500 });
  }
}
