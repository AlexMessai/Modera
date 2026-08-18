import "dotenv/config";
import { TelegramClient } from "../src/server/telegram/client";

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = process.env.TELEGRAM_WEBHOOK_URL;
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token || !url || !secretToken) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET are required"
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
