import { z } from "zod";
import { requireModerationApi } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/http/origin";
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

  const auth = await requireModerationApi();
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Выберите действие с заявкой." } },
      { status: 400 }
    );
  }

  const { id } = await context.params;
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