import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import type { TelegramMessage } from "@/server/telegram/types";
import {
  countMentions,
  extractLinkDomains,
  filterBlockedDomains,
  findBlockedTerms,
  isDomainAllowed,
  isDuplicateViolation,
  isFloodViolation,
  normalizeAllowedDomains,
  normalizeBlockedTerms,
  normalizeModerationText,
  processAutomodMessage
} from "./automod-service";

test("link extraction uses Telegram entities and plaintext fallback", () => {
  const message: TelegramMessage = {
    message_id: 1,
    date: 1_700_000_000,
    chat: { id: -100123, type: "supergroup", title: "Test" },
    from: { id: 77, is_bot: false, first_name: "User" },
    text: "Открой example.com или кнопку",
    entities: [
      {
        type: "text_link",
        offset: 22,
        length: 6,
        url: "https://WWW.Telegram.org/path"
      }
    ]
  };

  assert.deepEqual(extractLinkDomains(message).sort(), ["example.com", "telegram.org"]);
});

test("domain allowlist includes subdomains but not lookalike domains", () => {
  const allowed = normalizeAllowedDomains([
    "https://www.Example.com/path",
    "example.com",
    "sub.example.org"
  ]);

  assert.deepEqual(allowed, ["example.com", "sub.example.org"]);
  assert.equal(isDomainAllowed("cdn.example.com", allowed), true);
  assert.equal(isDomainAllowed("example.com", allowed), true);
  assert.equal(isDomainAllowed("badexample.com", allowed), false);
  assert.equal(isDomainAllowed("example.net", allowed), false);
});

test("filterBlockedDomains implements all four Link Protection modes", () => {
  const domains = ["spam.example", "trusted.example"];
  const allowedDomains = normalizeAllowedDomains(["trusted.example"]);
  const blockedDomains = normalizeAllowedDomains(["spam.example"]);

  assert.deepEqual(filterBlockedDomains({ mode: "ALLOW_ALL", domains, allowedDomains, blockedDomains }), []);
  assert.deepEqual(filterBlockedDomains({ mode: "BLOCK_ALL", domains, allowedDomains, blockedDomains }), domains);
  assert.deepEqual(
    filterBlockedDomains({ mode: "WHITELIST_ONLY", domains, allowedDomains, blockedDomains }),
    ["spam.example"]
  );
  assert.deepEqual(
    filterBlockedDomains({ mode: "BLACKLIST_ONLY", domains, allowedDomains, blockedDomains }),
    ["spam.example"]
  );
  // Blacklist mode with no matching entry lets everything through.
  assert.deepEqual(
    filterBlockedDomains({ mode: "BLACKLIST_ONLY", domains: ["neither.example"], allowedDomains, blockedDomains }),
    []
  );
});

test("blocked term matching is case insensitive and respects word boundaries", () => {
  const terms = normalizeBlockedTerms(["  РЕКЛАМА  ", "купить сейчас", "реклама"]);
  assert.deepEqual(terms, ["реклама", "купить сейчас"]);

  const matched = findBlockedTerms(
    {
      message_id: 2,
      date: 1_700_000_000,
      chat: { id: -100123, type: "supergroup", title: "Test" },
      from: { id: 77, is_bot: false, first_name: "User" },
      text: "Это РЕКЛАМА: купить сейчас!"
    },
    terms
  );
  assert.deepEqual(matched, ["реклама", "купить сейчас"]);

  assert.deepEqual(
    findBlockedTerms(
      {
        message_id: 3,
        date: 1_700_000_000,
        chat: { id: -100123, type: "supergroup", title: "Test" },
        from: { id: 77, is_bot: false, first_name: "User" },
        text: "сверхрекламация"
      },
      ["реклама"]
    ),
    []
  );
});

test("text normalization makes duplicate comparison stable", () => {
  assert.equal(normalizeModerationText("  Привет\nМИР  "), "привет мир");
  assert.equal(isDuplicateViolation(2, 2), false);
  assert.equal(isDuplicateViolation(3, 2), true);
});

test("mass mention count uses Telegram mention entities", () => {
  const message: TelegramMessage = {
    message_id: 4,
    date: 1_700_000_000,
    chat: { id: -100123, type: "supergroup", title: "Test" },
    from: { id: 77, is_bot: false, first_name: "User" },
    text: "@one @two кнопка",
    entities: [
      { type: "mention", offset: 0, length: 4 },
      { type: "mention", offset: 5, length: 4 },
      { type: "text_link", offset: 10, length: 6, url: "https://example.com" }
    ]
  };
  assert.equal(countMentions(message), 2);
});

test("flood threshold allows the configured count and flags the next message", () => {
  assert.equal(isFloodViolation(5, 5), false);
  assert.equal(isFloodViolation(6, 5), true);
});

test("same Telegram message revision is processed once and a later edit is a new revision", async () => {
  const telegramChatId = -1009000000301n;
  const telegramUserId = 900000301n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const chat = await prisma.chat.create({
    data: {
      telegramChatId,
      title: "Automod CI",
      type: "supergroup"
    }
  });
  // This test is about revision/dedup tracking, not rule matching — opt out
  // of the global profile explicitly so it stays "DISABLED" regardless of
  // whatever protective defaults the global profile carries.
  await prisma.chatModerationSettings.create({
    data: { chatId: chat.id, useGlobalProfile: false }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId,
      firstName: "Automod",
      displayName: "Automod Target"
    }
  });
  await prisma.chatMember.create({
    data: {
      chatId: chat.id,
      userId: user.id,
      status: "MEMBER"
    }
  });
  await prisma.message.create({
    data: {
      chatId: chat.id,
      senderUserId: user.id,
      telegramMessageId: 501n,
      telegramDate: new Date(1_700_000_000_000),
      text: "Обычное сообщение",
      messageType: "TEXT"
    }
  });

  const original: TelegramMessage = {
    message_id: 501,
    date: 1_700_000_000,
    chat: {
      id: Number(telegramChatId),
      type: "supergroup",
      title: "Automod CI"
    },
    from: {
      id: Number(telegramUserId),
      is_bot: false,
      first_name: "Automod"
    },
    text: "Обычное сообщение"
  };

  try {
    const first = await processAutomodMessage({
      chatId: chat.id,
      message: original,
      isEdited: false
    });
    const duplicate = await processAutomodMessage({
      chatId: chat.id,
      message: original,
      isEdited: false
    });
    const edited = await processAutomodMessage({
      chatId: chat.id,
      message: {
        ...original,
        edit_date: original.date + 10,
        text: "Изменённое сообщение"
      },
      isEdited: true
    });

    assert.equal(first.result, "DISABLED");
    assert.equal(duplicate.result, "DUPLICATE_REVISION");
    assert.equal(edited.result, "DISABLED");

    const saved = await prisma.message.findUniqueOrThrow({
      where: {
        chatId_telegramMessageId: {
          chatId: chat.id,
          telegramMessageId: 501n
        }
      }
    });
    assert.equal(saved.automodRevisionAt?.getTime(), 1_700_000_010_000);
    assert.equal(saved.automodClaimedAt, null);
    assert.equal(saved.automodResult, "DISABLED");
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
  }
});

// No TELEGRAM_BOT_TOKEN in CI (see CLAUDE.md), so getTelegramClient() always
// throws and every would-be deletion ends up DELETE_FAILED rather than the
// RESULT_BY_RULE success value -- these tests exercise rule *detection*
// (rulesEnabled, mediaFilters), which is fully decided before the Telegram
// call, not the success branch itself.
test("mediaFilters (Filters module) enables automod for an enabled type", async () => {
  const telegramChatId = -1009000000401n;
  const telegramUserId = 900000401n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const chat = await prisma.chat.create({ data: { telegramChatId, title: "Automod Filters CI", type: "supergroup" } });
  await prisma.chatModerationSettings.create({
    data: {
      chatId: chat.id,
      useGlobalProfile: false,
      mediaFilters: [{ type: "PHOTO", enabled: true, warnOnTrigger: true, notifyEnabled: true, notifyText: "🚫" }]
    }
  });
  const user = await prisma.telegramUser.create({ data: { telegramUserId, firstName: "Automod", displayName: "Automod Target" } });
  await prisma.chatMember.create({ data: { chatId: chat.id, userId: user.id, status: "MEMBER" } });
  await prisma.message.create({
    data: { chatId: chat.id, senderUserId: user.id, telegramMessageId: 601n, telegramDate: new Date(1_700_000_000_000), messageType: "PHOTO" }
  });

  const message: TelegramMessage = {
    message_id: 601,
    date: 1_700_000_000,
    chat: { id: Number(telegramChatId), type: "supergroup", title: "Automod Filters CI" },
    from: { id: Number(telegramUserId), is_bot: false, first_name: "Automod" }
  };

  try {
    const result = await processAutomodMessage({ chatId: chat.id, message, isEdited: false });
    // DELETE_FAILED (not DISABLED/CLEAN) proves the PHOTO rule was matched
    // and deletion was attempted.
    assert.equal(result.result, "DELETE_FAILED");
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
  }
});

test("a disabled mediaFilters entry does not trigger automod for that type", async () => {
  const telegramChatId = -1009000000402n;
  const telegramUserId = 900000402n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const chat = await prisma.chat.create({ data: { telegramChatId, title: "Automod Filters CI 2", type: "supergroup" } });
  await prisma.chatModerationSettings.create({
    data: {
      chatId: chat.id,
      useGlobalProfile: false,
      // Some other rule must stay enabled so automod isn't skipped
      // altogether (rulesEnabled) -- massMentionsEnabled here never matches
      // this message, so it can't be what makes the result CLEAN.
      massMentionsEnabled: true,
      maxMentions: 50,
      mediaFilters: [{ type: "PHOTO", enabled: false, warnOnTrigger: false, notifyEnabled: false, notifyText: "🚫" }]
    }
  });
  const user = await prisma.telegramUser.create({ data: { telegramUserId, firstName: "Automod", displayName: "Automod Target" } });
  await prisma.chatMember.create({ data: { chatId: chat.id, userId: user.id, status: "MEMBER" } });
  await prisma.message.create({
    data: { chatId: chat.id, senderUserId: user.id, telegramMessageId: 602n, telegramDate: new Date(1_700_000_000_000), messageType: "PHOTO" }
  });

  const message: TelegramMessage = {
    message_id: 602,
    date: 1_700_000_000,
    chat: { id: Number(telegramChatId), type: "supergroup", title: "Automod Filters CI 2" },
    from: { id: Number(telegramUserId), is_bot: false, first_name: "Automod" }
  };

  try {
    const result = await processAutomodMessage({ chatId: chat.id, message, isEdited: false });
    assert.equal(result.result, "CLEAN");
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
  }
});
