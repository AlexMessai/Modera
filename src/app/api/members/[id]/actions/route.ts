import { z } from "zod";
import { requireAdminApi, requireChatAccess, resolveEffectiveChatRole } from "@/server/auth/guards";
import { canModerate } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import { prisma } from "@/server/db/prisma";
import { executeModerationAction, ModerationError } from "@/server/services/moderation-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["warning", "mute", "unmute", "ban", "unban", "kick"]),
  reason: z.string().trim().max(500).optional(),
  muteDurationMinutes: z.number().int().min(1).max(10080).nullable().optional(),
  banDurationMinutes: z.number().int().min(1).max(527040).nullable().optional()
});

const actionMap = {
  warning: "WARNING",
  mute: "MUTE",
  unmute: "UNMUTE",
  ban: "BAN",
  unban: "UNBAN",
  kick: "KICK"
} as const;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте действие, причину и срок модерации." } }, { status: 400 });
  const { id } = await context.params;

  // See appeals/[id]/action/route.ts for the reasoning: chat-access check
  // (honest 404) only runs when the membership's chat can actually be
  // resolved; a missing membership falls through to executeModerationAction()'s
  // own 404.
  let chatId: string | null = null;
  if (auth.admin.scope === "CHAT") {
    const membership = await prisma.chatMember.findUnique({ where: { id }, select: { chatId: true } });
    if (!membership) {
      return Response.json({ error: { code: "MEMBER_NOT_FOUND", message: "Участник не найден." } }, { status: 404 });
    }
    const access = await requireChatAccess(auth.admin, membership.chatId);
    if (!access.ok) return access.response;
    chatId = membership.chatId;
  }

  const effectiveRole = chatId ? await resolveEffectiveChatRole(auth.admin, chatId) : auth.admin.role;
  if (!canModerate(effectiveRole)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "У вашей роли нет прав на действия модерации." } }, { status: 403 });
  }

  try {
    const result = await executeModerationAction({
      membershipId: id,
      actingAdminId: auth.admin.id,
      action: actionMap[parsed.data.action],
      reason: parsed.data.reason,
      muteDurationMinutes: parsed.data.action === "mute" ? parsed.data.muteDurationMinutes : null,
      banDurationMinutes: parsed.data.action === "ban" ? parsed.data.banDurationMinutes : null
    });
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof ModerationError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    return Response.json({ error: { code: "MODERATION_ACTION_FAILED", message: "Не удалось выполнить действие модерации." } }, { status: 500 });
  }
}