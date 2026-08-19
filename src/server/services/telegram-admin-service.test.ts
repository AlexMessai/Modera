import assert from "node:assert/strict";
import test from "node:test";
import { isLiveTelegramChatAdmin } from "./telegram-admin-service";

test("isLiveTelegramChatAdmin fails closed without a configured bot token", async () => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;
  try {
    const result = await isLiveTelegramChatAdmin(-100123456, 555);
    assert.equal(result, false);
  } finally {
    if (previous !== undefined) process.env.TELEGRAM_BOT_TOKEN = previous;
  }
});
