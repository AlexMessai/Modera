import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canModerate } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  deleteStoredMessage,
  MessageActionError
} from "@/server/services/message-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  reason: z.string().trim().min(2).max(500)
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
  if (!canModerate(auth.admin.role)) {
    return Response.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Удалять сообщения могут владелец, администратор и модератор."
        }
      },
      { status: 403 }
    );
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Укажите причину удаления." } },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  try {
    const result = await deleteStoredMessage({
      messageId: id,
      actingAdminId: auth.admin.id,
      reason: parsed.data.reason
    });
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof MessageActionError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.httpStatus }
      );
    }
    return Response.json(
      { error: { code: "MESSAGE_DELETE_FAILED", message: "Не удалось удалить сообщение." } },
      { status: 500 }
    );
  }
}
