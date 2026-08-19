import { requireAdminApi } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/http/origin";
import { createLinkCode } from "@/server/services/admin-link-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } },
      { status: 403 }
    );
  }

  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { code, expiresAt } = await createLinkCode(auth.admin.id);
  return Response.json({ data: { code, expiresAt: expiresAt.toISOString() } });
}
