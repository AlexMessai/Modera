import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { closeExpiredRaidIncidents, processAntiRaidSignal } from "./anti-raid-service";
import { resolveEffectiveAntiRaidSettings } from "./anti-raid-settings-service";

const CHAT_ID = -1009000011001n;
const USER_IDS = [9000011001n, 9000011002n, 9000011003n];

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: { in: USER_IDS } } });
}

test("anti-raid defaults are disabled and threshold creates one durable incident", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Anti-Raid CI", type: "supergroup" }
  });

  try {
    const defaults = await resolveEffectiveAntiRaidSettings(chat.id);
    assert.equal(defaults.settings.enabled, false);
    assert.equal(defaults.settings.joinThreshold, 10);

    await prisma.chatAntiRaidSettings.create({
      data: {
        chatId: chat.id,
        enabled: true,
        joinThreshold: 3,
        windowSeconds: 60,
        protectionDurationMinutes: 30,
        mode: "ALERT",
        newMemberMuteMinutes: 10
      }
    });

    const base = new Date("2026-08-18T12:00:00.000Z");
    const users = [];
    for (let index = 0; index < USER_IDS.length; index += 1) {
      const user = await prisma.telegramUser.create({
        data: {
          telegramUserId: USER_IDS[index],
          firstName: `Raid ${index + 1}`,
          displayName: `Raid ${index + 1}`
        }
      });
      users.push(user);
      const joinedAt = new Date(base.getTime() + index * 5000);
      await prisma.chatMember.create({
        data: {
          chatId: chat.id,
          userId: user.id,
          status: "MEMBER",
          joinedAt,
          firstSeenAt: joinedAt,
          lastSeenAt: joinedAt
        }
      });
      await prisma.joinRequest.create({
        data: {
          chatId: chat.id,
          userId: user.id,
          telegramUpdateId: 9900000n + BigInt(index),
          status: "APPROVED",
          requestedAt: joinedAt
        }
      });
    }

    const occurredAt = new Date(base.getTime() + 20_000);
    const first = await processAntiRaidSignal({
      chatId: chat.id,
      kind: "JOIN",
      occurredAt
    });

    assert.equal(first.enabled, true);
    assert.ok(first.incident);
    assert.equal(first.incident.signalCount, 3);
    assert.equal(first.incident.joinCount, 3);
    assert.equal(first.incident.joinRequestCount, 3);

    const second = await processAntiRaidSignal({
      chatId: chat.id,
      kind: "JOIN_REQUEST",
      occurredAt: new Date(occurredAt.getTime() + 1000)
    });
    assert.equal(second.incident?.id, first.incident.id);
    assert.equal(await prisma.raidIncident.count({ where: { chatId: chat.id, status: "ACTIVE" } }), 1);

    const startAudit = await prisma.auditLog.findFirst({
      where: { chatId: chat.id, action: "RAID_STARTED" }
    });
    assert.ok(startAudit);

    const afterExpiry = new Date(new Date(first.incident.activeUntil).getTime() + 1000);
    assert.equal(await closeExpiredRaidIncidents(chat.id, afterExpiry), 1);
    assert.equal(await prisma.raidIncident.count({ where: { chatId: chat.id, status: "ACTIVE" } }), 0);
    assert.equal(await prisma.raidIncident.count({ where: { chatId: chat.id, status: "ENDED" } }), 1);

    const endAudit = await prisma.auditLog.findFirst({
      where: { chatId: chat.id, action: "RAID_ENDED" }
    });
    assert.ok(endAudit);
  } finally {
    await cleanup();
  }
});