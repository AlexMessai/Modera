import { requireAdminApi } from "@/server/auth/guards";
import { listAppeals } from "@/server/services/appeal-service";

export const dynamic = "force-dynamic";

const statuses = new Set(["PENDING", "APPROVED", "REJECTED"]);

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") ?? "50") || 50));
  const rawStatus = url.searchParams.get("status") ?? "PENDING";
  const status = statuses.has(rawStatus)
    ? (rawStatus as "PENDING" | "APPROVED" | "REJECTED")
    : "PENDING";

  const data = await listAppeals({
    page,
    pageSize,
    status,
    chatId: url.searchParams.get("chatId") || undefined
  });

  return Response.json({ data });
}
