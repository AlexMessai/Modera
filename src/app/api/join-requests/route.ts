import { requireAdminApi, requireChatAccess } from "@/server/auth/guards";
import { listChatsForAdmin } from "@/server/services/chat-admin-access-service";
import { listJoinRequests } from "@/server/services/join-request-service";

export const dynamic = "force-dynamic";

const statuses = new Set(["PENDING", "APPROVED", "DECLINED"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "50") || 50));
  const rawStatus = url.searchParams.get("status") ?? "PENDING";
  const status = statuses.has(rawStatus)
    ? (rawStatus as "PENDING" | "APPROVED" | "DECLINED")
    : "PENDING";
  const chatId = url.searchParams.get("chatId") || undefined;
  if (chatId && !UUID_PATTERN.test(chatId)) {
    return Response.json(
      { error: { code: "INVALID_CHAT", message: "Некорректный идентификатор чата." } },
      { status: 400 }
    );
  }
  const visibleChatIds = await listChatsForAdmin(auth.admin.id);
  if (chatId && visibleChatIds !== null) {
    const access = await requireChatAccess(auth.admin, chatId);
    if (!access.ok) return access.response;
  }

  const data = await listJoinRequests({
    page,
    pageSize,
    status,
    chatId,
    search: url.searchParams.get("search") || undefined,
    visibleChatIds
  });

  return Response.json({ data });
}
