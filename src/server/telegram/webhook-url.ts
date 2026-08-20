const DEFAULT_PRODUCTION_HOST = "modera-silk.vercel.app";

type WebhookEnvironment = Record<string, string | undefined>;

function webhookUrlFromBase(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
}

/** Same Vercel/APP_URL priority the webhook URL uses, without the /api/telegram/webhook suffix — for building any other absolute app URL (e.g. a Mini App page). */
export function resolveAppBaseUrl(env: WebhookEnvironment = process.env) {
  const vercelHost =
    env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || env.VERCEL_URL?.trim();
  if (vercelHost) return `https://${vercelHost}`;

  const appUrl = env.APP_URL?.trim();
  if (appUrl) return appUrl.replace(/\/$/, "");

  if (env.VERCEL === "1" && env.VERCEL_ENV === "production") {
    return `https://${DEFAULT_PRODUCTION_HOST}`;
  }

  return null;
}

export function resolveTelegramWebhookUrl(
  env: WebhookEnvironment = process.env
) {
  const explicitUrl = env.TELEGRAM_WEBHOOK_URL?.trim();
  if (explicitUrl) return explicitUrl;

  const base = resolveAppBaseUrl(env);
  return base ? webhookUrlFromBase(base) : null;
}

export function resolveTelegramWebhookUrlForSetup(
  env: WebhookEnvironment = process.env
) {
  return (
    resolveTelegramWebhookUrl(env) ??
    webhookUrlFromBase(`https://${DEFAULT_PRODUCTION_HOST}`)
  );
}
