import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTelegramWebhookUrl,
  resolveTelegramWebhookUrlForSetup
} from "./webhook-url";

test("explicit webhook URL has priority", () => {
  assert.equal(
    resolveTelegramWebhookUrl({
      TELEGRAM_WEBHOOK_URL: "https://custom.example/webhook",
      VERCEL_PROJECT_PRODUCTION_URL: "modera.example"
    }),
    "https://custom.example/webhook"
  );
});

test("Vercel production host resolves to the Telegram endpoint", () => {
  assert.equal(
    resolveTelegramWebhookUrl({
      VERCEL_PROJECT_PRODUCTION_URL: "modera-silk.vercel.app"
    }),
    "https://modera-silk.vercel.app/api/telegram/webhook"
  );
});

test("APP_URL is used outside Vercel and trailing slash is normalized", () => {
  assert.equal(
    resolveTelegramWebhookUrl({ APP_URL: "http://localhost:3000/" }),
    "http://localhost:3000/api/telegram/webhook"
  );
});

test("diagnostics stay unconfigured without a URL while setup has a safe default", () => {
  assert.equal(resolveTelegramWebhookUrl({}), null);
  assert.equal(
    resolveTelegramWebhookUrlForSetup({}),
    "https://modera-silk.vercel.app/api/telegram/webhook"
  );
});
