import { z } from "zod";
import { requireModerationApi } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/http/origin";
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

  const auth = await requireModerationApi();
  if (!auth.ok) return auth.response;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Выберите решение по апелляции." } },
      { status: 400 }
    );
  }

  const { id } = await context.params;
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
