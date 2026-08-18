import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/server/db/prisma";

export const SESSION_COOKIE = "modera_session";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionTtlMs() {
  const days = Number(process.env.SESSION_TTL_DAYS ?? "14");
  const safeDays = Number.isFinite(days) && days > 0 ? days : 14;
  return safeDays * 24 * 60 * 60 * 1000;
}

export async function createAdminSession(input: {
  adminId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + sessionTtlMs());

  await prisma.adminSession.create({
    data: {
      adminId: input.adminId,
      tokenHash,
      expiresAt,
      ipAddress: input.ipAddress || null,
      userAgent: input.userAgent || null
    }
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    priority: "high"
  });
}

export async function deleteCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.adminSession.deleteMany({
      where: { tokenHash: hashToken(token) }
    });
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const now = new Date();
  const session = await prisma.adminSession.findFirst({
    where: {
      tokenHash: hashToken(token),
      expiresAt: { gt: now },
      admin: { isActive: true }
    },
    include: {
      admin: true
    }
  });

  if (!session) return null;

  void prisma.adminSession.update({
    where: { id: session.id },
    data: { lastSeenAt: now }
  }).catch(() => undefined);

  return session.admin;
}
