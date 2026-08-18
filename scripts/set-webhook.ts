import "dotenv/config";
import { TelegramClient } from "../src/server/telegram/client";
import { resolveTelegramWebhookSecret } from "../src/server/telegram/webhook-secret";

const DEFAULT_PRODUCTION_HOST = "modera-silk.vercel.app";

function resolveWebhookUrl() {
  if (process.env.TELEGRAM_WEBHOOK_URL) {
    return process.env.TELEGRAM_WEBHOOK_URL;
  }

  const productionHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    DEFAULT_PRODUCTION_HOST;

  return `https://${productionHost}/api/telegram/webhook`;
}

async function main() {
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "production") {
    console.log("Skipping Telegram webhook setup outside Vercel production");
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = resolveWebhookUrl();
  const secretToken = resolveTelegramWebhookSecret();

  if (!token) {
    throw new Error("Missing required environment variable: TELEGRAM_BOT_TOKEN");
  }

  if (!secretToken) {
    throw new Error("Unable to resolve Telegram webhook secret");
  }

  const client = new TelegramClient(token);
  const success = await client.setWebhook({
    url,
    secretToken,
    allowedUpdates: [
      "message",
      "edited_message",
      "my_chat_member",
      "chat_member",
      "chat_join_request",
      "callback_query"
    ]
  });

  if (!success) throw new Error("Telegram did not accept webhook");

  const info = await client.getWebhookInfo();
  console.log({
    url: info.url,
    pendingUpdateCount: info.pending_update_count,
    lastErrorMessage: info.last_error_message ?? null
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Webhook setup failed");
  process.exit(1);
});
