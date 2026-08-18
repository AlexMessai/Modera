import { requireAdminApi } from "@/server/auth/guards";
import { getAntiRaidOverview } from "@/server/services/anti-raid-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  return Response.json({ data: await getAntiRaidOverview() });
}