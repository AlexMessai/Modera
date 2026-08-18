import { z } from "zod";
import { requireAdminApi, requireModerationApi } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/http/origin";
import { decideModerationIncident, getModerationIncident, IncidentError } from "@/server/services/moderation-incident-service";

export const dynamic = "force-dynamic";

const decisionSchema = z.object({
  action: z.enum(["REVIEW", "SKIP", "FALSE_POSITIVE", "RESOLVE", "DELETE_MESSAGE", "WARNING", "MUTE", "BAN", "UNBAN", "NOTE"]),
  reason: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
  muteDurationMinutes: z.number().int().min(1).max(10080).nullable().optional()
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await context.params;
    return Response.json({ data: await getModerationIncident(id) });
  } catch (error) {
    if (error instanceof IncidentError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
    return Response.json({ error: { code: "INCIDENT_LOAD_FAILED", message: "Не удалось загрузить инцидент." } }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  const auth = await requireModerationApi();
  if (!auth.ok) return auth.response;
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте действие, причину и срок." } }, { status: 400 });
  try {
    const { id } = await context.params;
    const result = await decideModerationIncident({ id, actingAdminId: auth.admin.id, ...parsed.data });
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof IncidentError || (error instanceof Error && "httpStatus" in error)) {
      const known = error as Error & { code?: string; httpStatus: number };
      return Response.json({ error: { code: known.code ?? "INCIDENT_ACTION_FAILED", message: known.message } }, { status: known.httpStatus });
    }
    return Response.json({ error: { code: "INCIDENT_ACTION_FAILED", message: "Не удалось выполнить действие." } }, { status: 500 });
  }
}
