import { requireAdminApi, requireChatAccess } from "@/server/auth/guards";
import { listChatsForAdmin } from "@/server/services/chat-admin-access-service";
import {
  isMessageState,
  isMessageType,
  listMessages
} from "@/server/services/message-service";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
  const typeValue = url.searchParams.get("type")?.trim() || undefined;
  const stateValue = url.searchParams.get("state")?.trim() || "ALL";
  const chatId = url.searchParams.get("chatId")?.trim() || undefined;

  if (typeValue && !isMessageType(typeValue)) {
    return Response.json(
      { error: { code: "INVALID_TYPE", message: "Неизвестный тип сообщения." } },
      { status: 400 }
    );
  }
  if (!isMessageState(stateValue)) {
    return Response.json(
      { error: { code: "INVALID_STATE", message: "Неизвестное состояние сообщения." } },
      { status: 400 }
    );
  }
  if (chatId && !UUID_PATTERN.test(chatId)) {
    return Response.json(
      { error: { code: "INVALID_CHAT", message: "Некорректный идентификатор чата." } },
      { status: 400 }
    );
  }

  const type = typeValue && isMessageType(typeValue) ? typeValue : undefined;
  const visibleChatIds = await listChatsForAdmin(auth.admin.id);
  if (chatId && visibleChatIds !== null) {
    const access = await requireChatAccess(auth.admin, chatId);
    if (!access.ok) return access.response;
  }

  const data = await listMessages({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    search: url.searchParams.get("search")?.trim() || undefined,
    sender: url.searchParams.get("sender")?.trim() || undefined,
    chatId,
    type,
    state: stateValue,
    dateFrom: url.searchParams.get("dateFrom")?.trim() || undefined,
    dateTo: url.searchParams.get("dateTo")?.trim() || undefined,
    visibleChatIds
  });

  return Response.json({ data });
}
