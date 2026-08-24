import { z } from "zod";
import { requireAdminApi, requireGlobalAdminAccess } from "@/server/auth/guards";
import { canManageAdmins } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  AdminUserError,
  updateAdminUser
} from "@/server/services/admin-user-service";

export const dynamic = "force-dynamic";

const roleSchema = z.enum(["OWNER", "ADMIN", "MODERATOR", "VIEWER"]);
const updateSchema = z.object({
  email: z.string().trim().email().max(320).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
  newPassword: z.string().min(12).max(200).optional()
}).refine(
  (value) => Object.values(value).some((item) => item !== undefined),
  { message: "Нет изменений" }
);

function forbidden() {
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
  const globalAccess = requireGlobalAdminAccess(auth.admin);
  if (!globalAccess.ok) return globalAccess.response;
  if (!canManageAdmins(auth.admin.role)) return forbidden();

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Проверьте изменённые данные." } },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  try {
    const data = await updateAdminUser({
      actingAdminId: auth.admin.id,
      targetAdminId: id,
      ...parsed.data
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
      { error: { code: "ADMIN_UPDATE_FAILED", message: "Не удалось обновить администратора." } },
      { status: 500 }
    );
  }
}
