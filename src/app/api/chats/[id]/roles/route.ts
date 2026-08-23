import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  CHAT_PERMISSIONS,
  isChatPermission,
  listChatRoles,
  updateChatRolePermissions
} from "@/server/services/chat-role-service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  roleId: z.string().uuid(),
  permissions: z.array(z.enum(CHAT_PERMISSIONS))
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
  const roles = await listChatRoles(id);
  return Response.json({ data: roles });
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
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять роли могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте выбранные права." } }, { status: 400 });
  }
  const saved = await updateChatRolePermissions({
    chatId: id,
    roleId: parsed.data.roleId,
    actingAdminId: auth.admin.id,
    permissions: parsed.data.permissions.filter(isChatPermission)
  });
  if (!saved) {
    return Response.json({ error: { code: "ROLE_NOT_FOUND", message: "Роль не найдена в этом чате." } }, { status: 404 });
  }
  return Response.json({ data: saved });
}
