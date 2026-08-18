import { requireAdminApi } from "@/server/auth/guards";
import { listJoinRequests } from "@/server/services/join-request-service";

export const dynamic = "force-dynamic";

const statuses = new Set(["PENDING", "APPROVED", "DECLINED"]);

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

  const data = await listJoinRequests({
    page,
    pageSize,
    status,
    chatId: url.searchParams.get("chatId") || undefined,
    search: url.searchParams.get("search") || undefined
  });

  return Response.json({ data });
}