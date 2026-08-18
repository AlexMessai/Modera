import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageAdmins } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  AdminUserError,
  createAdminUser,
  listAdminUsers
} from "@/server/services/admin-user-service";

export const dynamic = "force-dynamic";

const roleSchema = z.enum(["OWNER", "ADMIN", "MODERATOR", "VIEWER"]);
const createSchema = z.object({
  email: z.string().trim().email().max(320),
  displayName: z.string().trim().min(1).max(120),
  role: roleSchema,
  password: z.string().min(12).max(200)
});

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

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageAdmins(auth.admin.role)) return forbidden();

  const data = await listAdminUsers();
  return Response.json({ data });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } },
      { status: 403 }
    );
  }

  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageAdmins(auth.admin.role)) return forbidden();

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Проверьте имя, email, роль и пароль администратора."
        }
      },
      { status: 400 }
    );
  }

  try {
    const data = await createAdminUser({
      actingAdminId: auth.admin.id,
      ...parsed.data
    });
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminUserError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.httpStatus }
      );
    }
    return Response.json(
      { error: { code: "ADMIN_CREATE_FAILED", message: "Не удалось создать администратора." } },
      { status: 500 }
    );
  }
}
