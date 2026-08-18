import assert from "node:assert/strict";
import test from "node:test";
import { resolveTelegramWebhookSecret } from "./webhook-secret";

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("explicit Telegram webhook secret has priority", () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;

  try {
    process.env.TELEGRAM_WEBHOOK_SECRET = "explicit-secret";
    process.env.TELEGRAM_BOT_TOKEN = "123:token";
    assert.equal(resolveTelegramWebhookSecret(), "explicit-secret");
  } finally {
    restore("TELEGRAM_WEBHOOK_SECRET", originalSecret);
    restore("TELEGRAM_BOT_TOKEN", originalToken);
  }
});

test("webhook secret fallback is deterministic and does not expose bot token", () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;

  try {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    process.env.TELEGRAM_BOT_TOKEN = "123456:private-bot-token";

    const first = resolveTelegramWebhookSecret();
    const second = resolveTelegramWebhookSecret();

    assert.ok(first);
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(first.includes("private-bot-token"), false);
  } finally {
    restore("TELEGRAM_WEBHOOK_SECRET", originalSecret);
    restore("TELEGRAM_BOT_TOKEN", originalToken);
  }
});
