import { requireAdminApi } from "@/server/auth/guards";
import { canManageAdmins } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  AdminUserError,
  revokeAdminSessions
} from "@/server/services/admin-user-service";

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
  if (!canManageAdmins(auth.admin.role)) {
    return Response.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Управление администраторами доступно только владельцу."
        }
      },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  try {
    const data = await revokeAdminSessions({
      actingAdminId: auth.admin.id,
      targetAdminId: id
    });
    return Response.json({ data });
  } catch (error) {
    if (error instanceof AdminUserError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.httpStatus }
      );
    }
    return Response.json(
      { error: { code: "SESSION_REVOKE_FAILED", message: "Не удалось завершить сессии." } },
      { status: 500 }
    );
  }
}
