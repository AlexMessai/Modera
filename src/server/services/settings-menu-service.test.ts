import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { buildSettingsCallbackData, parseSettingsCallbackData, renderSettingsMenu } from "./settings-menu-service";

const CHAT_ID = -1009000016001n;
const ADMIN_EMAIL = "settings-menu-service-ci@example.com";

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
  await prisma.adminUser.deleteMany({ where: { email: ADMIN_EMAIL } });
}

test("buildSettingsCallbackData/parseSettingsCallbackData round-trip and reject malformed data", () => {
  const data = buildSettingsCallbackData(-1001234567890, "automod.flood.limit.+1");
  const parsed = parseSettingsCallbackData(data);
  assert.deepEqual(parsed, { telegramChatId: -1001234567890, path: "automod.flood.limit.+1" });

  // Link-mode paths carry an uppercase mode name -- must not be rejected by the path charset.
  const linkData = buildSettingsCallbackData(-1001234567890, "automod.links.set.WHITELIST_ONLY");
  assert.deepEqual(parseSettingsCallbackData(linkData), { telegramChatId: -1001234567890, path: "automod.links.set.WHITELIST_ONLY" });

  assert.equal(parseSettingsCallbackData("report:11111111-1111-4111-8111-111111111111:MUTE"), null);
  assert.equal(parseSettingsCallbackData("s|not-a-number|root"), null);
  assert.equal(parseSettingsCallbackData("s|-100123|"), null);
});

test("renderSettingsMenu: root and close render without touching the DB", async () => {
  const root = await renderSettingsMenu({
    chatId: "00000000-0000-4000-8000-000000000000",
    chatTitle: "Any Chat",
    telegramChatId: -1001234567890,
    actingAdminId: "00000000-0000-4000-8000-000000000000",
    path: "root"
  });
  assert.ok(root?.text.includes("Any Chat"));
  assert.ok(root?.keyboard);

  const closed = await renderSettingsMenu({
    chatId: "00000000-0000-4000-8000-000000000000",
    chatTitle: "Any Chat",
    telegramChatId: -1001234567890,
    actingAdminId: "00000000-0000-4000-8000-000000000000",
    path: "close"
  });
  assert.equal(closed?.keyboard, null);
});

test("renderSettingsMenu: toggling flood persists to the chat's own profile and reflects in the rendered text", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  // Seeded explicitly, on the chat's own row -- GlobalModerationSettings is a
  // shared singleton other test files also touch, so the "before" state here
  // must not depend on whatever the global default happens to be right now.
  await prisma.chatModerationSettings.create({
    data: { chatId: chat.id, useGlobalProfile: false, spamEnabled: false, spamMaxMessages: 5, spamWindowSeconds: 10 }
  });

  try {
    const before = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "automod.flood"
    });
    assert.ok(before?.text.includes("флуда"));
    assert.ok(before?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("выключен"))));

    const toggled = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "automod.flood.toggle"
    });
    assert.ok(toggled?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("включён"))));

    const stored = await prisma.chatModerationSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.spamEnabled, true);
    assert.equal(stored?.useGlobalProfile, false, "editing via Telegram must fork the chat off the global profile");

    const incremented = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "automod.flood.limit.+1"
    });
    assert.ok(incremented?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Сообщений: 6"))));

    const storedAfterIncrement = await prisma.chatModerationSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(storedAfterIncrement?.spamMaxMessages, 6);
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: link protection mode picker sets the mode and stays on the links screen", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const result = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "automod.links.set.BLOCK_ALL"
    });
    assert.ok(result?.text.includes("ссылок"));

    const stored = await prisma.chatModerationSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.linkProtectionMode, "BLOCK_ALL");
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: protection menu, CAPTCHA toggle persists to the chat's own profile", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const menu = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "protection"
    });
    assert.ok(menu?.text.includes("Защита"));
    assert.ok(menu?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("CAPTCHA"))));

    const toggled = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "protection.captcha.toggle"
    });
    assert.ok(toggled?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("включена"))));

    const stored = await prisma.chatCaptchaSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.enabled, true);
    assert.equal(stored?.useGlobalProfile, false);
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: Anti-Raid toggle and stepper persist to the chat's own profile", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const toggled = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "protection.antiraid.toggle"
    });
    assert.ok(toggled?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Порог"))));

    const incremented = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "protection.antiraid.threshold.+5"
    });
    assert.ok(incremented?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Порог: 35"))));

    const stored = await prisma.chatAntiRaidSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.enabled, true);
    assert.equal(stored?.joinThreshold, 35);
    assert.equal(stored?.useGlobalProfile, false);
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: Moderation menu, warnings expiry stepper persists to the chat's own profile", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  await prisma.chatModerationSettings.create({
    data: { chatId: chat.id, useGlobalProfile: false, warningExpiryDays: 0 }
  });

  try {
    const menu = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "moderation"
    });
    assert.ok(menu?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Предупреждения"))));

    const before = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "moderation.warnings"
    });
    assert.ok(before?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Дней: бессрочно"))));

    const incremented = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "moderation.warnings.expiry.+1"
    });
    assert.ok(incremented?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Дней: 1"))));

    const stored = await prisma.chatModerationSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.warningExpiryDays, 1);
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: Moderation menu, punishment toggles persist and the escalation chain renders read-only", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  await prisma.chatModerationSettings.create({
    data: {
      chatId: chat.id,
      useGlobalProfile: false,
      autoEscalationEnabled: false,
      announceEscalationEnabled: false,
      escalationRules: [{ order: 1, thresholdWarnings: 3, action: "MUTE", durationMinutes: 10 }]
    }
  });

  try {
    const before = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "moderation.punishments"
    });
    assert.ok(before?.text.includes("3 варн"));
    assert.ok(before?.text.includes("mute"));

    const toggled = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "moderation.punishments.auto.toggle"
    });
    assert.ok(toggled?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("включены"))));

    const stored = await prisma.chatModerationSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.autoEscalationEnabled, true);
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: Moderation menu, notification toggle persists to the chat's own manual-moderation profile", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  await prisma.chatManualModerationSettings.create({
    data: { chatId: chat.id, useGlobalProfile: false, warnAnnounceInChat: true }
  });

  try {
    const before = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "moderation.notifications"
    });
    assert.ok(before?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("/warn: ✅"))));

    const toggled = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "moderation.notifications.warn.toggle"
    });
    assert.ok(toggled?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("/warn: ⬜"))));

    const stored = await prisma.chatManualModerationSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.warnAnnounceInChat, false);
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: Reports section, toggle and duration stepper persist to the chat's own profile", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  await prisma.chatReportSettings.create({
    data: { chatId: chat.id, useGlobalProfile: false, enabled: true, muteDurationMinutes: 60 }
  });

  try {
    const before = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "reports"
    });
    assert.ok(before?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Срок, мин: 60"))));

    const toggled = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "reports.toggle"
    });
    assert.ok(toggled?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("выключены"))));

    const incremented = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "reports.toggle"
    });
    assert.ok(incremented?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("включены"))));

    const durationChanged = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "reports.duration.+15"
    });
    assert.ok(durationChanged?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Срок, мин: 75"))));

    const stored = await prisma.chatReportSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.enabled, true);
    assert.equal(stored?.muteDurationMinutes, 75);
    assert.equal(stored?.useGlobalProfile, false);
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: Logs section shows the link prompt when no channel is linked, and logs.link opens a pending window", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const before = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "logs"
    });
    assert.ok(before?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Подключить канал"))));

    const linking = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "logs.link"
    });
    assert.ok(linking?.text.includes("Перешлите"));

    const stored = await prisma.chatLogChannelSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.pendingLinkAdminId, admin.id);
    assert.ok(stored?.pendingLinkExpiresAt && stored.pendingLinkExpiresAt.getTime() > Date.now());
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: Logs section, toggle and unlink work once a channel is already linked", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  await prisma.chatLogChannelSettings.create({
    data: { chatId: chat.id, enabled: true, logChannelTelegramId: -1001111111111n, logChannelTitle: "My Channel" }
  });

  try {
    const before = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "logs"
    });
    assert.ok(before?.text.includes("My Channel"));
    assert.ok(before?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("включена"))));

    const toggled = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "logs.toggle"
    });
    assert.ok(toggled?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("выключена"))));

    const unlinked = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "logs.unlink"
    });
    assert.ok(unlinked?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Подключить канал"))));

    const stored = await prisma.chatLogChannelSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.logChannelTelegramId, null);
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: Users/Roles section lists roles and a permission toggle persists to the chat's own role row", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const rolesList = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "users.roles"
    });
    assert.ok(rolesList?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("Модератор"))));

    const before = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "users.roles.moderator"
    });
    assert.ok(before?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("⬜") && button.text.includes("Управлять автомодерацией"))));

    const toggled = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "users.roles.moderator.am.toggle"
    });
    assert.ok(toggled?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("✅") && button.text.includes("Управлять автомодерацией"))));

    const role = await prisma.chatRole.findUnique({ where: { chatId_key: { chatId: chat.id, key: "moderator" } } });
    assert.ok(role?.permissions.includes("automod.manage"));
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: Chat section, welcome toggle persists and rules preview reflects saved text", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });
  await prisma.chatContentSettings.create({
    data: { chatId: chat.id, useGlobalProfile: false, welcomeEnabled: false, rulesText: "Никакого спама." }
  });

  try {
    const menu = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "chat"
    });
    assert.ok(menu?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("заданы"))));

    const toggled = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "chat.welcome.toggle"
    });
    assert.ok(toggled?.keyboard?.inline_keyboard.some((row) => row.some((button) => button.text.includes("включено"))));

    const rules = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "chat.rules"
    });
    assert.ok(rules?.text.includes("Никакого спама."));

    const stored = await prisma.chatContentSettings.findUnique({ where: { chatId: chat.id } });
    assert.equal(stored?.welcomeEnabled, true);
  } finally {
    await cleanup();
  }
});

test("renderSettingsMenu: Chat section, silence status reflects an active ChatSilenceState row", async () => {
  await cleanup();
  const chat = await prisma.chat.create({
    data: { telegramChatId: CHAT_ID, title: "Settings Menu CI", type: "supergroup" }
  });
  const admin = await prisma.adminUser.create({
    data: { email: ADMIN_EMAIL, displayName: "CI Owner", passwordHash: "not-used-in-test", role: "OWNER" }
  });

  try {
    const before = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "chat.silence"
    });
    assert.ok(before?.text.includes("выключен"));

    await prisma.chatSilenceState.create({
      data: { chatId: chat.id, expiresAt: new Date(Date.now() + 30 * 60_000), startedByDisplayName: "CI Admin" }
    });

    const after = await renderSettingsMenu({
      chatId: chat.id,
      chatTitle: chat.title,
      telegramChatId: Number(CHAT_ID),
      actingAdminId: admin.id,
      path: "chat.silence"
    });
    assert.ok(after?.text.includes("включён"));
  } finally {
    await prisma.chatSilenceState.deleteMany({ where: { chatId: chat.id } });
    await cleanup();
  }
});
