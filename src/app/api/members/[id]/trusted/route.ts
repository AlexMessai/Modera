import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { canManageChatSettings } from "@/server/auth/permissions";
import { isSameOrigin } from "@/server/http/origin";
import { setTrustedMember } from "@/server/services/trusted-member-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ trusted: z.boolean() });

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } },
      { status: 403 }
    );
  }

  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;
  if (!canManageChatSettings(auth.admin.role)) {
    return Response.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Управлять исключениями могут только владелец и администратор Modera."
        }
      },
      { status: 403 }
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Некорректное состояние исключения." } },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  const result = await setTrustedMember({
    membershipId: id,
    actingAdminId: auth.admin.id,
    trusted: parsed.data.trusted
  });

  if (!result) {
    return Response.json(
      { error: { code: "MEMBER_NOT_FOUND", message: "Участник не найден." } },
      { status: 404 }
    );
  }
  if ("error" in result) {
    return Response.json(
      { error: { code: result.error, message: "Telegram-ботам исключение не требуется." } },
      { status: 409 }
    );
  }

  return Response.json({ data: result });
}