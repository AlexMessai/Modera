import { requireAdminApi, requireGlobalAdminAccess } from "@/server/auth/guards";
import { canReconcileModeration } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  ModerationReconciliationError,
  reconcilePendingModerationActionLive
} from "@/server/services/moderation-reconciliation-service";

export const dynamic = "force-dynamic";

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
  const globalAccess = requireGlobalAdminAccess(auth.admin);
  if (!globalAccess.ok) return globalAccess.response;
  if (!canReconcileModeration(auth.admin.role)) {
    return Response.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Сверка системного состояния доступна только владельцу и администратору Modera."
        }
      },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  try {
    const result = await reconcilePendingModerationActionLive({
      actionId: id,
      actingAdminId: auth.admin.id
    });
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof ModerationReconciliationError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.httpStatus }
      );
    }
    return Response.json(
      {
        error: {
          code: "RECONCILIATION_FAILED",
          message: "Не удалось сверить действие с Telegram."
        }
      },
      { status: 500 }
    );
  }
}
