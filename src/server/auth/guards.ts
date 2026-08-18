import { redirect } from "next/navigation";
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
