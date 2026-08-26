const DEFAULT_PRODUCTION_HOST = "modera-silk.vercel.app";

type WebhookEnvironment = Record<string, string | undefined>;

function webhookUrlFromBase(baseUrl: string) {
  return `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
}

/** Same "where does this deployment actually live" resolution the webhook URL uses,
 * without the webhook-specific TELEGRAM_WEBHOOK_URL override or the /api suffix --
 * reused for links back into the panel itself (e.g. the /start login_ confirmation). */
export function resolveAppBaseUrl(env: WebhookEnvironment = process.env): string | null {
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

  const baseUrl = resolveAppBaseUrl(env);
  return baseUrl ? webhookUrlFromBase(baseUrl) : null;
}

export function resolveTelegramWebhookUrlForSetup(
  env: WebhookEnvironment = process.env
) {
  return (
    resolveTelegramWebhookUrl(env) ??
    webhookUrlFromBase(`https://${DEFAULT_PRODUCTION_HOST}`)
  );
}
