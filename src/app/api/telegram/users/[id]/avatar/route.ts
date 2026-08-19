import { z } from "zod";
import { requireAdminApi } from "@/server/auth/guards";
import { getTelegramUserAvatar } from "@/server/services/telegram-avatar-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const uuidSchema = z.string().uuid();

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
  })[character] ?? character);
}

function fallbackAvatar(displayName: string) {
  const initial = Array.from(displayName.trim())[0]?.toUpperCase() || "?";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${escapeXml(displayName)}"><rect width="96" height="96" rx="24" fill="#e9edf5"/><text x="48" y="52" text-anchor="middle" dominant-baseline="middle" fill="#394150" font-family="system-ui,sans-serif" font-size="38" font-weight="700">${escapeXml(initial)}</text></svg>`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    return Response.json(
      { error: { code: "INVALID_USER_ID", message: "Некорректный идентификатор пользователя." } },
      { status: 400 }
    );
  }

  const avatar = await getTelegramUserAvatar(id);
  if (!avatar) {
    return Response.json(
      { error: { code: "USER_NOT_FOUND", message: "Пользователь не найден." } },
      { status: 404 }
    );
  }

  if (avatar.kind === "image") {
    return new Response(avatar.bytes, {
      headers: {
        "content-type": avatar.contentType,
        "cache-control": "private, max-age=3600, stale-while-revalidate=86400",
        "x-modera-avatar-source": "telegram"
      }
    });
  }

  return new Response(fallbackAvatar(avatar.displayName), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, no-store",
      "x-modera-avatar-source": "fallback"
    }
  });
}
