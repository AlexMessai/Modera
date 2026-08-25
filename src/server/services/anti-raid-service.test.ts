import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { evaluateRaidOnJoin, isRaidForcingCaptcha, processStaleRaidIncidents } from "./anti-raid-service";
import { DEFAULT_ANTI_RAID_SETTINGS, updateChatAntiRaidSettings } from "./anti-raid-settings-service";

const CHAT_ID = -1009000014001n;
const ADMIN_EMAIL = "anti-raid-service-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

async function fixtureJoin(chatId: string, telegramUserId: number, joinedAt: Date) {
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: BigInt(telegramUserId), firstName: "CI", displayName: `CI ${telegramUserId}` }
  });
  return prisma.chatMember.create({
    data: { chatId, userId: user.id, status: "MEMBER", joinedAt }
  });
}

test("evaluateRaidOnJoin opens an incident once joins cross the threshold, and isRaidForcingCaptcha reflects it", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Anti-Raid Service CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    await updateChatAntiRaidSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { ...DEFAULT_ANTI_RAID_SETTINGS, enabled: true, joinThreshold: 3, windowSeconds: 20, forceCaptcha: true }
    });

    const now = new Date();
    assert.equal(await isRaidForcingCaptcha(chat.id), false);

    // Below threshold: two joins inside the window doesn't open an incident.
    await fixtureJoin(chat.id, 900001001, now);
    await fixtureJoin(chat.id, 900001002, now);
    const belowThreshold = await evaluateRaidOnJoin({ chatId: chat.id, telegramChatId: Number(CHAT_ID), at: now });
    assert.equal(belowThreshold.raidActive, false);
    assert.equal(await isRaidForcingCaptcha(chat.id), false);

    // Third join crosses the threshold and opens an incident.
    await fixtureJoin(chat.id, 900001003, now);
    const crossed = await evaluateRaidOnJoin({ chatId: chat.id, telegramChatId: Number(CHAT_ID), at: now });
    assert.equal(crossed.raidActive, true);
    assert.equal(crossed.justStarted, true);
    assert.ok(crossed.incidentId);
    assert.equal(await isRaidForcingCaptcha(chat.id), true);

    const startedLog = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "ANTI_RAID_STARTED" } });
    assert.ok(startedLog);

    // A subsequent join below threshold does not clear the still-active incident.
    const lull = await evaluateRaidOnJoin({ chatId: chat.id, telegramChatId: Number(CHAT_ID), at: new Date(now.getTime() + 1000) });
    assert.equal(lull.raidActive, true);
    assert.equal(lull.justStarted, false);
    assert.equal(lull.incidentId, crossed.incidentId);
  } finally {
    await cleanup();
  }
});

test("processStaleRaidIncidents resolves an incident once its cooldown has elapsed, and not before", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Anti-Raid Service CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    await updateChatAntiRaidSettings({
      chatId: chat.id,
      actingAdminId: admin.id,
      settings: { ...DEFAULT_ANTI_RAID_SETTINGS, enabled: true, joinThreshold: 1, windowSeconds: 20, cooldownMinutes: 15 }
    });

    const lastJoinAt = new Date();
    const incident = await prisma.raidIncident.create({
      data: { chatId: chat.id, lastJoinAt, peakJoinCount: 5 }
    });

    const tooSoon = await processStaleRaidIncidents({ now: new Date(lastJoinAt.getTime() + 5 * 60_000) });
    assert.equal(tooSoon.resolved, 0);
    const stillActive = await prisma.raidIncident.findUnique({ where: { id: incident.id } });
    assert.equal(stillActive?.status, "ACTIVE");

    const afterCooldown = await processStaleRaidIncidents({ now: new Date(lastJoinAt.getTime() + 20 * 60_000) });
    assert.equal(afterCooldown.resolved, 1);
    const resolved = await prisma.raidIncident.findUnique({ where: { id: incident.id } });
    assert.equal(resolved?.status, "RESOLVED");

    const resolvedLog = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "ANTI_RAID_RESOLVED" } });
    assert.ok(resolvedLog);
  } finally {
    await cleanup();
  }
});
