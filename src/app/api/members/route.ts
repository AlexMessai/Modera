import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import {
  isMembershipStatus,
  listMembers
} from "@/server/services/member-service";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
  const search = url.searchParams.get("search") ?? undefined;
  const chatId = url.searchParams.get("chatId") ?? undefined;
  const statusParam = url.searchParams.get("status") ?? undefined;

  if (chatId && !uuidSchema.safeParse(chatId).success) {
    return Response.json(
      { error: { code: "INVALID_CHAT_ID", message: "Некорректный идентификатор чата." } },
      { status: 400 }
    );
  }

  if (statusParam && !isMembershipStatus(statusParam)) {
    return Response.json(
      { error: { code: "INVALID_MEMBER_STATUS", message: "Некорректный статус участника." } },
      { status: 400 }
    );
  }

  const result = await listMembers({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 25,
    search,
    chatId,
    status: statusParam && isMembershipStatus(statusParam) ? statusParam : undefined
  });

  return Response.json({ data: result });
}
