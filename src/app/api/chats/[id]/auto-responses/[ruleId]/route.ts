import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  AUTO_RESPONSE_MATCH_TYPES,
  AutoResponseError,
  deleteAutoResponseRule,
  updateAutoResponseRule
} from "@/server/services/auto-response-service";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  trigger: z.string().min(1).max(200),
  matchType: z.enum(AUTO_RESPONSE_MATCH_TYPES),
  responseText: z.string().min(1).max(1000),
  enabled: z.boolean()
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; ruleId: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять автоответы могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте триггер и текст ответа." } }, { status: 400 });
  }
  const { id, ruleId } = await context.params;
  try {
    const rule = await updateAutoResponseRule({ chatId: id, ruleId, actingAdminId: auth.admin.id, ...parsed.data });
    return Response.json({ data: rule });
  } catch (error) {
    if (error instanceof AutoResponseError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === "RULE_NOT_FOUND" ? 404 : 400 });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось сохранить автоответ." } }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; ruleId: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять автоответы могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const { id, ruleId } = await context.params;
  try {
    await deleteAutoResponseRule({ chatId: id, ruleId, actingAdminId: auth.admin.id });
    return Response.json({ data: { deleted: true } });
  } catch (error) {
    if (error instanceof AutoResponseError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === "RULE_NOT_FOUND" ? 404 : 400 });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось удалить автоответ." } }, { status: 500 });
  }
}
