import { createHash } from "node:crypto";

const WEBHOOK_SECRET_CONTEXT = "modera:telegram:webhook:v1";

export function resolveTelegramWebhookSecret() {
  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (configuredSecret) return configuredSecret;

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) return null;

  return createHash("sha256")
    .update(`${WEBHOOK_SECRET_CONTEXT}:${botToken}`)
    .digest("hex");
}
