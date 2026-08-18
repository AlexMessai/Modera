import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import {
  isMessageState,
  isMessageType,
  listMessages
} from "./message-service";

test("message type and state guards reject unknown values", () => {
  assert.equal(isMessageType("TEXT"), true);
  assert.equal(isMessageType("UNKNOWN_TYPE"), false);
  assert.equal(isMessageState("DELETED"), true);
  assert.equal(isMessageState("UNKNOWN_STATE"), false);
});

test("message list filters real stored messages by chat sender type state and search", async () => {
  const telegramChatId = -1009000000701n;
  const telegramUserId = 900000701n;

  await prisma.chat.deleteMany({ where: { telegramChatId } });
  await prisma.telegramUser.deleteMany({ where: { telegramUserId } });

  const chat = await prisma.chat.create({
    data: {
      telegramChatId,
      title: "Messages CI Chat",
      type: "supergroup"
    }
  });
  const user = await prisma.telegramUser.create({
    data: {
      telegramUserId,
      username: "messages_target",
      firstName: "Messages",
      displayName: "Messages Target"
    }
  });

  const base = new Date("2026-08-18T08:00:00.000Z");
  try {
    await prisma.message.createMany({
      data: [
        {
          chatId: chat.id,
          senderUserId: user.id,
          telegramMessageId: 701n,
          telegramDate: base,
          text: "Уникальный текст для поиска",
          messageType: "TEXT"
        },
        {
          chatId: chat.id,
          senderUserId: user.id,
          telegramMessageId: 702n,
          telegramDate: new Date(base.getTime() + 1_000),
          caption: "Фото со ссылкой",
          messageType: "PHOTO",
          automodResult: "DELETED_LINK",
          deletedAt: new Date(base.getTime() + 2_000)
        },
        {
          chatId: chat.id,
          senderUserId: user.id,
          telegramMessageId: 703n,
          telegramDate: new Date(base.getTime() + 3_000),
          editedAt: new Date(base.getTime() + 4_000),
          text: "Изменённое сообщение",
          messageType: "TEXT",
          isEdited: true,
          automodResult: "DELETE_FAILED"
        }
      ]
    });

    const all = await listMessages({
      page: 1,
      pageSize: 50,
      chatId: chat.id,
      state: "ALL"
    });
    assert.equal(all.pagination.total, 3);
    assert.equal(all.items.length, 3);

    const active = await listMessages({
      page: 1,
      pageSize: 50,
      chatId: chat.id,
      state: "ACTIVE"
    });
    assert.equal(active.pagination.total, 2);

    const deleted = await listMessages({
      page: 1,
      pageSize: 50,
      chatId: chat.id,
      state: "AUTOMOD_DELETED"
    });
    assert.equal(deleted.pagination.total, 1);
    assert.equal(deleted.items[0]?.telegramMessageId, "702");

    const failed = await listMessages({
      page: 1,
      pageSize: 50,
      chatId: chat.id,
      state: "DELETE_FAILED"
    });
    assert.equal(failed.pagination.total, 1);
    assert.equal(failed.items[0]?.telegramMessageId, "703");

    const edited = await listMessages({
      page: 1,
      pageSize: 50,
      chatId: chat.id,
      state: "EDITED"
    });
    assert.equal(edited.pagination.total, 1);

    const byType = await listMessages({
      page: 1,
      pageSize: 50,
      chatId: chat.id,
      type: "PHOTO",
      state: "ALL"
    });
    assert.equal(byType.pagination.total, 1);

    const byText = await listMessages({
      page: 1,
      pageSize: 50,
      chatId: chat.id,
      search: "уникальный текст",
      state: "ALL"
    });
    assert.equal(byText.pagination.total, 1);
    assert.equal(byText.items[0]?.telegramMessageId, "701");

    const bySenderId = await listMessages({
      page: 1,
      pageSize: 50,
      chatId: chat.id,
      sender: telegramUserId.toString(),
      state: "ALL"
    });
    assert.equal(bySenderId.pagination.total, 3);

    const byDate = await listMessages({
      page: 1,
      pageSize: 50,
      chatId: chat.id,
      state: "ALL",
      dateFrom: "2026-08-18T08:00:01.000Z",
      dateTo: "2026-08-18T08:00:02.500Z"
    });
    assert.equal(byDate.pagination.total, 1);
    assert.equal(byDate.items[0]?.telegramMessageId, "702");
  } finally {
    await prisma.chat.delete({ where: { id: chat.id } });
    await prisma.telegramUser.delete({ where: { id: user.id } });
  }
});
