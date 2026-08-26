import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  ChatInviteLinkError,
  deleteChatInviteLink,
  updateChatInviteLink
} from "@/server/services/chat-invite-link-service";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().max(32).optional(),
  memberLimit: z.number().int().min(1).max(100000).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  createsJoinRequest: z.boolean()
});

async function requireEditAccess(request: Request, chatId: string) {
  if (!isSameOrigin(request)) {
    return { ok: false as const, response: Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 }) };
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return { ok: false as const, response: auth.response };
  const access = await requireChatAccess(auth.admin, chatId);
  if (!access.ok) return { ok: false as const, response: access.response };
  const effectiveRole = await resolveEffectiveChatRole(auth.admin, chatId);
  if (!canManageChatSettings(effectiveRole)) {
    return {
      ok: false as const,
      response: Response.json({ error: { code: "FORBIDDEN", message: "Изменять ссылки могут только владелец и администратор Modera." } }, { status: 403 })
    };
  }
  return { ok: true as const, admin: auth.admin };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; linkId: string }> }
) {
  const { id, linkId } = await context.params;
  const auth = await requireEditAccess(request, id);
  if (!auth.ok) return auth.response;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте параметры ссылки." } }, { status: 400 });
  }
  try {
    const link = await updateChatInviteLink({ chatId: id, linkId, actingAdminId: auth.admin.id, ...parsed.data });
    return Response.json({ data: link });
  } catch (error) {
    if (error instanceof ChatInviteLinkError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось изменить ссылку." } }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; linkId: string }> }
) {
  const { id, linkId } = await context.params;
  const auth = await requireEditAccess(request, id);
  if (!auth.ok) return auth.response;

  try {
    await deleteChatInviteLink({ chatId: id, linkId, actingAdminId: auth.admin.id });
    return Response.json({ data: { deleted: true } });
  } catch (error) {
    if (error instanceof ChatInviteLinkError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось удалить ссылку." } }, { status: 500 });
  }
}
