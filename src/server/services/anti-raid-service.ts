import { prisma } from "@/server/db/prisma";
import { resolveEffectiveAntiRaidSettings } from "@/server/services/anti-raid-settings-service";
import { startSilence } from "@/server/services/silence-service";

/** Best-effort chat lockdown for an active raid -- reuses /silence's own setChatPermissions
 * mechanism and expiry cron, so a stuck Telegram call here never blocks raid detection itself. */
async function lockChatForRaid(chatId: string, telegramChatId: number, cooldownMinutes: number) {
  await startSilence({ chatId, telegramChatId, durationMinutes: cooldownMinutes, source: "SYSTEM" }).catch(() => undefined);
}

/**
 * Called on every new-member join (update-handler.ts, alongside the CAPTCHA
 * trigger). Counts joins in the trailing `windowSeconds` using
 * ChatMember.joinedAt (already tracked for every membership — no separate
 * join-events table needed) and opens/updates a RaidIncident once the count
 * crosses `joinThreshold`.
 */
export async function evaluateRaidOnJoin(input: { chatId: string; telegramChatId: number; at: Date }): Promise<{
  raidActive: boolean;
  justStarted: boolean;
  incidentId?: string;
}> {
  const resolved = await resolveEffectiveAntiRaidSettings(input.chatId);
  const settings = resolved.settings;
  if (!settings.enabled) return { raidActive: false, justStarted: false };

  const windowStart = new Date(input.at.getTime() - settings.windowSeconds * 1000);
  const recentJoins = await prisma.chatMember.count({
    where: { chatId: input.chatId, joinedAt: { gte: windowStart } }
  });

  const active = await prisma.raidIncident.findFirst({
    where: { chatId: input.chatId, status: "ACTIVE" }
  });

  if (recentJoins >= settings.joinThreshold) {
    if (active) {
      const updated = await prisma.raidIncident.update({
        where: { id: active.id },
        data: {
          lastJoinAt: input.at,
          peakJoinCount: Math.max(active.peakJoinCount, recentJoins)
        }
      });
      // Re-applied on every join while the raid stays active, extending the
      // lock's expiry so it tracks cooldownMinutes instead of lapsing mid-raid.
      if (settings.lockChat) await lockChatForRaid(input.chatId, input.telegramChatId, settings.cooldownMinutes);
      return { raidActive: true, justStarted: false, incidentId: updated.id };
    }

    const created = await prisma.$transaction(async (tx) => {
      const incident = await tx.raidIncident.create({
        data: { chatId: input.chatId, lastJoinAt: input.at, peakJoinCount: recentJoins }
      });
      await tx.auditLog.create({
        data: {
          chatId: input.chatId,
          source: "SYSTEM",
          action: "ANTI_RAID_STARTED",
          reason: `Обнаружен наплыв участников: ${recentJoins} за ${settings.windowSeconds} сек.`,
          metadata: {
            raidIncidentId: incident.id,
            joinCount: recentJoins,
            windowSeconds: settings.windowSeconds,
            joinThreshold: settings.joinThreshold,
            forceCaptcha: settings.forceCaptcha,
            lockChat: settings.lockChat
          }
        }
      });
      return incident;
    });
    if (settings.lockChat) await lockChatForRaid(input.chatId, input.telegramChatId, settings.cooldownMinutes);
    return { raidActive: true, justStarted: true, incidentId: created.id };
  }

  // Below threshold right now, but an already-active incident isn't cleared
  // here — only the cooldown sweep (processStaleRaidIncidents) resolves it,
  // so a brief lull mid-raid doesn't prematurely lift mitigation.
  if (active) return { raidActive: true, justStarted: false, incidentId: active.id };
  return { raidActive: false, justStarted: false };
}

/** Whether new joiners in this chat should be forced through CAPTCHA right now because of an active raid. */
export async function isRaidForcingCaptcha(chatId: string): Promise<boolean> {
  const resolved = await resolveEffectiveAntiRaidSettings(chatId);
  if (!resolved.settings.enabled || !resolved.settings.forceCaptcha) return false;
  const active = await prisma.raidIncident.findFirst({
    where: { chatId, status: "ACTIVE" },
    select: { id: true }
  });
  return Boolean(active);
}

/**
 * Daily-cron sweep (same cadence as captcha timeout / mute expiry, see
 * docs/STAGE_2.md's documented "no more-frequent cron on the free plan"
 * limitation) — resolves any ACTIVE incident whose chat has gone quiet for
 * longer than its own cooldownMinutes.
 */
export async function processStaleRaidIncidents(input?: { now?: Date; limit?: number }) {
  const now = input?.now ?? new Date();
  const limit = Math.min(200, Math.max(1, input?.limit ?? 50));

  const candidates = await prisma.raidIncident.findMany({
    where: { status: "ACTIVE" },
    orderBy: { lastJoinAt: "asc" },
    take: limit,
    select: { id: true, chatId: true, lastJoinAt: true, peakJoinCount: true, startedAt: true }
  });

  let resolved = 0;
  for (const incident of candidates) {
    const { settings } = await resolveEffectiveAntiRaidSettings(incident.chatId);
    const cooldownDeadline = new Date(incident.lastJoinAt.getTime() + settings.cooldownMinutes * 60_000);
    if (cooldownDeadline > now) continue;

    await prisma.$transaction([
      prisma.raidIncident.update({
        where: { id: incident.id },
        data: { status: "RESOLVED", resolvedAt: now }
      }),
      prisma.auditLog.create({
        data: {
          chatId: incident.chatId,
          source: "SYSTEM",
          action: "ANTI_RAID_RESOLVED",
          reason: "Активность новых участников вернулась к норме.",
          metadata: {
            raidIncidentId: incident.id,
            peakJoinCount: incident.peakJoinCount,
            durationMinutes: Math.round((now.getTime() - incident.startedAt.getTime()) / 60_000)
          }
        }
      })
    ]);
    resolved += 1;
  }

  return { checked: candidates.length, resolved, hasMore: candidates.length === limit };
}
