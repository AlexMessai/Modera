import { z } from "zod";
import { requireAdminApi, requireChatAccess, canManageChatTeam } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/http/origin";
import {
  CHAT_ADMIN_ACCESS_ROLES,
  ChatAdminAccessError,
  grantChatAccessByUsername,
  listChatTeam
} from "@/server/services/chat-admin-access-service";

export const dynamic = "force-dynamic";

const grantSchema = z.object({
  handle: z.string().min(1).max(64),
  role: z.enum(CHAT_ADMIN_ACCESS_ROLES)
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
  const team = await listChatTeam(id);
  return Response.json({ data: team });
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
  if (!(await canManageChatTeam(auth.admin, id))) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Добавлять администраторов может только владелец команды этого чата." } }, { status: 403 });
  }
  const parsed = grantSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте username и роль." } }, { status: 400 });
  }
  try {
    const saved = await grantChatAccessByUsername({
      chatId: id,
      actingAdminId: auth.admin.id,
      handle: parsed.data.handle,
      role: parsed.data.role
    });
    const team = await listChatTeam(id);
    const custom = team.custom.find((item) => item.accessId === saved.id) ?? null;
    return Response.json({ data: custom });
  } catch (error) {
    if (error instanceof ChatAdminAccessError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось добавить администратора." } }, { status: 500 });
  }
}
