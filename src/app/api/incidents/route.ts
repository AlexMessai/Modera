import { requireAdminApi } from "@/server/auth/guards";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, listModerationIncidents } from "@/server/services/moderation-incident-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const status = params.get("status") || undefined;
  const severity = params.get("severity") || undefined;
  const page = Number(params.get("page") ?? "1");
  const pageSize = Number(params.get("pageSize") ?? "50");

  const data = await listModerationIncidents({
    page: Number.isFinite(page) ? page : 1,
    pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    status: INCIDENT_STATUSES.includes(status as (typeof INCIDENT_STATUSES)[number]) ? status as (typeof INCIDENT_STATUSES)[number] : undefined,
    severity: INCIDENT_SEVERITIES.includes(severity as (typeof INCIDENT_SEVERITIES)[number]) ? severity as (typeof INCIDENT_SEVERITIES)[number] : undefined,
    chatId: params.get("chatId") || undefined,
    type: params.get("type") || undefined,
    search: params.get("search") || undefined
  });
  return Response.json({ data });
}
