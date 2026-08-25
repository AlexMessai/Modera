import { isSameOrigin } from "@/server/http/origin";
import { prisma } from "@/server/db/prisma";
import { createAdminSession } from "@/server/auth/session";
import { getTelegramLoginRequestStatus } from "@/server/services/telegram-login-request-service";

// GET, but gated the same as a mutating route -- a "completed" result sets the
// session cookie as a side effect, so an off-origin poll must not be able to do that.
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }

  const { token } = await context.params;
  const result = await getTelegramLoginRequestStatus(token);

  if (result.status === "completed") {
    await prisma.adminUser.update({ where: { id: result.adminId }, data: { lastLoginAt: new Date() } });
    await createAdminSession({
      adminId: result.adminId,
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: request.headers.get("user-agent")
    });
    return Response.json({ data: { status: "completed" } });
  }

  if (result.status === "failed") {
    return Response.json({ data: { status: "failed", errorCode: result.errorCode } });
  }

  if (result.status === "not_found") {
    return Response.json({ data: { status: "not_found" } });
  }

  return Response.json({ data: { status: "pending" } });
}
