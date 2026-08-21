import { processStaleRaidIncidents } from "@/server/services/anti-raid-service";
import { processExpiredCaptchaChallenges } from "@/server/services/captcha-service";
import { processExpiredPunishments } from "@/server/services/punishment-expiration-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "Недействительный ключ задания." } }, { status: 401 });
  }
  const [mutes, captcha, raids] = await Promise.all([
    processExpiredPunishments(),
    processExpiredCaptchaChallenges(),
    processStaleRaidIncidents()
  ]);
  return Response.json({ data: { mutes, captcha, raids } });
}
