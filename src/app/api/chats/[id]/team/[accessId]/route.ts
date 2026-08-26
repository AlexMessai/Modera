import { z } from "zod";
import { requireAdminApi, requireChatAccess, canManageChatTeam } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/http/origin";
import {
  CHAT_ADMIN_ACCESS_ROLES,
  ChatAdminAccessError,
  listChatTeam,
  revokeChatAccess,
  updateChatAccessRole
} from "@/server/services/chat-admin-access-service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  role: z.enum(CHAT_ADMIN_ACCESS_ROLES)
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; accessId: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id, accessId } = await context.params;
  const access = await requireChatAccess(auth.admin, id);
  if (!access.ok) return access.response;
  if (!(await canManageChatTeam(auth.admin, id))) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять роли в команде может только владелец команды этого чата." } }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте выбранную роль." } }, { status: 400 });
  }
  try {
    const updated = await updateChatAccessRole({
      chatId: id,
      actingAdminId: auth.admin.id,
      accessId,
      role: parsed.data.role
    });
    if (!updated) {
      return Response.json({ error: { code: "ACCESS_NOT_FOUND", message: "Запись не найдена в этом чате." } }, { status: 404 });
    }
    const team = await listChatTeam(id);
    const custom = team.custom.find((item) => item.accessId === updated.id) ?? null;
    return Response.json({ data: custom });
  } catch (error) {
    if (error instanceof ChatAdminAccessError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось изменить роль." } }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; accessId: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id, accessId } = await context.params;
  const access = await requireChatAccess(auth.admin, id);
  if (!access.ok) return access.response;
  if (!(await canManageChatTeam(auth.admin, id))) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Убирать администраторов может только владелец команды этого чата." } }, { status: 403 });
  }
  try {
    const revoked = await revokeChatAccess({ chatId: id, actingAdminId: auth.admin.id, accessId });
    if (!revoked) {
      return Response.json({ error: { code: "ACCESS_NOT_FOUND", message: "Запись не найдена в этом чате." } }, { status: 404 });
    }
    return Response.json({ data: { deleted: true } });
  } catch (error) {
    if (error instanceof ChatAdminAccessError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось удалить администратора." } }, { status: 500 });
  }
}
