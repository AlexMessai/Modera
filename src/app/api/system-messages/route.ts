import { z } from "zod";
import { requireAdminApi, requireGlobalAdminAccess } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import { getSystemMessages, updateSystemMessages } from "@/server/services/system-messages-service";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  automod: z.object({
    escalationMuteMessageTemplate: z.string().min(1).max(1000),
    escalationBanMessageTemplate: z.string().min(1).max(1000)
  }),
  appeals: z.object({
    appealSubmittedMessageTemplate: z.string().min(1).max(1000),
    appealNotifyAdminsMessageTemplate: z.string().min(1).max(1000),
    appealApprovedMessageTemplate: z.string().min(1).max(1000),
    appealRejectedMessageTemplate: z.string().min(1).max(1000)
  })
});

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const globalAccess = requireGlobalAdminAccess(auth.admin);
  if (!globalAccess.ok) return globalAccess.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Системные сообщения доступны только владельцу и администратору Modera." } }, { status: 403 });
  }
  return Response.json({ data: await getSystemMessages() });
}

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const globalAccess = requireGlobalAdminAccess(auth.admin);
  if (!globalAccess.ok) return globalAccess.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять системные сообщения могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Проверьте тексты сообщений." } }, { status: 400 });
  }
  const saved = await updateSystemMessages({
    actingAdminId: auth.admin.id,
    ...parsed.data
  });
  return Response.json({ data: saved });
}
