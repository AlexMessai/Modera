import { requireAdminApi } from "@/server/auth/guards";
import { listChats } from "@/server/services/chat-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
  const search = url.searchParams.get("search") ?? undefined;
  const result = await listChats({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 25,
    search
  });

  return Response.json({ data: result });
}
