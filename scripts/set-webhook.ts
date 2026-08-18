import "dotenv/config";
import { TelegramClient } from "../src/server/telegram/client";

function resolveWebhookUrl() {
  if (process.env.TELEGRAM_WEBHOOK_URL) {
    return process.env.TELEGRAM_WEBHOOK_URL;
  }

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionHost) {
    return `https://${productionHost}/api/telegram/webhook`;
  }

  return undefined;
}

async function main() {
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "production") {
    console.log("Skipping Telegram webhook setup outside Vercel production");
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = resolveWebhookUrl();
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token || !url || !secretToken) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and a production webhook URL are required"
    );
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
