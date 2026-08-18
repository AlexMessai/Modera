import { redirect } from "next/navigation";
import { canModerate } from "@/server/auth/permissions";
import { getCurrentAdmin } from "@/server/auth/session";

export async function requireAdminPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/login");
  return admin;
}

export async function requireAdminApi() {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return {
      ok: false as const,
      response: Response.json(
        { error: { code: "UNAUTHORIZED", message: "Требуется авторизация." } },
        { status: 401 }
      )
    };
  }

  return { ok: true as const, admin };
}

export async function requireModerationApi() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth;

  if (!canModerate(auth.admin.role)) {
    return {
      ok: false as const,
      response: Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "У вашей роли нет прав на действия модерации."
          }
        },
        { status: 403 }
      )
    };
  }

  return { ok: true as const, admin: auth.admin };
}
