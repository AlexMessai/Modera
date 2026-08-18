import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import { RESTRICTABLE_MESSAGE_TYPES } from "@/server/services/automod-service";
import {
  getChatModerationProfile,
  updateChatModerationSettings
} from "@/server/services/chat-moderation-settings-service";

export const dynamic = "force-dynamic";

const settingsSchema = z.object({
  blockLinks: z.boolean(),
  allowedDomains: z.array(z.string().trim().min(1).max(255)).max(100),
  spamEnabled: z.boolean(),
  spamWindowSeconds: z.number().int().min(3).max(120),
  spamMaxMessages: z.number().int().min(2).max(50),
  blockedTermsEnabled: z.boolean(),
  blockedTerms: z.array(z.string().trim().min(1).max(160)).max(200),
  massMentionsEnabled: z.boolean(),
  maxMentions: z.number().int().min(1).max(50),
  duplicateEnabled: z.boolean(),
  duplicateWindowSeconds: z.number().int().min(5).max(3600),
  duplicateMaxMessages: z.number().int().min(1).max(20),
  blockedMessageTypes: z.array(z.enum(RESTRICTABLE_MESSAGE_TYPES)).max(20),
  ignoreAdmins: z.boolean()
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const profile = await getChatModerationProfile(id);
  if (!profile) {
    return Response.json(
      { error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." } },
      { status: 404 }
    );
  }

  return Response.json({ data: profile });
}

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
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Изменять правила чата могут только владелец и администратор Modera."
        }
      },
      { status: 403 }
    );
  }

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Проверьте настройки автомодерации."
        }
      },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  const saved = await updateChatModerationSettings({
    chatId: id,
    actingAdminId: auth.admin.id,
    ...parsed.data
  });

  if (!saved) {
    return Response.json(
      { error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." } },
      { status: 404 }
    );
  }

  return Response.json({ data: saved });
}
