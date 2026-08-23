import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canModerate } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import { prisma } from "@/server/db/prisma";
import {
  executeJoinRequestAction,
  JoinRequestError
} from "@/server/services/join-request-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["approve", "decline"])
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } },
      { status: 403 }
    );
  }

  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Выберите действие с заявкой." } },
      { status: 400 }
    );
  }

  const { id } = await context.params;

  // See appeals/[id]/action/route.ts for the reasoning: chat-access check
  // (honest 404) only runs when the request's chat can actually be resolved;
  // a missing request falls through to executeJoinRequestAction()'s own 404.
  let chatId: string | null = null;
  if (auth.admin.scope === "CHAT") {
    const joinRequest = await prisma.joinRequest.findUnique({ where: { id }, select: { chatId: true } });
    if (!joinRequest) {
      return Response.json(
        { error: { code: "JOIN_REQUEST_NOT_FOUND", message: "Заявка не найдена." } },
        { status: 404 }
      );
    }
    const access = await requireChatAccess(auth.admin, joinRequest.chatId);
    if (!access.ok) return access.response;
    chatId = joinRequest.chatId;
  }

  const effectiveRole = chatId ? await resolveEffectiveChatRole(auth.admin, chatId) : auth.admin.role;
  if (!canModerate(effectiveRole)) {
    return Response.json(
      { error: { code: "FORBIDDEN", message: "У вашей роли нет прав на действия модерации." } },
      { status: 403 }
    );
  }

  try {
    const result = await executeJoinRequestAction({
      requestId: id,
      actingAdminId: auth.admin.id,
      action: parsed.data.action === "approve" ? "APPROVE" : "DECLINE"
    });
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof JoinRequestError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.httpStatus }
      );
    }
    return Response.json(
      { error: { code: "JOIN_REQUEST_FAILED", message: "Не удалось обработать заявку." } },
      { status: 500 }
    );
  }
}