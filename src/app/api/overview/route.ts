import { requireAdminApi } from "@/server/auth/guards";
import { listChatsForAdmin } from "@/server/services/chat-admin-access-service";
import {
  DASHBOARD_PERIODS,
  getDashboardData,
  type DashboardPeriod
} from "@/server/services/dashboard-service";

export const dynamic = "force-dynamic";

function isDashboardPeriod(value: string): value is DashboardPeriod {
  return DASHBOARD_PERIODS.includes(value as DashboardPeriod);
}

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const rawPeriod = url.searchParams.get("period") ?? "7D";
  const period = isDashboardPeriod(rawPeriod) ? rawPeriod : "7D";

  const visibleChatIds = await listChatsForAdmin(auth.admin.id);
  return Response.json({ data: await getDashboardData(period, visibleChatIds) });
}
