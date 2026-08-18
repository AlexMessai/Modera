import { requireAdminApi } from "@/server/auth/guards";
import {
  isJournalCategory,
  listModerationJournal
} from "@/server/services/journal-service";

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

  const result = await listModerationJournal({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    category: categoryValue,
    chatId: chatIdValue,
    search
  });

  return Response.json({ data: result });
}
