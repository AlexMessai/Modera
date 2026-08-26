import { isSameOrigin } from "@/server/http/origin";
import { createTelegramLoginRequest } from "@/server/services/telegram-login-request-service";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }

  const { token, expiresAt } = await createTelegramLoginRequest();
  return Response.json({ data: { token, expiresAt: expiresAt.toISOString() } });
}
