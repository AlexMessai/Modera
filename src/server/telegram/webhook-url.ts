const DEFAULT_PRODUCTION_HOST = "modera-silk.vercel.app";

type WebhookEnvironment = Record<string, string | undefined>;

function webhookUrlFromBase(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
}

export function resolveTelegramWebhookUrl(
  env: WebhookEnvironment = process.env
) {
  const explicitUrl = env.TELEGRAM_WEBHOOK_URL?.trim();
  if (explicitUrl) return explicitUrl;

  const vercelHost =
    env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || env.VERCEL_URL?.trim();
  if (vercelHost) return webhookUrlFromBase(`https://${vercelHost}`);

  const appUrl = env.APP_URL?.trim();
  if (appUrl) return webhookUrlFromBase(appUrl);

  if (env.VERCEL === "1" && env.VERCEL_ENV === "production") {
    return webhookUrlFromBase(`https://${DEFAULT_PRODUCTION_HOST}`);
  }

  return null;
}

export function resolveTelegramWebhookUrlForSetup(
  env: WebhookEnvironment = process.env
) {
  return (
    resolveTelegramWebhookUrl(env) ??
    webhookUrlFromBase(`https://${DEFAULT_PRODUCTION_HOST}`)
  );
}
