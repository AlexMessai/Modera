import { prisma } from "@/server/db/prisma";
import { executeExpiredMuteRelease, ModerationError } from "@/server/services/moderation-service";

export function isExpiredMuteCandidate(
  member: { punishmentState: string | null; punishmentExpiresAt: Date | null },
  now: Date
) {
  return member.punishmentState === "MUTED" &&
    Boolean(member.punishmentExpiresAt && member.punishmentExpiresAt <= now);
}

export async function processExpiredPunishments(input?: { now?: Date; limit?: number }) {
  const now = input?.now ?? new Date();
  const limit = Math.min(100, Math.max(1, input?.limit ?? 25));
  const candidates = await prisma.chatMember.findMany({
    where: {
      punishmentState: "MUTED",
      punishmentExpiresAt: { lte: now }
    },
    orderBy: { punishmentExpiresAt: "asc" },
    take: limit,
    select: { id: true }
  });

  let released = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates) {
    try {
      const result = await executeExpiredMuteRelease({ membershipId: candidate.id, now });
      if (result.outcome === "released") released += 1;
      else skipped += 1;
    } catch (error) {
      if (error instanceof ModerationError && error.code === "NOT_MUTED") skipped += 1;
      else failed += 1;
    }
  }

  return { checked: candidates.length, released, skipped, failed, hasMore: candidates.length === limit };
}
