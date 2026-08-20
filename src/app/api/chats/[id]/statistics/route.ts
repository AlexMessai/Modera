import { requireAdminApi } from "@/server/auth/guards";
import { getChatStatistics } from "@/server/services/chat-statistics-service";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/server/services/dashboard-service";

export const dynamic = "force-dynamic";

function isDashboardPeriod(value: string): value is DashboardPeriod {
  return DASHBOARD_PERIODS.includes(value as DashboardPeriod);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const rawPeriod = url.searchParams.get("period") ?? "7D";
  const period = isDashboardPeriod(rawPeriod) ? rawPeriod : "7D";

  const { id } = await context.params;
  const stats = await getChatStatistics(id, period);
  if (!stats) {
    return Response.json({ error: { code: "CHAT_NOT_FOUND", message: "Чат не найден." } }, { status: 404 });
  }
  return Response.json({ data: stats });
}
