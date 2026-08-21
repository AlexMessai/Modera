import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  completePendingLogChannelLink,
  forwardModerationEventToLogChannel,
  startLogChannelLink,
  unlinkLogChannel,
  updateChatLogChannelSettings
} from "./log-channel-service";

const CHAT_ID = -1009000018001n;
const ADMIN_EMAIL = "log-channel-service-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

async function setup() {
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Log Channel CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  return { chat, admin };
}

test("completePendingLogChannelLink: no pending link is a no-op", async () => {
  await cleanup();
  const { admin } = await setup();

  try {
    const result = await completePendingLogChannelLink({
      actingAdminId: admin.id,
      forwardOrigin: { type: "channel", chat: { id: -1001111111111, title: "My Channel", type: "channel" } }
    });
    assert.equal(result.outcome, "no_pending_link");
  } finally {
    await cleanup();
  }
});

test("completePendingLogChannelLink: rejects a forward that isn't from a channel", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    await startLogChannelLink({ chatId: chat.id, actingAdminId: admin.id });

    const result = await completePendingLogChannelLink({
      actingAdminId: admin.id,
      forwardOrigin: { type: "user" }
    });
    assert.equal(result.outcome, "not_a_channel_forward");

    const stored = await prisma.chatLogChannelSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.logChannelTelegramId, null, "a rejected forward must not link anything");
  } finally {
    await cleanup();
  }
});

test("completePendingLogChannelLink: rejects when the bot isn't in the channel (deterministic, no bot token in CI)", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    await startLogChannelLink({ chatId: chat.id, actingAdminId: admin.id });

    const result = await completePendingLogChannelLink({
      actingAdminId: admin.id,
      forwardOrigin: { type: "channel", chat: { id: -1001111111111, title: "My Channel", type: "channel" } }
    });
    assert.equal(result.outcome, "bot_not_in_channel");

    const stored = await prisma.chatLogChannelSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.logChannelTelegramId, null);
  } finally {
    await cleanup();
  }
});

test("updateChatLogChannelSettings refuses to enable a chat with no channel linked yet", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    const result = await updateChatLogChannelSettings({ chatId: chat.id, actingAdminId: admin.id, enabled: true });
    assert.equal(result, null);
  } finally {
    await cleanup();
  }
});

test("updateChatLogChannelSettings toggles once a channel is linked, unlinkLogChannel clears it", async () => {
  await cleanup();
  const { chat, admin } = await setup();

  try {
    await prisma.chatLogChannelSettings.create({
      data: { chatId: chat.id, enabled: true, logChannelTelegramId: -1001111111111n, logChannelTitle: "My Channel" }
    });

    const toggled = await updateChatLogChannelSettings({ chatId: chat.id, actingAdminId: admin.id, enabled: false });
    assert.equal(toggled?.enabled, false);

    const log = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "LOG_CHANNEL_SETTINGS_UPDATED" } });
    assert.ok(log);

    const unlinked = await unlinkLogChannel({ chatId: chat.id, actingAdminId: admin.id });
    assert.equal(unlinked?.logChannelTelegramId, null);
    assert.equal(unlinked?.enabled, false);

    const unlinkLog = await prisma.auditLog.findFirst({ where: { chatId: chat.id, action: "LOG_CHANNEL_UNLINKED" } });
    assert.ok(unlinkLog);
  } finally {
    await cleanup();
  }
});

test("forwardModerationEventToLogChannel is a silent no-op when disabled or unlinked, and never throws", async () => {
  await cleanup();
  const { chat } = await setup();

  try {
    await assert.doesNotReject(() =>
      forwardModerationEventToLogChannel({
        chatId: chat.id,
        chatTitle: chat.title,
        action: "MUTE",
        targetDisplayName: "Someone",
        reason: null
      })
    );

    await prisma.chatLogChannelSettings.create({
      data: { chatId: chat.id, enabled: true, logChannelTelegramId: -1001111111111n, logChannelTitle: "My Channel" }
    });

    // Enabled + linked, but no bot token in CI -- the Telegram send fails
    // internally and must still not throw (best-effort).
    await assert.doesNotReject(() =>
      forwardModerationEventToLogChannel({
        chatId: chat.id,
        chatTitle: chat.title,
        action: "BAN",
        targetDisplayName: "Someone",
        reason: "спам"
      })
    );
  } finally {
    await cleanup();
  }
});
