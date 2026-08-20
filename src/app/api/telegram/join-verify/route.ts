import { z } from "zod";
import { isSameOrigin } from "@/server/http/origin";
import { JoinRequestMiniAppError, resolveJoinRequestFromMiniApp } from "@/server/services/join-request-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  initData: z.string().min(1)
});

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Некорректные данные." } }, { status: 400 });
  }

  try {
    const result = await resolveJoinRequestFromMiniApp(parsed.data.initData);
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof JoinRequestMiniAppError) {
      const status = error.code === "USER_MISMATCH" ? 403 : error.code === "JOIN_REQUEST_NOT_FOUND" ? 404 : 400;
      return Response.json({ error: { code: error.code, message: error.message } }, { status });
    }
    return Response.json(
      { error: { code: "UNEXPECTED_ERROR", message: "Не удалось обработать заявку." } },
      { status: 500 }
    );
  }
}
