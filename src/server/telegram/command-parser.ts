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
 * Duration syntax is unified across every command that takes one (/mute,
 * /ban): a number followed by a unit, m/h/d (10m, 2h, 3d). No duration token
 * at all means the punishment is permanent — there is no bare-number-as-
 * minutes fallback anymore. A bare number right where a duration could go
 * is never absorbed into the reason either; it's flagged via
 * `durationUnitMissing` so the caller rejects the command outright instead
 * of guessing what the moderator meant.
 */

export type ModerationTargetToken =
  | { type: "username"; value: string }
  | { type: "id"; value: number };

export interface ParsedModerationCommandArguments {
  targetTokens: ModerationTargetToken[];
  durationMinutes: number | null;
  /** A bare number sat where a duration was expected, with no m/h/d unit --
   * the caller should reject the command and ask for an explicit unit,
   * rather than treating the number as the start of the reason or guessing
   * a unit for it. */
  durationUnitMissing: boolean;
  reason: string | null;
}

const USERNAME_TOKEN_PATTERN = /^@([a-zA-Z0-9_]{3,32})$/;
const TELEGRAM_ID_TOKEN_PATTERN = /^\d{6,}$/;
const DURATION_TOKEN_WITH_UNIT_PATTERN = /^(\d+)(m|h|d)$/i;
const BARE_NUMBER_PATTERN = /^\d+$/;

const MINUTES_PER_UNIT: Record<string, number> = {
  m: 1,
  h: 60,
  d: 60 * 24
};

/** Minutes, or null if the token isn't a valid `<number><m|h|d>` duration. */
export function parseDurationToken(token: string): number | null {
  const match = DURATION_TOKEN_WITH_UNIT_PATTERN.exec(token);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount * MINUTES_PER_UNIT[match[2].toLowerCase()];
}

export function parseModerationCommandArguments(
  argsText: string,
  options: { allowDuration: boolean }
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
  let durationUnitMissing = false;
  if (options.allowDuration && cursor < tokens.length) {
    const token = tokens[cursor];
    const parsed = parseDurationToken(token);
    if (parsed !== null) {
      durationMinutes = parsed;
      cursor += 1;
    } else if (BARE_NUMBER_PATTERN.test(token)) {
      durationUnitMissing = true;
    }
  }

  const reason = tokens.slice(cursor).join(" ").trim() || null;
  return { targetTokens, durationMinutes, durationUnitMissing, reason };
}
