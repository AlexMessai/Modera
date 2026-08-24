import { prisma } from "@/server/db/prisma";

export const LINK_PROTECTION_MODES = ["ALLOW_ALL", "BLOCK_ALL", "WHITELIST_ONLY", "BLACKLIST_ONLY"] as const;
export type LinkProtectionMode = (typeof LINK_PROTECTION_MODES)[number];

export function isLinkProtectionMode(value: string): value is LinkProtectionMode {
  return (LINK_PROTECTION_MODES as readonly string[]).includes(value);
}

export type EscalationRuleAction = "MUTE" | "BAN";

export type EscalationRuleValue = {
  /** List position, admin-controlled (drag-to-reorder in the UI) — display only, not evaluation order. */
  order: number;
  thresholdWarnings: number;
  action: EscalationRuleAction;
  /** Minutes; null = permanent (indefinite mute, or permanent ban). */
  durationMinutes: number | null;
};

// Keep these in sync with moderation-service.ts's MUTE_DURATION_MINUTES_MAX /
// BAN_DURATION_MINUTES_MAX — not imported from there to avoid a settings
// service depending on the moderation-execution service for two numbers.
const ESCALATION_DURATION_MAX_BY_ACTION: Record<EscalationRuleAction, number> = {
  MUTE: 10080,
  BAN: 366 * 24 * 60
};
const MAX_ESCALATION_RULES = 20;

// All 12 restrictable content types, each managed individually via its own
// `mediaFilters` entry -- the old flat `blockedMessageTypes` list has been
// removed entirely (see automod-service.ts, which reads exclusively from
// mediaFilters now).
export const MEDIA_FILTER_TYPES = [
  "PHOTO", "VIDEO", "ANIMATION", "VOICE", "AUDIO", "VIDEO_NOTE", "DICE",
  "DOCUMENT", "STICKER", "POLL", "LOCATION", "CONTACT"
] as const;
export type MediaFilterType = (typeof MEDIA_FILTER_TYPES)[number];

export type MediaFilterRuleValue = {
  type: MediaFilterType;
  enabled: boolean;
  deleteMessage: boolean;
  punishmentEnabled: boolean;
  punishmentAction: AutomodPunishmentAction;
  muteDurationMinutes: number;
  /** Legacy mirror retained while older stored JSON and the system-messages API are migrated. */
  warnOnTrigger: boolean;
  notifyEnabled: boolean;
  notifyText: string;
};

export const AUTOMOD_ACTION_RULES = ["LINK", "TERM", "SPAM", "DUPLICATE", "MENTIONS"] as const;
export type AutomodActionRule = (typeof AUTOMOD_ACTION_RULES)[number];
export type AutomodPunishmentAction = "WARN" | "MUTE";

export type AutomodRuleActionValue = {
  rule: AutomodActionRule;
  deleteMessage: boolean;
  punishmentEnabled: boolean;
  punishmentAction: AutomodPunishmentAction;
  muteDurationMinutes: number;
  notifyEnabled: boolean;
  /** Intentionally allowed to be empty: the modal textarea starts blank. */
  notifyText: string;
};

const DEFAULT_AUTOMOD_MUTE_DURATION_MINUTES = 60;
const MAX_AUTOMOD_MUTE_DURATION_MINUTES = 30 * 24 * 60;

function defaultAutomodRuleActions(punishmentEnabled: boolean): AutomodRuleActionValue[] {
  return AUTOMOD_ACTION_RULES.map((rule) => ({
    rule,
    deleteMessage: true,
    punishmentEnabled,
    punishmentAction: "WARN",
    muteDurationMinutes: DEFAULT_AUTOMOD_MUTE_DURATION_MINUTES,
    notifyEnabled: false,
    notifyText: ""
  }));
}

export const DEFAULT_MEDIA_FILTERS: MediaFilterRuleValue[] = MEDIA_FILTER_TYPES.map((type) => ({
  type,
  enabled: false,
  deleteMessage: true,
  punishmentEnabled: false,
  punishmentAction: "WARN",
  muteDurationMinutes: DEFAULT_AUTOMOD_MUTE_DURATION_MINUTES,
  warnOnTrigger: false,
  notifyEnabled: false,
  notifyText: ""
}));

const MAX_MEDIA_FILTER_NOTIFY_TEXT_LENGTH = 1000;

export const DEFAULT_MODERATION_SETTINGS = {
  linkEnabled: false,
  linkProtectionMode: "ALLOW_ALL" as LinkProtectionMode,
  allowedDomains: [] as string[],
  blockedDomains: [] as string[],
  spamEnabled: false,
  spamWindowSeconds: 10,
  spamMaxMessages: 5,
  blockedTermsEnabled: false,
  blockedTerms: [] as string[],
  massMentionsEnabled: false,
  maxMentions: 5,
  duplicateEnabled: false,
  duplicateWindowSeconds: 60,
  duplicateMaxMessages: 2,
  ignoreAdmins: true,
  autoEscalationEnabled: false,
  escalationRules: [
    { order: 1, thresholdWarnings: 3, action: "MUTE", durationMinutes: 10 },
    { order: 2, thresholdWarnings: 6, action: "BAN", durationMinutes: null }
  ] as EscalationRuleValue[],
  warningExpiryDays: 0,
  announceEscalationEnabled: false,
  escalationMuteMessageTemplate: "🔇 %target% получил(а) mute на %duration% за нарушение правил чата. Предупреждений: %warns% из %warns_limit%.",
  escalationBanMessageTemplate: "⛔ %target% заблокирован(а) за нарушение правил чата. Предупреждений: %warns% из %warns_limit%.",
  mediaFilters: DEFAULT_MEDIA_FILTERS,
  ruleActions: defaultAutomodRuleActions(false)
};

export type ModerationSettingsValue = typeof DEFAULT_MODERATION_SETTINGS;

/**
 * Looser input shape accepted by normalize/serialize below: `escalationRules`
 * comes in either well-typed (from API input already parsed by Zod) or as
 * raw `Prisma.JsonValue` (a DB row read straight from `ChatModerationSettings`/
 * `GlobalModerationSettings`) — normalizeEscalationRules validates either.
 */
type ModerationSettingsInput = Omit<ModerationSettingsValue, "escalationRules" | "linkProtectionMode" | "mediaFilters" | "ruleActions"> & {
  escalationRules: unknown;
  linkProtectionMode: string;
  mediaFilters: unknown;
  ruleActions: unknown;
};

/** The lowest configured threshold — the closest analog to the old single "warns_limit" number for chat-reply placeholders. */
export function lowestEscalationThreshold(rules: EscalationRuleValue[]): number | null {
  if (rules.length === 0) return null;
  return rules.reduce((min, rule) => Math.min(min, rule.thresholdWarnings), Infinity);
}

/**
 * Highest-threshold rule that's been crossed but not yet fired (marker below
 * its threshold) — evaluated by thresholdWarnings, not by `order` (a purely
 * cosmetic list-position field), so the *strongest* applicable action always
 * wins when a member's warning count jumps past multiple thresholds at once
 * (e.g. straight past mute's threshold to ban's in one automod hit).
 */
export function findTriggeredEscalationRule(
  rules: EscalationRuleValue[],
  activeWarningCount: number,
  escalationMarker: number
): EscalationRuleValue | null {
  const candidates = rules
    .filter((rule) => activeWarningCount >= rule.thresholdWarnings && escalationMarker < rule.thresholdWarnings)
    .sort((a, b) => b.thresholdWarnings - a.thresholdWarnings);
  return candidates[0] ?? null;
}

/** The enabled rule for a message type, or null when that type isn't a Filters-managed type or isn't enabled. */
export function findEnabledMediaFilterRule(rules: MediaFilterRuleValue[], messageType: string): MediaFilterRuleValue | null {
  const rule = rules.find((candidate) => candidate.type === messageType);
  return rule?.enabled ? rule : null;
}

export function normalizeEscalationRules(input: unknown): EscalationRuleValue[] {
  if (!Array.isArray(input)) return [];
  const rules: EscalationRuleValue[] = [];
  for (const raw of input.slice(0, MAX_ESCALATION_RULES)) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<EscalationRuleValue>;
    if (candidate.action !== "MUTE" && candidate.action !== "BAN") continue;
    const action = candidate.action;
    const thresholdWarnings = boundedInteger(Number(candidate.thresholdWarnings), 1, 999);
    const durationMinutes = candidate.durationMinutes === null || candidate.durationMinutes === undefined
      ? null
      : boundedInteger(Number(candidate.durationMinutes), 1, ESCALATION_DURATION_MAX_BY_ACTION[action]);
    rules.push({ order: rules.length + 1, thresholdWarnings, action, durationMinutes });
  }
  return rules;
}

function normalizeDomain(value: string) {
  const trimmed = value.trim().toLowerCase().replace(/^\.+/, "");
  if (!trimmed) return null;

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return hostname || null;
  } catch {
    return null;
  }
}

function normalizeDomains(values: string[]) {
  return Array.from(
    new Set(values.map(normalizeDomain).filter((value): value is string => Boolean(value)))
  ).slice(0, 100);
}

function normalizeText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ").trim();
}

function normalizeTerms(values: string[]) {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean))).slice(0, 200);
}

function boundedInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeEscalationTemplate(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 1000) : fallback;
}

const MEDIA_FILTER_TYPE_SET = new Set<string>(MEDIA_FILTER_TYPES);

function isMediaFilterType(value: unknown): value is MediaFilterType {
  return typeof value === "string" && MEDIA_FILTER_TYPE_SET.has(value);
}

/**
 * One entry per MEDIA_FILTER_TYPES — always the full set, in that order,
 * regardless of what's in `input` (a type missing from the raw input keeps
 * its default-disabled row rather than silently dropping out of the list,
 * so the admin UI always has all 12 cards to render).
 */
export function normalizeMediaFilters(input: unknown): MediaFilterRuleValue[] {
  const byType = new Map<MediaFilterType, MediaFilterRuleValue>();
  if (Array.isArray(input)) {
    for (const raw of input) {
      if (!raw || typeof raw !== "object") continue;
      const candidate = raw as Partial<MediaFilterRuleValue>;
      if (!isMediaFilterType(candidate.type)) continue;
      const notifyText = typeof candidate.notifyText === "string" ? candidate.notifyText.trim() : "";
      const punishmentEnabled = typeof candidate.punishmentEnabled === "boolean"
        ? candidate.punishmentEnabled
        : Boolean(candidate.warnOnTrigger);
      const punishmentAction = candidate.punishmentAction === "MUTE" ? "MUTE" : "WARN";
      byType.set(candidate.type, {
        type: candidate.type,
        enabled: Boolean(candidate.enabled),
        deleteMessage: candidate.deleteMessage !== false,
        punishmentEnabled,
        punishmentAction,
        muteDurationMinutes: candidate.muteDurationMinutes === undefined
          ? DEFAULT_AUTOMOD_MUTE_DURATION_MINUTES
          : boundedInteger(Number(candidate.muteDurationMinutes), 15, MAX_AUTOMOD_MUTE_DURATION_MINUTES),
        warnOnTrigger: punishmentEnabled && punishmentAction === "WARN",
        notifyEnabled: Boolean(candidate.notifyEnabled),
        notifyText: notifyText.slice(0, MAX_MEDIA_FILTER_NOTIFY_TEXT_LENGTH)
      });
    }
  }
  return MEDIA_FILTER_TYPES.map((type) => byType.get(type) ?? DEFAULT_MEDIA_FILTERS.find((rule) => rule.type === type)!);
}

function isAutomodActionRule(value: unknown): value is AutomodActionRule {
  return typeof value === "string" && (AUTOMOD_ACTION_RULES as readonly string[]).includes(value);
}

/**
 * Empty/legacy JSON means the chat predates per-rule outcomes. Mirror its old
 * chat-wide escalation toggle so rollout does not silently change behavior.
 * Once saved, the API writes the complete five-rule array.
 */
export function normalizeAutomodRuleActions(
  input: unknown,
  legacyPunishmentEnabled = false
): AutomodRuleActionValue[] {
  const byRule = new Map<AutomodActionRule, AutomodRuleActionValue>();
  if (Array.isArray(input)) {
    for (const raw of input) {
      if (!raw || typeof raw !== "object") continue;
      const candidate = raw as Partial<AutomodRuleActionValue>;
      if (!isAutomodActionRule(candidate.rule)) continue;
      byRule.set(candidate.rule, {
        rule: candidate.rule,
        deleteMessage: candidate.deleteMessage !== false,
        punishmentEnabled: Boolean(candidate.punishmentEnabled),
        punishmentAction: candidate.punishmentAction === "MUTE" ? "MUTE" : "WARN",
        muteDurationMinutes: boundedInteger(Number(candidate.muteDurationMinutes), 15, MAX_AUTOMOD_MUTE_DURATION_MINUTES),
        notifyEnabled: Boolean(candidate.notifyEnabled),
        notifyText: typeof candidate.notifyText === "string" ? candidate.notifyText.trim().slice(0, 1000) : ""
      });
    }
  }
  const fallback = defaultAutomodRuleActions(legacyPunishmentEnabled);
  return AUTOMOD_ACTION_RULES.map((rule) => byRule.get(rule) ?? fallback.find((item) => item.rule === rule)!);
}

export function getAutomodRuleAction(actions: AutomodRuleActionValue[], rule: AutomodActionRule) {
  return actions.find((action) => action.rule === rule)
    ?? defaultAutomodRuleActions(false).find((action) => action.rule === rule)!;
}

export function normalizeModerationSettings(input: ModerationSettingsInput): ModerationSettingsValue {
  return {
    linkEnabled: input.linkEnabled,
    linkProtectionMode: isLinkProtectionMode(input.linkProtectionMode) ? input.linkProtectionMode : "ALLOW_ALL",
    allowedDomains: normalizeDomains(input.allowedDomains),
    blockedDomains: normalizeDomains(input.blockedDomains),
    spamEnabled: input.spamEnabled,
    spamWindowSeconds: input.spamWindowSeconds,
    spamMaxMessages: input.spamMaxMessages,
    blockedTermsEnabled: input.blockedTermsEnabled,
    blockedTerms: normalizeTerms(input.blockedTerms),
    massMentionsEnabled: input.massMentionsEnabled,
    maxMentions: input.maxMentions,
    duplicateEnabled: input.duplicateEnabled,
    duplicateWindowSeconds: input.duplicateWindowSeconds,
    duplicateMaxMessages: input.duplicateMaxMessages,
    ignoreAdmins: input.ignoreAdmins,
    autoEscalationEnabled: input.autoEscalationEnabled,
    escalationRules: normalizeEscalationRules(input.escalationRules),
    warningExpiryDays: boundedInteger(input.warningExpiryDays, 0, 3650),
    announceEscalationEnabled: input.announceEscalationEnabled,
    escalationMuteMessageTemplate: normalizeEscalationTemplate(input.escalationMuteMessageTemplate, DEFAULT_MODERATION_SETTINGS.escalationMuteMessageTemplate),
    escalationBanMessageTemplate: normalizeEscalationTemplate(input.escalationBanMessageTemplate, DEFAULT_MODERATION_SETTINGS.escalationBanMessageTemplate),
    mediaFilters: normalizeMediaFilters(input.mediaFilters),
    ruleActions: normalizeAutomodRuleActions(input.ruleActions, input.autoEscalationEnabled)
  };
}

export function serializeModerationSettings(settings: ModerationSettingsInput): ModerationSettingsValue {
  return {
    linkEnabled: settings.linkEnabled,
    linkProtectionMode: isLinkProtectionMode(settings.linkProtectionMode) ? settings.linkProtectionMode : "ALLOW_ALL",
    allowedDomains: [...settings.allowedDomains],
    blockedDomains: [...settings.blockedDomains],
    spamEnabled: settings.spamEnabled,
    spamWindowSeconds: settings.spamWindowSeconds,
    spamMaxMessages: settings.spamMaxMessages,
    blockedTermsEnabled: settings.blockedTermsEnabled,
    blockedTerms: [...settings.blockedTerms],
    massMentionsEnabled: settings.massMentionsEnabled,
    maxMentions: settings.maxMentions,
    duplicateEnabled: settings.duplicateEnabled,
    duplicateWindowSeconds: settings.duplicateWindowSeconds,
    duplicateMaxMessages: settings.duplicateMaxMessages,
    ignoreAdmins: settings.ignoreAdmins,
    autoEscalationEnabled: settings.autoEscalationEnabled,
    escalationRules: normalizeEscalationRules(settings.escalationRules),
    warningExpiryDays: settings.warningExpiryDays,
    announceEscalationEnabled: settings.announceEscalationEnabled,
    escalationMuteMessageTemplate: settings.escalationMuteMessageTemplate,
    escalationBanMessageTemplate: settings.escalationBanMessageTemplate,
    mediaFilters: normalizeMediaFilters(settings.mediaFilters),
    ruleActions: normalizeAutomodRuleActions(settings.ruleActions, settings.autoEscalationEnabled)
  };
}

const GLOBAL_MODERATION_MESSAGES_ID = "global";

/**
 * Escalation announcements remain global. Filter messages are chat-owned and
 * edited next to the rule outcome, matching the Automod rule model.
 */
async function overlayGlobalModerationText(settings: ModerationSettingsValue): Promise<ModerationSettingsValue> {
  const global = await prisma.globalModerationSettings.findUnique({
    where: { id: GLOBAL_MODERATION_MESSAGES_ID },
    select: { escalationMuteMessageTemplate: true, escalationBanMessageTemplate: true }
  });
  return {
    ...settings,
    escalationMuteMessageTemplate: global?.escalationMuteMessageTemplate ?? DEFAULT_MODERATION_SETTINGS.escalationMuteMessageTemplate,
    escalationBanMessageTemplate: global?.escalationBanMessageTemplate ?? DEFAULT_MODERATION_SETTINGS.escalationBanMessageTemplate
  };
}

export async function resolveEffectiveModerationSettings(chatId: string) {
  const local = await prisma.chatModerationSettings.findUnique({
    where: { chatId }
  });

  const settings = await overlayGlobalModerationText(serializeModerationSettings(local ?? DEFAULT_MODERATION_SETTINGS));

  return {
    source: "CHAT" as const,
    useGlobalProfile: false,
    settings
  };
}
