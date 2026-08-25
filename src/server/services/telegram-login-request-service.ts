import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/server/db/prisma";
import { resolveOrCreateAdminFromTelegramIdentity } from "@/server/services/admin-user-service";

const TOKEN_TTL_MS = 5 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createTelegramLoginRequest() {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await prisma.telegramLoginRequest.create({
    data: { tokenHash: hashToken(token), expiresAt }
  });
  return { token, expiresAt };
}

/**
 * Called from the bot's /start login_<token> handler (update-handler.ts) --
 * single-use: only ever matches a row still PENDING and unexpired, so a second
 * /start with the same token (retry, or the deep link opened twice) is a no-op
 * that falls through to the "not_found" status the poller already handles.
 */
export async function resolveTelegramLoginRequest(
  token: string,
  telegramUser: { id: number; username?: string; firstName?: string; lastName?: string }
) {
  const request = await prisma.telegramLoginRequest.findFirst({
    where: { tokenHash: hashToken(token), status: "PENDING", expiresAt: { gt: new Date() } }
  });
  if (!request) return { outcome: "not_found" as const };

  const resolution = await resolveOrCreateAdminFromTelegramIdentity(telegramUser);

  if (resolution.outcome === "ok") {
    await prisma.telegramLoginRequest.update({
      where: { id: request.id },
      data: { status: "COMPLETED", resolvedAdminId: resolution.admin.id }
    });
    return { outcome: "ok" as const };
  }

  await prisma.telegramLoginRequest.update({
    where: { id: request.id },
    data: { status: "FAILED", errorCode: resolution.outcome }
  });
  return { outcome: resolution.outcome };
}

export type TelegramLoginStatus =
  | { status: "pending" }
  | { status: "completed"; adminId: string }
  | { status: "failed"; errorCode: string | null }
  | { status: "not_found" };

export async function getTelegramLoginRequestStatus(token: string): Promise<TelegramLoginStatus> {
  const request = await prisma.telegramLoginRequest.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!request) return { status: "not_found" };
  if (request.status === "COMPLETED" && request.resolvedAdminId) return { status: "completed", adminId: request.resolvedAdminId };
  if (request.status === "FAILED") return { status: "failed", errorCode: request.errorCode };
  if (request.expiresAt <= new Date()) return { status: "not_found" };
  return { status: "pending" };
}
