import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import {
  createCustomCommand,
  CustomCommandError,
  listCustomCommands
} from "@/server/services/custom-command-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  trigger: z.string().min(1).max(32),
  responseText: z.string().min(1).max(1000),
  adminOnly: z.boolean(),
  enabled: z.boolean()
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const commands = await listCustomCommands(id);
  return Response.json({ data: commands });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } }, { status: 403 });
  }
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json({ error: { code: "FORBIDDEN", message: "Изменять команды могут только владелец и администратор Modera." } }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "Проверьте название и текст ответа." } }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const command = await createCustomCommand({ chatId: id, actingAdminId: auth.admin.id, ...parsed.data });
    return Response.json({ data: command });
  } catch (error) {
    if (error instanceof CustomCommandError) {
      return Response.json({ error: { code: error.code, message: error.message } }, { status: 400 });
    }
    return Response.json({ error: { code: "UNKNOWN", message: "Не удалось создать команду." } }, { status: 500 });
  }
}
