import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  ChatInviteLinkError,
  createChatInviteLink,
  listChatInviteLinks
} from "@/server/services/chat-invite-link-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().max(32).optional(),
  memberLimit: z.number().int().min(1).max(100000).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  createsJoinRequest: z.boolean()
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
  const links = await listChatInviteLinks(id);
  return Response.json({ data: links });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
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
    return Response.json({ error: { code: "FORBIDDEN", message: "Создавать ссылки могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте параметры ссылки." } }, { status: 400 });
  }
  try {
    const link = await createChatInviteLink({ chatId: id, actingAdminId: auth.admin.id, ...parsed.data });
    return Response.json({ data: link });
  } catch (error) {
    if (error instanceof ChatInviteLinkError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось создать ссылку." } }, { status: 500 });
  }
}
