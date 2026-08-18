import { z } from "zod";
import { requireModerationApi } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/http/origin";
import {
  executeModerationAction,
  ModerationError
} from "@/server/services/moderation-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["warning", "mute", "unmute", "ban", "unban"]),
  reason: z.string().trim().max(500).optional()
});

const actionMap = {
  warning: "WARNING",
  mute: "MUTE",
  unmute: "UNMUTE",
  ban: "BAN",
  unban: "UNBAN"
} as const;

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

  const auth = await requireModerationApi();
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Проверьте действие и причину модерации."
        }
      },
      { status: 400 }
    );
  }

  const { id } = await context.params;

  try {
    const result = await executeModerationAction({
      membershipId: id,
      actingAdminId: auth.admin.id,
      action: actionMap[parsed.data.action],
      reason: parsed.data.reason
    });

    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof ModerationError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.httpStatus }
      );
    }

    return Response.json(
      {
        error: {
          code: "MODERATION_ACTION_FAILED",
          message: "Не удалось выполнить действие модерации."
        }
      },
      { status: 500 }
    );
  }
}
