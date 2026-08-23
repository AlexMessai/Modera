import { requireAdminApi, requireChatAccess } from "@/server/auth/guards";
import {
  isJournalCategory,
  listModerationJournal
} from "@/server/services/journal-service";
import { listChatsForAdmin } from "@/server/services/chat-admin-access-service";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
  const categoryValue = url.searchParams.get("category") ?? "ALL";
  const chatIdValue = url.searchParams.get("chatId")?.trim() || undefined;
  const search = url.searchParams.get("search")?.trim() || undefined;

  if (!isJournalCategory(categoryValue)) {
    return Response.json(
      { error: { code: "INVALID_CATEGORY", message: "Неизвестный фильтр журнала." } },
      { status: 400 }
    );
  }

  if (chatIdValue && !UUID_PATTERN.test(chatIdValue)) {
    return Response.json(
      { error: { code: "INVALID_CHAT", message: "Некорректный идентификатор чата." } },
      { status: 400 }
    );
  }

  // /incidents is a cross-chat aggregate: a CHAT-scoped admin only sees their
  // own chats (visibleChatIds), and an explicit ?chatId= for the client-side
  // filter dropdown must itself pass the same honest-404 access check --
  // otherwise it would bypass the aggregate scoping entirely.
  const visibleChatIds = await listChatsForAdmin(auth.admin.id);
  if (chatIdValue && visibleChatIds !== null) {
    const access = await requireChatAccess(auth.admin, chatIdValue);
    if (!access.ok) return access.response;
  }

  const result = await listModerationJournal({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    category: categoryValue,
    chatId: chatIdValue,
    search,
    visibleChatIds
  });

  return Response.json({ data: result });
}
