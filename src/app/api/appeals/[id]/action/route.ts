import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canModerate } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import { prisma } from "@/server/db/prisma";
import { AppealError, resolveAppeal } from "@/server/services/appeal-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["approve", "reject"]),
  comment: z.string().max(1000).optional()
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
      { error: { code: "VALIDATION_ERROR", message: "Выберите решение по апелляции." } },
      { status: 400 }
    );
  }

  const { id } = await context.params;

  // A CHAT-scoped admin must not learn "this appeal belongs to a chat you
  // can't see" vs. "this appeal doesn't exist" -- so the chat-access check
  // (honest 404) only runs when we can actually resolve the appeal's chat.
  // A missing appeal falls through to resolveAppeal()'s own 404 below,
  // exactly matching GLOBAL-admin behavior today (role gate happens first,
  // resource lookup happens inside the service call).
  let chatId: string | null = null;
  if (auth.admin.scope === "CHAT") {
    const appeal = await prisma.appeal.findUnique({ where: { id }, select: { chatId: true } });
    if (!appeal) {
      return Response.json(
        { error: { code: "APPEAL_NOT_FOUND", message: "Апелляция не найдена." } },
        { status: 404 }
      );
    }
    const access = await requireChatAccess(auth.admin, appeal.chatId);
    if (!access.ok) return access.response;
    chatId = appeal.chatId;
  }

  const effectiveRole = chatId ? await resolveEffectiveChatRole(auth.admin, chatId) : auth.admin.role;
  if (!canModerate(effectiveRole)) {
    return Response.json(
      { error: { code: "FORBIDDEN", message: "У вашей роли нет прав на действия модерации." } },
      { status: 403 }
    );
  }

  try {
    const result = await resolveAppeal({
      appealId: id,
      actingAdminId: auth.admin.id,
      decision: parsed.data.action === "approve" ? "APPROVE" : "REJECT",
      comment: parsed.data.comment
    });
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof AppealError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.httpStatus }
      );
    }
    return Response.json(
      { error: { code: "APPEAL_ACTION_FAILED", message: "Не удалось обработать апелляцию." } },
      { status: 500 }
    );
  }
}
