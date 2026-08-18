import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import type { TelegramMessage } from "@/server/telegram/types";
import {
  extractLinkDomains,
  isDomainAllowed,
  isFloodViolation,
  normalizeAllowedDomains,
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
      messageType: "text"
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
