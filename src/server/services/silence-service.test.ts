import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db/prisma";
import { getActiveSilence, processExpiredSilences, SilenceError, startSilence, stopSilence } from "./silence-service";

const CHAT_ID = -1009000019001n;

async function cleanup() {
  await prisma.chat.deleteMany({ where: { telegramChatId: CHAT_ID } });
}

test("startSilence surfaces a SilenceError for an out-of-range duration without touching Telegram or the DB", async () => {
  await cleanup();
  const chat = await prisma.chat.create({ data: { telegramChatId: CHAT_ID, title: "Silence CI", type: "supergroup" } });

  try {
    await assert.rejects(
      () => startSilence({
        chatId: chat.id,
        telegramChatId: Number(CHAT_ID),
        durationMinutes: 0,
        actorTelegramUserId: 900001901,
        actorDisplayName: "CI Admin"
      }),
      (error: unknown) => error instanceof SilenceError && error.code === "INVALID_DURATION"
    );

    assert.equal(await getActiveSilence(chat.id), null);
  } finally {
    await cleanup();
  }
});

test("startSilence surfaces a SilenceError when the Telegram call fails (no bot token in CI), and leaves no state behind", async () => {
  await cleanup();
  const chat = await prisma.chat.create({ data: { telegramChatId: CHAT_ID, title: "Silence CI", type: "supergroup" } });

  try {
    await assert.rejects(
      () => startSilence({
        chatId: chat.id,
        telegramChatId: Number(CHAT_ID),
        durationMinutes: 30,
        actorTelegramUserId: 900001901,
        actorDisplayName: "CI Admin"
      }),
      SilenceError
    );

    assert.equal(await getActiveSilence(chat.id), null);
  } finally {
    await cleanup();
  }
});

test("stopSilence rejects a chat that isn't currently silenced", async () => {
  await cleanup();
  const chat = await prisma.chat.create({ data: { telegramChatId: CHAT_ID, title: "Silence CI", type: "supergroup" } });

  try {
    await assert.rejects(
      () => stopSilence({ chatId: chat.id, telegramChatId: Number(CHAT_ID), actorTelegramUserId: 900001901, actorDisplayName: "CI Admin" }),
      (error: unknown) => error instanceof SilenceError && error.code === "NOT_SILENCED"
    );
  } finally {
    await cleanup();
  }
});

test("processExpiredSilences finds a due row (seeded directly, bypassing the real Telegram call) but leaves it in place when the Telegram call fails, same as every other Telegram-backed expiry sweep in CI", async () => {
  await cleanup();
  const chat = await prisma.chat.create({ data: { telegramChatId: CHAT_ID, title: "Silence CI", type: "supergroup" } });
  const state = await prisma.chatSilenceState.create({
    data: { chatId: chat.id, expiresAt: new Date(Date.now() - 60_000), previousPermissions: {} }
  });

  try {
    const result = await processExpiredSilences({ now: new Date() });
    assert.equal(result.checked, 1);
    assert.equal(result.lifted, 0);
    assert.equal(result.failed, 1);

    const stillThere = await prisma.chatSilenceState.findUnique({ where: { id: state.id } });
    assert.ok(stillThere, "a failed Telegram call must not silently drop the row -- the next cron run should retry it");
  } finally {
    await cleanup();
  }
});
