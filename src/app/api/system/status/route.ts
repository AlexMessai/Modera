import { requireAdminApi } from "@/server/auth/guards";
import { canViewSystem } from "@/server/auth/permissions";
import { getSystemDiagnostics } from "@/server/services/system-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  if (!canViewSystem(auth.admin.role)) {
    return Response.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Системная диагностика доступна только владельцу и администраторам."
        }
      },
      { status: 403 }
    );
  }

  const data = await getSystemDiagnostics();
  return Response.json({ data });
}
