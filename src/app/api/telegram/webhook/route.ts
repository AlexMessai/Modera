import { timingSafeEqual } from "node:crypto";
import { processTelegramUpdate } from "@/server/telegram/update-handler";
import type { TelegramUpdate } from "@/server/telegram/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeCompare(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return Response.json(
      { error: { code: "WEBHOOK_NOT_CONFIGURED", message: "Webhook не настроен." } },
      { status: 503 }
    );
  }

  const incomingSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeCompare(incomingSecret, configuredSecret)) {
    return Response.json(
      { error: { code: "INVALID_WEBHOOK_SECRET", message: "Недопустимый webhook-запрос." } },
      { status: 401 }
    );
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json(
      { error: { code: "INVALID_JSON", message: "Некорректное тело запроса." } },
      { status: 400 }
    );
  }

  try {
    const result = await processTelegramUpdate(update);
    return Response.json({ data: result });
  } catch {
    return Response.json(
      { error: { code: "TELEGRAM_UPDATE_FAILED", message: "Не удалось обработать событие Telegram." } },
      { status: 500 }
    );
  }
}
