import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { listAppeals } from "./appeal-service";
import { getDashboardData } from "./dashboard-service";
import { listJoinRequests } from "./join-request-service";
import { getMemberProfile, listMembers } from "./member-service";
import { listMessages } from "./message-service";

const CHAT_IDS = [-1009000017001n, -1009000017002n] as const;
const USER_ID = 900001701n;

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: { in: [...CHAT_IDS] } } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: USER_ID } });
}

test("cross-chat readers return only explicitly visible chats", async () => {
  await cleanup();
  const [visibleChat, hiddenChat] = await Promise.all([
    prisma.chat.create({
      data: { telegramChatId: CHAT_IDS[0], title: "Tenant Scope Visible CI", type: "supergroup" }
    }),
    prisma.chat.create({
      data: { telegramChatId: CHAT_IDS[1], title: "Tenant Scope Hidden CI", type: "supergroup" }
    })
  ]);
  const user = await prisma.telegramUser.create({
    data: { telegramUserId: USER_ID, firstName: "Tenant", displayName: "Tenant Scope User" }
  });
  const [visibleMember, hiddenMember] = await Promise.all([
    prisma.chatMember.create({
      data: { chatId: visibleChat.id, userId: user.id, status: "MEMBER" }
    }),
    prisma.chatMember.create({
      data: { chatId: hiddenChat.id, userId: user.id, status: "MEMBER" }
    })
  ]);
  const now = new Date("2026-08-24T12:00:00.000Z");

  try {
    await Promise.all([
      prisma.message.create({
        data: {
          chatId: visibleChat.id,
          senderUserId: user.id,
          telegramMessageId: 16001n,
          telegramDate: now,
          text: "visible",
          messageType: "TEXT"
        }
      }),
      prisma.message.create({
        data: {
          chatId: hiddenChat.id,
          senderUserId: user.id,
          telegramMessageId: 16002n,
          telegramDate: now,
          text: "hidden",
          messageType: "TEXT"
        }
      }),
      prisma.joinRequest.create({
        data: {
          chatId: visibleChat.id,
          userId: user.id,
          telegramUpdateId: 916001n,
          requestedAt: now
        }
      }),
      prisma.joinRequest.create({
        data: {
          chatId: hiddenChat.id,
          userId: user.id,
          telegramUpdateId: 916002n,
          requestedAt: now
        }
      }),
      prisma.auditLog.create({
        data: {
          chatId: visibleChat.id,
          affectedUserId: user.id,
          source: "SYSTEM",
          action: "TENANT_VISIBLE_TEST"
        }
      }),
      prisma.auditLog.create({
        data: {
          chatId: hiddenChat.id,
          affectedUserId: user.id,
          source: "SYSTEM",
          action: "TENANT_HIDDEN_TEST"
        }
      })
    ]);

    const [visibleWarning, hiddenWarning] = await Promise.all([
      prisma.moderationAction.create({
        data: {
          chatId: visibleChat.id,
          affectedUserId: user.id,
          source: "SYSTEM",
          type: "WARNING",
          status: "SUCCEEDED",
          completedAt: now
        }
      }),
      prisma.moderationAction.create({
        data: {
          chatId: hiddenChat.id,
          affectedUserId: user.id,
          source: "SYSTEM",
          type: "WARNING",
          status: "SUCCEEDED",
          completedAt: now
        }
      })
    ]);
    await Promise.all([
      prisma.appeal.create({
        data: {
          chatId: visibleChat.id,
          userId: user.id,
          moderationActionId: visibleWarning.id,
          message: "visible appeal"
        }
      }),
      prisma.appeal.create({
        data: {
          chatId: hiddenChat.id,
          userId: user.id,
          moderationActionId: hiddenWarning.id,
          message: "hidden appeal"
        }
      })
    ]);

    const visibleChatIds = [visibleChat.id];
    const [members, messages, joinRequests, appeals, profile, hiddenProfile, dashboard] = await Promise.all([
      listMembers({ page: 1, pageSize: 20, visibleChatIds }),
      listMessages({ page: 1, pageSize: 20, state: "ALL", visibleChatIds }),
      listJoinRequests({ page: 1, pageSize: 20, status: "PENDING", visibleChatIds }),
      listAppeals({ page: 1, pageSize: 20, status: "PENDING", visibleChatIds }),
      getMemberProfile(visibleMember.id, visibleChatIds),
      getMemberProfile(hiddenMember.id, visibleChatIds),
      getDashboardData("24H", visibleChatIds)
    ]);

    assert.deepEqual(members.items.map((item) => item.chat.id), [visibleChat.id]);
    assert.deepEqual(messages.items.map((item) => item.chat.id), [visibleChat.id]);
    assert.deepEqual(messages.chats.map((chat) => chat.id), [visibleChat.id]);
    assert.equal(joinRequests.pendingCount, 1);
    assert.deepEqual(joinRequests.items.map((item) => item.chat.id), [visibleChat.id]);
    assert.deepEqual(joinRequests.chats.map((chat) => chat.id), [visibleChat.id]);
    assert.equal(appeals.pendingCount, 1);
    assert.deepEqual(appeals.items.map((item) => item.chat.id), [visibleChat.id]);
    assert.ok(profile);
    assert.deepEqual(profile.user.memberships.map((item) => item.chat.id), [visibleChat.id]);
    assert.deepEqual(profile.auditLogs.map((item) => item.chat?.id), [visibleChat.id]);
    assert.equal(hiddenProfile, null);
    assert.equal(dashboard.totals.chats, 1);
    assert.equal(dashboard.totals.knownUsers, 1);
    assert.ok(dashboard.topChats.every((chat) => chat.id === visibleChat.id));

    const [hiddenMembers, hiddenMessages, hiddenRequests, hiddenAppeals] = await Promise.all([
      listMembers({ page: 1, pageSize: 20, chatId: hiddenChat.id, visibleChatIds }),
      listMessages({ page: 1, pageSize: 20, chatId: hiddenChat.id, state: "ALL", visibleChatIds }),
      listJoinRequests({ page: 1, pageSize: 20, chatId: hiddenChat.id, status: "PENDING", visibleChatIds }),
      listAppeals({ page: 1, pageSize: 20, chatId: hiddenChat.id, status: "PENDING", visibleChatIds })
    ]);
    assert.equal(hiddenMembers.items.length, 0);
    assert.equal(hiddenMessages.items.length, 0);
    assert.equal(hiddenRequests.items.length, 0);
    assert.equal(hiddenAppeals.items.length, 0);
  } finally {
    await cleanup();
  }
});
