import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import { prisma } from "@/server/db/prisma";
import { setTrustedMember } from "@/server/services/trusted-member-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ trusted: z.boolean() });

export async function PATCH(
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

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Некорректное состояние исключения." } },
      { status: 400 }
    );
  }

  const { id } = await context.params;

  // See appeals/[id]/action/route.ts for the reasoning: chat-access check
  // (honest 404) only runs when the membership's chat can actually be
  // resolved; a missing membership falls through to setTrustedMember()'s own
  // "not found" (null) result below.
  let chatId: string | null = null;
  if (auth.admin.scope === "CHAT") {
    const membership = await prisma.chatMember.findUnique({ where: { id }, select: { chatId: true } });
    if (!membership) {
      return Response.json(
        { error: { code: "MEMBER_NOT_FOUND", message: "Участник не найден." } },
        { status: 404 }
      );
    }
    const access = await requireChatAccess(auth.admin, membership.chatId);
    if (!access.ok) return access.response;
    chatId = membership.chatId;
  }

  const effectiveRole = chatId ? await resolveEffectiveChatRole(auth.admin, chatId) : auth.admin.role;
  if (!canManageChatSettings(effectiveRole)) {
    return Response.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Управлять исключениями могут только владелец и администратор Modera."
        }
      },
      { status: 403 }
    );
  }

  const result = await setTrustedMember({
    membershipId: id,
    actingAdminId: auth.admin.id,
    trusted: parsed.data.trusted
  });

  if (!result) {
    return Response.json(
      { error: { code: "MEMBER_NOT_FOUND", message: "Участник не найден." } },
      { status: 404 }
    );
  }
  if ("error" in result) {
    return Response.json(
      { error: { code: result.error, message: "Telegram-ботам исключение не требуется." } },
      { status: 409 }
    );
  }

  return Response.json({ data: result });
}