import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  CustomCommandError,
  deleteCustomCommand,
  updateCustomCommand
} from "@/server/services/custom-command-service";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  trigger: z.string().min(1).max(32),
  responseText: z.string().min(1).max(1000),
  adminOnly: z.boolean(),
  enabled: z.boolean()
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; commandId: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id, commandId } = await context.params;
  const access = await requireChatAccess(auth.admin, id);
  if (!access.ok) return access.response;
  const effectiveRole = await resolveEffectiveChatRole(auth.admin, id);
  if (!canManageChatSettings(effectiveRole)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять команды могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте название и текст ответа." } }, { status: 400 });
  }
  try {
    const command = await updateCustomCommand({ chatId: id, commandId, actingAdminId: auth.admin.id, ...parsed.data });
    return Response.json({ data: command });
  } catch (error) {
    if (error instanceof CustomCommandError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === "COMMAND_NOT_FOUND" ? 404 : 400 });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось сохранить команду." } }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; commandId: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id, commandId } = await context.params;
  const access = await requireChatAccess(auth.admin, id);
  if (!access.ok) return access.response;
  const effectiveRole = await resolveEffectiveChatRole(auth.admin, id);
  if (!canManageChatSettings(effectiveRole)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять команды могут только владелец и администратор Modera." } }, { status: 403 });
  }
  try {
    await deleteCustomCommand({ chatId: id, commandId, actingAdminId: auth.admin.id });
    return Response.json({ data: { deleted: true } });
  } catch (error) {
    if (error instanceof CustomCommandError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === "COMMAND_NOT_FOUND" ? 404 : 400 });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось удалить команду." } }, { status: 500 });
  }
}
