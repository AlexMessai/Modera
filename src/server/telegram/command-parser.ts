/**
 * Parses the argument text of a group moderation command (everything after
 * `/warn@bot`, `/mute@bot`, etc.) into targets, an optional duration, and a
 * free-text reason.
 *
 * Grammar (left to right): zero or more target tokens (`@username` or a
 * numeric Telegram ID), then — only when the caller says a duration is
 * expected for this command — one optional duration token, then everything
 * left over is the reason.
 *
 * A bare number under 6 digits is never a target: that's the range real
 * Telegram user IDs never occupy (they're 9-10 digits today) and it's the
 * range the pre-existing "/mute <minutes> <reason>" syntax already used, so
 * treating short numbers as a duration/reason word instead of an ID keeps
 * that syntax working unchanged.
 */

export type ModerationTargetToken =
  | { type: "username"; value: string }
  | { type: "id"; value: number };

export interface ParsedModerationCommandArguments {
  targetTokens: ModerationTargetToken[];
  durationMinutes: number | null;
  reason: string | null;
}

const USERNAME_TOKEN_PATTERN = /^@([a-zA-Z0-9_]{3,32})$/;
const TELEGRAM_ID_TOKEN_PATTERN = /^\d{6,}$/;
const DURATION_TOKEN_PATTERN = /^(\d+)(m|min|h|d)?$/i;
const DURATION_TOKEN_WITH_UNIT_PATTERN = /^\d+(m|min|h|d)$/i;

const MINUTES_PER_UNIT: Record<string, number> = {
  m: 1,
  min: 1,
  h: 60,
  d: 60 * 24
};

/** Minutes, or null if the token isn't a duration at all. */
export function parseDurationToken(token: string): number | null {
  const match = DURATION_TOKEN_PATTERN.exec(token);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = (match[2] ?? "m").toLowerCase();
  return amount * (MINUTES_PER_UNIT[unit] ?? 1);
}

export function parseModerationCommandArguments(
  argsText: string,
  options: {
    allowDuration: boolean;
    // MUTE keeps its long-standing "bare number = minutes" syntax (no prior
    // duration existed to preserve for BAN), so BAN requires an explicit
    // unit (30m/3h/7d) instead — otherwise a reason that happens to start
    // with a digit (e.g. "/ban 5 нарушений подряд") would be misread as a
    // duration.
    requireDurationUnit?: boolean;
  }
): ParsedModerationCommandArguments {
  const tokens = argsText.trim().split(/\s+/).filter(Boolean);

  const targetTokens: ModerationTargetToken[] = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    const usernameMatch = USERNAME_TOKEN_PATTERN.exec(token);
    if (usernameMatch) {
      targetTokens.push({ type: "username", value: usernameMatch[1] });
      cursor += 1;
      continue;
    }
    if (TELEGRAM_ID_TOKEN_PATTERN.test(token)) {
      targetTokens.push({ type: "id", value: Number(token) });
      cursor += 1;
      continue;
    }
    break;
  }

  let durationMinutes: number | null = null;
  if (options.allowDuration && cursor < tokens.length) {
    const token = tokens[cursor];
    const eligible = !options.requireDurationUnit || DURATION_TOKEN_WITH_UNIT_PATTERN.test(token);
    const parsed = eligible ? parseDurationToken(token) : null;
    if (parsed !== null) {
      durationMinutes = parsed;
      cursor += 1;
    }
  }

  const reason = tokens.slice(cursor).join(" ").trim() || null;
  return { targetTokens, durationMinutes, reason };
}
