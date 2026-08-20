import crypto from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/prisma";

const LINK_CODE_TTL_MS = 15 * 60 * 1000;

export async function createLinkCode(adminId: string) {
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
  await prisma.adminUser.update({
    where: { id: adminId },
    data: { telegramLinkCode: code, telegramLinkCodeExpiresAt: expiresAt }
  });
  return { code, expiresAt };
}

export async function consumeLinkCode(code: string, telegramUser: { id: number; username?: string; firstName?: string }) {
  const admin = await prisma.adminUser.findFirst({
    where: { telegramLinkCode: code, telegramLinkCodeExpiresAt: { gt: new Date() } }
  });
  if (!admin) return { outcome: "invalid_code" as const };

  try {
    const updated = await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        telegramUserId: BigInt(telegramUser.id),
        telegramUsername: telegramUser.username ?? null,
        telegramFirstName: telegramUser.firstName ?? null,
        telegramLinkCode: null,
        telegramLinkCodeExpiresAt: null
      }
    });
    return { outcome: "linked" as const, admin: updated };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { outcome: "already_linked_elsewhere" as const };
    }
    throw error;
  }
}
