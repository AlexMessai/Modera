import { z } from "zod";
import { requireAdminApi, requireChatAccess } from "@/server/auth/guards";
import { isSameOrigin } from "@/server/http/origin";
import {
  getMemberTagState,
  MemberTagError,
  updateTelegramMemberTag
} from "@/server/services/member-tag-service";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const bodySchema = z.object({ tag: z.string().max(64).nullable() });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return Response.json(
      { error: { code: "INVALID_MEMBER_ID", message: "Некорректный идентификатор участника." } },
      { status: 400 }
    );
  }

  const state = await getMemberTagState(id);
  if (!state) {
    return Response.json(
      { error: { code: "MEMBER_NOT_FOUND", message: "Участник не найден." } },
      { status: 404 }
    );
  }

  const access = await requireChatAccess(auth.admin, state.chatId);
  if (!access.ok) return access.response;

  return Response.json({
    data: {
      membershipId: state.membershipId,
      status: state.status,
      telegramCustomTitle: state.telegramCustomTitle,
      tag: state.tag,
      tagUpdatedAt: state.tagUpdatedAt,
      editable: state.editable
    }
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: { code: "INVALID_ORIGIN", message: "Запрос отклонён." } },
      { status: 403 }
    );
  }

  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return Response.json(
      { error: { code: "INVALID_MEMBER_ID", message: "Некорректный идентификатор участника." } },
      { status: 400 }
    );
  }

  const state = await getMemberTagState(id);
  if (!state) {
    return Response.json(
      { error: { code: "MEMBER_NOT_FOUND", message: "Участник не найден." } },
      { status: 404 }
    );
  }
  const access = await requireChatAccess(auth.admin, state.chatId);
  if (!access.ok) return access.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Передайте корректный Telegram-тег." } },
      { status: 400 }
    );
  }

  try {
    const result = await updateTelegramMemberTag({
      membershipId: id,
      actingAdminId: auth.admin.id,
      tag: parsed.data.tag
    });
    return Response.json({ data: result });
  } catch (error) {
    if (error instanceof MemberTagError) {
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }
    throw error;
  }
}
