import { prisma } from "@/server/db/prisma";
import { canModerate } from "@/server/auth/permissions";
import { consumeLinkCode } from "@/server/services/admin-link-service";
import { deliverPendingAppealNotifications, parseAppealCallbackData } from "@/server/services/appeal-notification-service";
import { AppealError, resolveAppeal, submitAppealFromReply } from "@/server/services/appeal-service";
import { processAutomodMessage } from "@/server/services/automod-service";
import { maybeIssueCaptchaChallenge, parseCaptchaCallbackData, verifyCaptchaChallenge } from "@/server/services/captcha-service";
import { hasChatPermission, type ChatPermission } from "@/server/services/chat-role-service";
import { markBotChatTelegramError, syncTelegramChat, upsertTelegramBot } from "@/server/services/chat-service";
import { recordTelegramJoinRequest } from "@/server/services/join-request-service";
import {
  getInfoCardBasics,
  observeMember,
  resolveTelegramTargets,
  syncChatMemberUpdate,
  syncJoinRequest,
  syncKnownAdministrators,
  syncObservedMessage,
  syncServiceMemberships,
  type ResolvedModerationTarget
} from "@/server/services/member-service";
import {
  describeWarningStanding,
  escalateAfterManualWarning,
  listWarningsForMember,
  recordAutomodViolationAndEscalate,
  type ManualWarningEscalation
} from "@/server/services/moderation-escalation-service";
import { resolveEffectiveModerationSettings } from "@/server/services/global-moderation-service";
import { getModerationContext } from "@/server/services/moderation-context";
import { reconcileTelegramMemberState } from "@/server/services/moderation-reconciliation-service";
import {
  executeTelegramActorModerationAction,
  executeTelegramActorWarningRevoke,
  ModerationError,
  type ModerationActionValue
} from "@/server/services/moderation-service";
import { renderManualModerationTemplate, resolveEffectiveManualModerationSettings, type ManualModerationSettingsValue } from "@/server/services/manual-moderation-settings-service";
import { getSelfServiceStatusMessage, listActiveMutes, selfUnmute } from "@/server/services/self-unmute-service";
import { isTrustedTelegramMember, TRUSTED_INTERNAL_ROLE } from "@/server/services/trusted-member-service";
import { parseModerationCommandArguments } from "@/server/telegram/command-parser";
import { buildAdminRightsDeepLinkParam, getTelegramBotProfile, getTelegramClient, GROUP_ADMIN_RIGHTS, TelegramApiError } from "@/server/telegram/client";
import type { TelegramChat, TelegramChatMember, TelegramChatMemberUpdated, TelegramInlineKeyboardMarkup, TelegramMessage, TelegramUpdate } from "@/server/telegram/types";

const BOT_CHAT_REFRESH_MS = 5 * 60 * 1000;
const RULE_BY_AUTOMOD_RESULT: Record<string, string> = {
  DELETED_LINK: "LINK",
  DELETED_TERM: "TERM",
  DELETED_MEDIA: "MEDIA",
  DELETED_MENTIONS: "MENTIONS",
  DELETED_DUPLICATE: "DUPLICATE",
  DELETED_SPAM: "SPAM"
};

function extractChat(update: TelegramUpdate): TelegramChat | null {
  return update.my_chat_member?.chat ?? update.chat_member?.chat ?? update.message?.chat ?? update.edited_message?.chat ?? update.chat_join_request?.chat ?? update.callback_query?.message?.chat ?? null;
}

function updateDate(update: TelegramUpdate) {
  const seconds = update.message?.date ?? update.edited_message?.edit_date ?? update.edited_message?.date ?? update.my_chat_member?.date ?? update.chat_member?.date ?? update.chat_join_request?.date ?? update.callback_query?.message?.date;
  return seconds ? new Date(seconds * 1000) : new Date();
}

function explicitBotMember(update: TelegramUpdate, botId: number) {
  const member = update.my_chat_member?.new_chat_member;
  return member?.user.id === botId ? member : null;
}

function isNewMemberJoin(update: TelegramChatMemberUpdated) {
  const previous = update.old_chat_member.status;
  const next = update.new_chat_member.status;
  return (previous === "left" || previous === "kicked") && (next === "member" || next === "restricted");
}

async function runAutomod(input: { chatId: string; message: TelegramMessage; isEdited: boolean }) {
  if (!input.message.from || input.message.from.is_bot) return;
  if (await isTrustedTelegramMember(input.chatId, input.message.from.id)) return;

  const result = await processAutomodMessage(input);
  const rule = RULE_BY_AUTOMOD_RESULT[result.result];
  if (!rule) return;
  const violation = {
    chatId: input.chatId,
    telegramUserId: input.message.from.id,
    rule,
    telegramMessageId: String(input.message.message_id)
  };
  const escalation = await recordAutomodViolationAndEscalate(violation).catch(() => undefined);
  if (!escalation?.escalated || !escalation.action) return;

  const { settings } = await resolveEffectiveModerationSettings(input.chatId);
  if (!settings.announceEscalationEnabled) return;

  const template = escalation.action === "MUTE"
    ? settings.escalationMuteMessageTemplate
    : settings.escalationBanMessageTemplate;
  const text = renderManualModerationTemplate(template, {
    admin: "Modera",
    target: telegramDisplayName(input.message.from),
    reason: "",
    duration: escalation.action === "MUTE" && escalation.muteDurationMinutes ? formatMinutes(escalation.muteDurationMinutes) : "",
    warns: String(escalation.activeWarningCount ?? escalation.warningCount ?? ""),
    warnsLimit: escalation.threshold !== undefined ? String(escalation.threshold) : ""
  });
  await getTelegramClient().sendMessage({ chatId: input.message.chat.id, text }).catch(() => undefined);
}

// Telegram posts this into the group automatically right after someone adds
// the bot via a t.me/<bot>?startgroup=... deep link — it's plumbing noise,
// not a real command, so it's deleted rather than run through automod.
const GROUP_START_NOISE_PATTERN = /^\/start(?:@\w+)?(?:\s+\S+)?\s*$/i;

// Every moderation command shares one shape: /command[@bot] [targets…] [duration] [reason].
// Which of those trailing pieces apply (duration only for /mute today) is decided by
// GROUP_MODERATION_COMMANDS below, then command-parser.ts does the actual argument split.
const GROUP_MODERATION_COMMAND_PATTERN = /^\/(warn|unwarn|mute|unmute|ban|unban|kick)(?:@\w+)?(?:\s+([\s\S]*))?$/i;

const GROUP_MODERATION_COMMANDS: Record<string, { action: GroupModerationCommand; allowDuration: boolean; requireDurationUnit?: boolean }> = {
  warn: { action: "WARNING", allowDuration: false },
  unwarn: { action: "UNWARN", allowDuration: false },
  mute: { action: "MUTE", allowDuration: true },
  unmute: { action: "UNMUTE", allowDuration: false },
  // Ban's duration is optional (a bare /ban stays permanent) — unlike mute,
  // there's no "укажите срок" requirement blocking the command without one.
  // requireDurationUnit: BAN has no legacy bare-minutes syntax to preserve,
  // so require an explicit unit (7d/3h) rather than risk misreading a reason
  // that starts with a digit as a duration.
  ban: { action: "BAN", allowDuration: true, requireDurationUnit: true },
  unban: { action: "UNBAN", allowDuration: false },
  kick: { action: "KICK", allowDuration: false }
};

/** /unwarn is not a ModerationActionValue — it only takes a warning back locally. */
type GroupModerationCommand = ModerationActionValue | "UNWARN";

const TEMPLATE_FIELDS_BY_ACTION: Record<GroupModerationCommand, {
  template: keyof ManualModerationSettingsValue;
  deleteTarget: keyof ManualModerationSettingsValue;
  announceInChat: keyof ManualModerationSettingsValue;
}> = {
  WARNING: { template: "warnMessageTemplate", deleteTarget: "warnDeleteTargetMessage", announceInChat: "warnAnnounceInChat" },
  UNWARN: { template: "unwarnMessageTemplate", deleteTarget: "unwarnDeleteTargetMessage", announceInChat: "unwarnAnnounceInChat" },
  MUTE: { template: "muteMessageTemplate", deleteTarget: "muteDeleteTargetMessage", announceInChat: "muteAnnounceInChat" },
  UNMUTE: { template: "unmuteMessageTemplate", deleteTarget: "unmuteDeleteTargetMessage", announceInChat: "unmuteAnnounceInChat" },
  BAN: { template: "banMessageTemplate", deleteTarget: "banDeleteTargetMessage", announceInChat: "banAnnounceInChat" },
  UNBAN: { template: "unbanMessageTemplate", deleteTarget: "unbanDeleteTargetMessage", announceInChat: "unbanAnnounceInChat" },
  KICK: { template: "kickMessageTemplate", deleteTarget: "kickDeleteTargetMessage", announceInChat: "kickAnnounceInChat" }
};

const CHAT_PERMISSION_BY_ACTION: Record<GroupModerationCommand, ChatPermission> = {
  WARNING: "moderation.warn",
  UNWARN: "moderation.warn",
  MUTE: "moderation.mute",
  UNMUTE: "moderation.mute",
  BAN: "moderation.ban",
  UNBAN: "moderation.ban",
  KICK: "moderation.kick"
};

function telegramDisplayName(user: { first_name?: string; last_name?: string; username?: string; id: number }) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (user.username) return `@${user.username}`;
  return `Telegram ${user.id}`;
}

function formatMinutes(minutes: number) {
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} дн.`;
  if (minutes % 60 === 0) return `${minutes / 60} ч.`;
  return `${minutes} мин.`;
}

/** One rendered outcome line — `announceInChat` says whether it also belongs in the public chat message, not just the admin's private summary. */
type ModerationOutcomeLine = { text: string; announceInChat: boolean };

/** Runs the moderation action against a single already-resolved target; used in a loop for multi-target commands. */
async function applyModerationCommandToTarget(input: {
  chatId: string;
  action: GroupModerationCommand;
  target: ResolvedModerationTarget;
  reason: string | null;
  /** Minutes; applies to MUTE or BAN depending on `action` — null means permanent/no duration. */
  durationMinutes: number | null;
  telegramActor: { telegramUserId: number; username?: string; displayName?: string };
  settings: ManualModerationSettingsValue;
}): Promise<ModerationOutcomeLine[]> {
  const fields = TEMPLATE_FIELDS_BY_ACTION[input.action];
  let warns = "";
  let warnsLimit = "";
  let escalation: ManualWarningEscalation | null = null;

  if (input.action === "UNWARN") {
    const revoked = await executeTelegramActorWarningRevoke({
      chatId: input.chatId,
      targetTelegramUserId: input.target.telegramUserId,
      telegramActor: input.telegramActor
    });
    const remaining = await describeWarningStanding({
      chatId: revoked.chatId,
      affectedUserId: revoked.affectedUserId
    });
    warns = String(remaining.activeWarningCount);
    warnsLimit = remaining.warnsLimit !== null ? String(remaining.warnsLimit) : "";
  } else {
    await executeTelegramActorModerationAction({
      chatId: input.chatId,
      targetTelegramUserId: input.target.telegramUserId,
      action: input.action,
      reason: input.reason,
      muteDurationMinutes: input.action === "MUTE" ? input.durationMinutes : null,
      banDurationMinutes: input.action === "BAN" ? input.durationMinutes : null,
      telegramActor: input.telegramActor
    });

    if (input.action === "WARNING") {
      escalation = await escalateAfterManualWarning({
        chatId: input.chatId,
        targetTelegramUserId: input.target.telegramUserId,
        reason: input.reason ?? "Предупреждение от администратора чата"
      });
      warns = String(escalation.activeWarningCount);
      warnsLimit = escalation.warnsLimit !== null ? String(escalation.warnsLimit) : "";
    }
  }

  const placeholders = {
    admin: input.telegramActor.displayName ?? input.telegramActor.username ?? "Администратор",
    target: input.target.displayName,
    reason: input.reason ?? "",
    duration: (input.action === "MUTE" || input.action === "BAN") && input.durationMinutes ? formatMinutes(input.durationMinutes) : "",
    warns,
    warnsLimit
  };
  // Rendered unconditionally — the admin running the command always gets a
  // private confirmation that the action went through, even when public
  // chat announcements are switched off (silent moderation is the default;
  // "silent" means the chat stays quiet, not that the admin is left guessing).
  const lines: ModerationOutcomeLine[] = [{
    text: renderManualModerationTemplate(input.settings[fields.template] as string, placeholders),
    announceInChat: Boolean(input.settings[fields.announceInChat])
  }];

  // The warning that crossed the threshold also triggered a punishment — say so
  // in the same summary rather than leaving the admin to guess why the mute landed.
  // Visibility follows the escalated action's own toggle (mute/ban), not warn's --
  // they're different actions and can be configured to show independently in chat.
  if (escalation?.escalated && escalation.action) {
    const escalationFields = TEMPLATE_FIELDS_BY_ACTION[escalation.action];
    lines.push({
      text: renderManualModerationTemplate(
        input.settings[escalationFields.template] as string,
        {
          ...placeholders,
          admin: "Modera",
          reason: `Достигнут порог ${escalation.threshold ?? escalation.warnsLimit} предупреждений.`,
          duration: escalation.muteDurationMinutes ? formatMinutes(escalation.muteDurationMinutes) : ""
        }
      ),
      announceInChat: Boolean(input.settings[escalationFields.announceInChat])
    });
  }

  return lines;
}

async function processGroupModerationCommand(input: {
  chatId: string;
  telegramChatId: number;
  message: TelegramMessage;
  client: ReturnType<typeof getTelegramClient>;
}): Promise<boolean> {
  const text = input.message.text?.trim() ?? "";
  const from = input.message.from;
  if (!from || from.is_bot) return false;

  const commandMatch = GROUP_MODERATION_COMMAND_PATTERN.exec(text);
  if (!commandMatch) return false;

  const commandName = commandMatch[1].toLowerCase();
  const config = GROUP_MODERATION_COMMANDS[commandName];
  if (!config) return false;
  const { action, allowDuration, requireDurationUnit } = config;

  const { targetTokens, durationMinutes, reason } = parseModerationCommandArguments(
    commandMatch[2] ?? "",
    { allowDuration, requireDurationUnit }
  );

  // Validation hints, per-target errors, and the admin's own action summary
  // (below) are for whoever ran the command, not the rest of the chat — sent
  // ephemeral (Bot API 10.2, visible only to `from`) rather than as a normal
  // chat message. Only the separately-sent public announcement (also below,
  // gated by the *AnnounceInChat setting) is meant for the whole chat.
  const privateReply = (replyText: string) =>
    input.client.sendMessage({ chatId: input.telegramChatId, text: replyText, receiverUserId: from.id }).catch(() => undefined);

  // The command text itself (e.g. "/warn спам") never belongs in the chat —
  // delete it immediately, before any validation, so it disappears whether
  // the command succeeds, fails permission/format checks, or errors out.
  await input.client.deleteMessage(input.telegramChatId, input.message.message_id).catch(() => undefined);

  const allowed = await hasChatPermission({
    chatId: input.chatId,
    chatTelegramId: input.telegramChatId,
    telegramUserId: from.id,
    permission: CHAT_PERMISSION_BY_ACTION[action]
  });
  if (!allowed) {
    await privateReply("❌ У вас нет прав администратора в этом чате.");
    return true;
  }

  let targets: ResolvedModerationTarget[] = [];
  let unresolvedUsernames: string[] = [];
  if (targetTokens.length > 0) {
    const resolution = await resolveTelegramTargets({ chatId: input.chatId, tokens: targetTokens });
    targets = resolution.resolved;
    unresolvedUsernames = resolution.unresolvedUsernames;
  } else if (input.message.reply_to_message?.from) {
    const replyFrom = input.message.reply_to_message.from;
    targets = [{
      telegramUserId: replyFrom.id,
      displayName: telegramDisplayName(replyFrom),
      token: { type: "id", value: replyFrom.id }
    }];
  }

  if (targets.length === 0) {
    await privateReply(unresolvedUsernames.length > 0
      ? `Не удалось найти в этом чате: ${unresolvedUsernames.map((name) => `@${name}`).join(", ")}.`
      : "Укажите цель: ответьте (Reply) на сообщение участника, либо укажите @username или Telegram ID после команды.");
    return true;
  }

  if (action === "MUTE" && !durationMinutes) {
    await privateReply("Укажите срок mute, например: /mute @user 3h причина (или в минутах: /mute 180 причина)");
    return true;
  }

  const telegramActor = {
    telegramUserId: from.id,
    username: from.username,
    displayName: [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || undefined
  };

  const { settings } = await resolveEffectiveManualModerationSettings(input.chatId);
  // Only meaningful in reply mode — target-token commands (@username/ID) have
  // no "message this was a reply to" to delete.
  if (settings[TEMPLATE_FIELDS_BY_ACTION[action].deleteTarget] && input.message.reply_to_message) {
    await input.client.deleteMessage(input.telegramChatId, input.message.reply_to_message.message_id).catch(() => undefined);
  }

  // publicLines only holds lines whose *AnnounceInChat setting is on —
  // adminSummaryLines holds every outcome regardless, so the admin who ran
  // the command always gets private confirmation that it went through, even
  // when the chat itself stays silent (the default).
  const publicLines: string[] = [];
  const adminSummaryLines: string[] = [];
  for (const target of targets) {
    try {
      const outcomes = await applyModerationCommandToTarget({
        chatId: input.chatId,
        action,
        target,
        reason,
        durationMinutes,
        telegramActor,
        settings
      });
      for (const outcome of outcomes) {
        const line = targets.length > 1 ? `${target.displayName}: ${outcome.text}` : outcome.text;
        adminSummaryLines.push(line);
        if (outcome.announceInChat) publicLines.push(line);
      }
    } catch (error) {
      const message = error instanceof ModerationError ? error.message : "Не удалось выполнить действие модерации.";
      adminSummaryLines.push(`❌ ${target.displayName}: ${message}`);
    }
  }
  if (unresolvedUsernames.length > 0) {
    adminSummaryLines.push(`❌ Не найдены в чате: ${unresolvedUsernames.map((name) => `@${name}`).join(", ")}`);
  }

  if (publicLines.length > 0) {
    await input.client.sendMessage({ chatId: input.telegramChatId, text: publicLines.join("\n") }).catch(() => undefined);
  }
  if (adminSummaryLines.length > 0) {
    await privateReply(adminSummaryLines.join("\n"));
  }

  return true;
}

const WARNS_COMMAND_PATTERN = /^\/warns(?:@\w+)?(?:\s+([\s\S]*))?$/i;

/**
 * /warns — a read-only lookup, so unlike the punishment commands it replies
 * ephemerally (visible only to the admin who asked) rather than posting the
 * target's warning history into the chat for everyone to see.
 */
async function processWarnsCommand(input: {
  chatId: string;
  telegramChatId: number;
  message: TelegramMessage;
  client: ReturnType<typeof getTelegramClient>;
}): Promise<boolean> {
  const text = input.message.text?.trim() ?? "";
  const from = input.message.from;
  if (!from || from.is_bot) return false;

  const match = WARNS_COMMAND_PATTERN.exec(text);
  if (!match) return false;

  await input.client.deleteMessage(input.telegramChatId, input.message.message_id).catch(() => undefined);

  const reply = (replyText: string) =>
    input.client.sendMessage({ chatId: input.telegramChatId, text: replyText, receiverUserId: from.id }).catch(() => undefined);

  const allowed = await hasChatPermission({
    chatId: input.chatId,
    chatTelegramId: input.telegramChatId,
    telegramUserId: from.id,
    permission: "history.view"
  });
  if (!allowed) {
    await reply("❌ У вас нет прав администратора в этом чате.");
    return true;
  }

  const { targetTokens } = parseModerationCommandArguments(match[1] ?? "", { allowDuration: false });
  let targets: ResolvedModerationTarget[] = [];
  let unresolvedUsernames: string[] = [];
  if (targetTokens.length > 0) {
    const resolution = await resolveTelegramTargets({ chatId: input.chatId, tokens: targetTokens });
    targets = resolution.resolved;
    unresolvedUsernames = resolution.unresolvedUsernames;
  } else if (input.message.reply_to_message?.from) {
    const replyFrom = input.message.reply_to_message.from;
    targets = [{
      telegramUserId: replyFrom.id,
      displayName: telegramDisplayName(replyFrom),
      token: { type: "id", value: replyFrom.id }
    }];
  }

  if (targets.length === 0) {
    await reply(unresolvedUsernames.length > 0
      ? `Не удалось найти в этом чате: ${unresolvedUsernames.map((name) => `@${name}`).join(", ")}.`
      : "Укажите цель: ответьте (Reply) на сообщение участника, либо укажите @username или Telegram ID после команды.");
    return true;
  }

  const lines: string[] = [];
  for (const target of targets) {
    const standing = await listWarningsForMember({ chatId: input.chatId, telegramUserId: target.telegramUserId });
    if (!standing) {
      lines.push(`${target.displayName}: участник не найден в этом чате.`);
      continue;
    }
    const limitText = standing.warnsLimit !== null ? `/${standing.warnsLimit}` : "";
    lines.push(`${target.displayName}: ${standing.activeWarningCount}${limitText} активных предупреждений (всего выдано ${standing.totalWarningCount}).`);
    for (const item of standing.recent.slice(0, 5)) {
      const date = item.createdAt.toLocaleDateString("ru-RU");
      lines.push(`  · ${date} — ${item.reason ?? "без причины"}`);
    }
  }
  if (unresolvedUsernames.length > 0) {
    lines.push(`Не найдены в чате: ${unresolvedUsernames.map((name) => `@${name}`).join(", ")}`);
  }
  await reply(lines.join("\n"));
  return true;
}

const INFO_COMMAND_PATTERN = /^\/info(?:@\w+)?(?:\s+([\s\S]*))?$/i;

const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  CREATOR: "владелец",
  ADMINISTRATOR: "администратор",
  MEMBER: "участник",
  RESTRICTED: "ограничен",
  PENDING: "заявка на вступление",
  LEFT: "покинул чат",
  BANNED: "заблокирован",
  UNKNOWN: "неизвестно"
};

const MODERATION_ACTION_LABELS: Record<string, string> = {
  WARNING: "Предупреждение",
  UNMUTE: "Снятие mute",
  MUTE: "Mute",
  BAN: "Блокировка",
  UNBAN: "Разблокировка",
  KICK: "Исключение"
};

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
}

/**
 * /info — a private profile card, so it replies ephemerally like /warns.
 * Read-only in this first version: no action buttons yet, since those would
 * need the generic Telegram UI/callback router this project doesn't have
 * yet (deferred out of Phase 0 as premature — see project notes). Use the
 * existing quick commands (e.g. "/mute @user 3h причина" as a reply to this
 * card, or to the member's own message) to act on what's shown here.
 */
async function processInfoCommand(input: {
  chatId: string;
  telegramChatId: number;
  message: TelegramMessage;
  client: ReturnType<typeof getTelegramClient>;
}): Promise<boolean> {
  const text = input.message.text?.trim() ?? "";
  const from = input.message.from;
  if (!from || from.is_bot) return false;

  const match = INFO_COMMAND_PATTERN.exec(text);
  if (!match) return false;

  await input.client.deleteMessage(input.telegramChatId, input.message.message_id).catch(() => undefined);

  const reply = (replyText: string) =>
    input.client.sendMessage({ chatId: input.telegramChatId, text: replyText, receiverUserId: from.id }).catch(() => undefined);

  const allowed = await hasChatPermission({
    chatId: input.chatId,
    chatTelegramId: input.telegramChatId,
    telegramUserId: from.id,
    permission: "users.view"
  });
  if (!allowed) {
    await reply("❌ У вас нет прав администратора в этом чате.");
    return true;
  }

  const { targetTokens } = parseModerationCommandArguments(match[1] ?? "", { allowDuration: false });
  let target: ResolvedModerationTarget | null = null;
  let unresolvedUsername: string | null = null;
  if (targetTokens.length > 0) {
    const resolution = await resolveTelegramTargets({ chatId: input.chatId, tokens: [targetTokens[0]] });
    target = resolution.resolved[0] ?? null;
    unresolvedUsername = resolution.unresolvedUsernames[0] ?? null;
  } else if (input.message.reply_to_message?.from) {
    const replyFrom = input.message.reply_to_message.from;
    target = { telegramUserId: replyFrom.id, displayName: telegramDisplayName(replyFrom), token: { type: "id", value: replyFrom.id } };
  }

  if (!target) {
    await reply(unresolvedUsername
      ? `Не удалось найти в этом чате: @${unresolvedUsername}.`
      : "Укажите участника: ответьте (Reply) на его сообщение, либо укажите @username или Telegram ID после команды.");
    return true;
  }

  const basics = await getInfoCardBasics(input.chatId, target.telegramUserId);
  if (!basics) {
    await reply(`${target.displayName}: участник не найден в этом чате.`);
    return true;
  }

  const context = await getModerationContext(basics.id);
  const lines: string[] = [];
  const usernamePart = basics.user.username ? ` (@${basics.user.username})` : "";
  lines.push(`👤 ${basics.user.displayName}${usernamePart}${basics.user.isPremium ? " ⭐" : ""}`);
  lines.push(`ID: ${basics.user.telegramUserId}`);
  if (context) {
    lines.push(`Статус: ${MEMBERSHIP_STATUS_LABELS[context.status] ?? context.status}`);
    if (basics.chatRole) lines.push(`Роль: ${basics.chatRole.label}`);
    if (context.punishmentState === "MUTED") {
      lines.push(`Наказание: mute${context.punishmentExpiresAt ? ` до ${formatDateTime(context.punishmentExpiresAt)}` : " (бессрочно)"}`);
    } else if (context.punishmentState === "BANNED") {
      lines.push(`Наказание: блокировка${context.punishmentExpiresAt ? ` до ${formatDateTime(context.punishmentExpiresAt)}` : " (постоянная)"}`);
    }
    lines.push(`Предупреждений: ${context.activeWarningCount} активных из ${context.warningCount} всего`);
  }
  if (basics.joinedAt) lines.push(`В чате с: ${formatDateTime(basics.joinedAt)}`);
  lines.push(`Сообщений в чате: ${basics.messageCount}`);
  lines.push(`Последняя активность: ${formatDateTime(basics.lastSeenAt)}`);

  const recentActions = context?.actions.slice(0, 5) ?? [];
  if (recentActions.length > 0) {
    lines.push("", "Последние действия:");
    for (const action of recentActions) {
      const label = MODERATION_ACTION_LABELS[action.type] ?? action.type;
      // actingAdmin is only populated for actions taken from the web panel;
      // a Telegram admin's in-chat /warn etc. (source TELEGRAM) stores their
      // name in metadata instead (getModerationContext doesn't expose it),
      // and a fully automated automod/expiry action (source SYSTEM) has
      // neither — distinguish by source rather than guessing at metadata.
      const actor = action.actingAdmin?.displayName
        ?? (action.source === "SYSTEM" ? "Автомодерация" : action.source === "TELEGRAM" ? "Администратор чата" : "Modera");
      lines.push(`· ${formatDateTime(action.createdAt)} — ${label} (${actor})${action.reason ? `: ${action.reason}` : ""}`);
    }
  }

  await reply(lines.join("\n"));
  return true;
}

const APPEAL_COMMAND_PATTERN = /^\/appeal(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const START_COMMAND_PATTERN = /^\/start(?:@\w+)?\s*$/i;
const HELP_COMMAND_PATTERN = /^\/help(?:@\w+)?\s*$/i;
const STATUS_COMMAND_PATTERN = /^\/status(?:@\w+)?\s*$/i;
const UNMUTE_COMMAND_PATTERN = /^\/unmute(?:@\w+)?(?:\s+(\d+))?\s*$/i;
const LINK_COMMAND_PATTERN = /^\/link(?:@\w+)?\s+(\d{6})\s*$/i;

const HELP_TEXT = [
  "Доступные команды:",
  "/status — ваш текущий статус и история наказаний",
  "/unmute — самостоятельно снять mute (до 3 раз в каждом чате)",
  "/appeal — подать апелляцию на бан или предупреждение (ответом на моё сообщение о наказании)",
  "/help — этот список команд"
].join("\n");

const START_TEXT = [
  "Привет! Я бот-модератор для Telegram-групп.",
  "",
  "Чтобы начать модерировать свой чат — нажмите кнопку ниже и выберите группу. Мне понадобятся права администратора (удаление сообщений, ограничение участников), чтобы всё заработало.",
  "",
  "Если вас ограничили в чате, где я уже работаю — здесь можно самостоятельно снять mute (до 3 раз в каждом чате) или подать апелляцию на бан/предупреждение.",
  "",
  HELP_TEXT
].join("\n");

// `admin=` makes Telegram show these rights on the confirmation screen after
// the group is picked, instead of adding the bot as a powerless member. But
// whether they show pre-checked (so the user can just tap through) or
// unchecked (needs manual toggling) is controlled separately, by the bot's
// *default* administrator rights (setMyDefaultAdministratorRights) -- the
// admin= param alone only decides which rights are shown, not their initial
// state. GROUP_ADMIN_RIGHTS/buildAdminRightsDeepLinkParam keep both in sync
// from one definition; see ensureGroupAdminRightsDefault below for the
// setMyDefaultAdministratorRights half.
const REQUIRED_ADMIN_RIGHTS = buildAdminRightsDeepLinkParam(GROUP_ADMIN_RIGHTS);

function addToGroupButton(botUsername?: string): TelegramInlineKeyboardMarkup | undefined {
  if (!botUsername) return undefined;
  return {
    inline_keyboard: [[{
      text: "➕ Добавить бота в группу",
      url: `https://t.me/${botUsername}?startgroup=setup&admin=${REQUIRED_ADMIN_RIGHTS}`
    }]]
  };
}

async function processPrivateMessage(message: TelegramMessage, botTelegramId: number, botUsername?: string) {
  const client = getTelegramClient();
  if (!message.from || message.from.id === botTelegramId || message.from.is_bot) {
    return { accepted: true, ignored: true };
  }

  // The user just opened a conversation with the bot (possibly for the first time) —
  // flush any punishment notifications that couldn't be sent earlier because Telegram
  // blocks bots from messaging users first.
  await deliverPendingAppealNotifications(message.from.id).catch(() => undefined);

  const text = message.text?.trim() ?? "";

  if (START_COMMAND_PATTERN.test(text)) {
    await client.sendMessage({ chatId: message.from.id, text: START_TEXT, replyMarkup: addToGroupButton(botUsername) }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  if (HELP_COMMAND_PATTERN.test(text)) {
    await client.sendMessage({ chatId: message.from.id, text: HELP_TEXT, replyMarkup: addToGroupButton(botUsername) }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  if (STATUS_COMMAND_PATTERN.test(text)) {
    const statusText = await getSelfServiceStatusMessage(message.from.id);
    await client.sendMessage({ chatId: message.from.id, text: statusText }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  const linkMatch = LINK_COMMAND_PATTERN.exec(text);
  if (linkMatch) {
    const result = await consumeLinkCode(linkMatch[1], {
      id: message.from.id,
      username: message.from.username,
      firstName: message.from.first_name
    });
    const linkReplyText = {
      linked: "✅ Telegram привязан к вашему аккаунту администратора. Теперь апелляции можно решать прямо здесь.",
      invalid_code: "❌ Код неверный или истёк. Запросите новый код в панели (Система → Аккаунты).",
      already_linked_elsewhere: "❌ Этот Telegram-аккаунт уже привязан к другому администратору."
    }[result.outcome];
    await client.sendMessage({ chatId: message.from.id, text: linkReplyText }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  const unmuteMatch = UNMUTE_COMMAND_PATTERN.exec(text);
  if (unmuteMatch) {
    const active = await listActiveMutes(message.from.id);
    if (active.length === 0) {
      await client.sendMessage({
        chatId: message.from.id,
        text: "Вы не находитесь под ограничением ни в одном чате."
      }).catch(() => undefined);
      return { accepted: true, ignored: false };
    }

    let target = active[0];
    if (active.length > 1) {
      const index = unmuteMatch[1] ? Number(unmuteMatch[1]) : NaN;
      if (!Number.isInteger(index) || index < 1 || index > active.length) {
        const list = active.map((item, position) => `${position + 1}. ${item.chat.title}`).join("\n");
        await client.sendMessage({
          chatId: message.from.id,
          text: `У вас mute сразу в нескольких чатах. Укажите номер чата:\n${list}\n\nНапример: /unmute 1`
        }).catch(() => undefined);
        return { accepted: true, ignored: false };
      }
      target = active[index - 1];
    }

    const result = await selfUnmute({ telegramUserId: message.from.id, chatId: target.chatId });
    await client.sendMessage({ chatId: message.from.id, text: result.message }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  const match = APPEAL_COMMAND_PATTERN.exec(text);
  if (!match) {
    return { accepted: true, ignored: true };
  }

  if (!message.reply_to_message) {
    await client.sendMessage({
      chatId: message.from.id,
      text: "Чтобы подать апелляцию, ответьте (Reply) на сообщение бота о наказании командой /appeal и текстом причины."
    }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  const result = await submitAppealFromReply({
    fromTelegramUserId: message.from.id,
    replyToMessageId: message.reply_to_message.message_id,
    text: (match[1] ?? "").trim()
  });

  const replyText = {
    submitted: "Апелляция отправлена администраторам. Дождитесь решения.",
    already_submitted: "По этому наказанию апелляция уже была подана.",
    empty_message: "Опишите причину апелляции текстом после команды /appeal.",
    action_not_found: "Не удалось определить, к какому наказанию относится апелляция. Отвечайте именно на сообщение бота о наказании."
  }[result.outcome];

  await client.sendMessage({ chatId: message.from.id, text: replyText }).catch(() => undefined);
  return { accepted: true, ignored: false };
}

async function processPrivateCallbackQuery(callbackQuery: NonNullable<TelegramUpdate["callback_query"]>) {
  const client = getTelegramClient();
  const parsed = callbackQuery.data ? parseAppealCallbackData(callbackQuery.data) : null;
  if (!parsed || !callbackQuery.message) {
    return { accepted: true, ignored: true };
  }

  const admin = await prisma.adminUser.findFirst({
    where: { telegramUserId: BigInt(callbackQuery.from.id), isActive: true }
  });
  if (!admin || !canModerate(admin.role)) {
    await client.answerCallbackQuery({
      callbackQueryId: callbackQuery.id,
      text: "У вас нет прав решать апелляции.",
      showAlert: true
    }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  try {
    const before = await prisma.appeal.findUnique({ where: { id: parsed.appealId }, select: { status: true } });
    const wasPending = before?.status === "PENDING";

    const result = await resolveAppeal({
      appealId: parsed.appealId,
      actingAdminId: admin.id,
      decision: parsed.decision
    });

    await client.answerCallbackQuery({
      callbackQueryId: callbackQuery.id,
      text: wasPending
        ? (result.status === "APPROVED" ? "✅ Апелляция одобрена." : "❌ Апелляция отклонена.")
        : "Уже решено."
    }).catch(() => undefined);

    await client.editMessageText({
      chatId: callbackQuery.from.id,
      messageId: callbackQuery.message.message_id,
      text: `${callbackQuery.message.text ?? ""}\n\n— ${result.status === "APPROVED" ? "Одобрено" : "Отклонено"} (${admin.displayName})`
    }).catch(() => undefined);
  } catch (error) {
    const message = error instanceof AppealError ? error.message : "Не удалось обработать апелляцию.";
    await client.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: message, showAlert: true }).catch(() => undefined);
  }

  return { accepted: true, ignored: false };
}

export async function processTelegramUpdate(update: TelegramUpdate) {
  const chat = extractChat(update);

  if (chat?.type === "private" && update.message) {
    const botProfile = await getTelegramBotProfile();
    return processPrivateMessage(update.message, botProfile.id, botProfile.username);
  }

  if (chat?.type === "private" && update.callback_query) {
    return processPrivateCallbackQuery(update.callback_query);
  }

  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
    return { accepted: true, ignored: true };
  }

  const client = getTelegramClient();
  const groupMessageText = update.message?.text?.trim() ?? "";
  const isGroupStartNoise = Boolean(update.message) && GROUP_START_NOISE_PATTERN.test(groupMessageText);
  // Fired immediately, in parallel with the bot-state sync below, instead of
  // waiting behind it -- this message appears right as the bot joins, so any
  // extra delay before it's deleted is very visible to whoever added it.
  const deleteNoiseMessage = isGroupStartNoise && update.message
    ? client.deleteMessage(chat.id, update.message.message_id).catch(() => undefined)
    : undefined;
  const botProfile = await getTelegramBotProfile();
  const bot = await upsertTelegramBot(botProfile);
  const existingChat = await prisma.chat.findUnique({
    where: { telegramChatId: BigInt(chat.id) },
    select: {
      id: true,
      botLinks: {
        where: { botId: bot.id },
        take: 1,
        select: { lastSeenAt: true }
      }
    }
  });

  const explicitMember = explicitBotMember(update, botProfile.id);
  const lastBotCheck = existingChat?.botLinks[0]?.lastSeenAt?.getTime() ?? 0;
  const shouldRefreshBotState =
    Boolean(explicitMember) ||
    !existingChat ||
    existingChat.botLinks.length === 0 ||
    Date.now() - lastBotCheck >= BOT_CHAT_REFRESH_MS;
  let member: TelegramChatMember | null = explicitMember;
  let memberCount: number | null | undefined;
  let administrators: TelegramChatMember[] = [];

  if (!member && shouldRefreshBotState) {
    try {
      member = await client.getChatMember(chat.id, botProfile.id);
    } catch (error) {
      if (!existingChat) throw error;
      await markBotChatTelegramError({
        botDbId: bot.id,
        chatId: existingChat.id,
        message: error instanceof TelegramApiError
          ? error.message
          : "Не удалось проверить состояние бота в Telegram"
      });
    }
  }

  if (member && member.status !== "left" && member.status !== "kicked" && shouldRefreshBotState) {
    const [count, admins] = await Promise.all([
      client.getChatMemberCount(chat.id).catch(() => null),
      client.getChatAdministrators(chat.id).catch(() => [])
    ]);
    memberCount = count;
    administrators = admins;
  }

  const syncedChat = await syncTelegramChat({
    chat,
    botDbId: bot.id,
    member,
    memberCount,
    activityAt: updateDate(update)
  });

  if (administrators.length > 0) {
    const timestamp = Math.floor(updateDate(update).getTime() / 1000);
    await syncKnownAdministrators({
      chatId: syncedChat.id,
      administrators,
      date: timestamp,
      updateId: update.update_id,
      currentBotTelegramId: botProfile.id
    });
  }

  if (update.message) {
    if (isGroupStartNoise) {
      await deleteNoiseMessage;
    } else {
      await syncObservedMessage({
        chatId: syncedChat.id,
        message: update.message,
        isEdited: false,
        updateId: update.update_id
      });
      await syncServiceMemberships({
        chatId: syncedChat.id,
        message: update.message,
        updateId: update.update_id,
        skipTelegramUserId: botProfile.id
      });
      const commandHandled = groupMessageText.startsWith("/")
        ? (await processGroupModerationCommand({
            chatId: syncedChat.id,
            telegramChatId: chat.id,
            message: update.message,
            client
          })) || (await processWarnsCommand({
            chatId: syncedChat.id,
            telegramChatId: chat.id,
            message: update.message,
            client
          })) || (await processInfoCommand({
            chatId: syncedChat.id,
            telegramChatId: chat.id,
            message: update.message,
            client
          }))
        : false;
      if (!commandHandled) {
        await runAutomod({ chatId: syncedChat.id, message: update.message, isEdited: false });
      }
    }
  }

  if (update.edited_message) {
    await syncObservedMessage({
      chatId: syncedChat.id,
      message: update.edited_message,
      isEdited: true,
      updateId: update.update_id
    });
    await runAutomod({ chatId: syncedChat.id, message: update.edited_message, isEdited: true });
  }

  if (update.chat_member && update.chat_member.new_chat_member.user.id !== botProfile.id) {
    const syncedMember = await syncChatMemberUpdate({
      chatId: syncedChat.id,
      update: update.chat_member,
      updateId: update.update_id
    });
    await reconcileTelegramMemberState({
      chatId: syncedChat.id,
      member: update.chat_member.new_chat_member,
      eventAt: new Date(update.chat_member.date * 1000)
    }).catch(() => undefined);

    if (
      isNewMemberJoin(update.chat_member) &&
      syncedMember.membership.internalRole !== TRUSTED_INTERNAL_ROLE
    ) {
      await maybeIssueCaptchaChallenge({
        chatId: syncedChat.id,
        chatType: chat.type,
        membershipId: syncedMember.membership.id,
        userId: syncedMember.user.id,
        telegramChatId: BigInt(chat.id),
        telegramUserId: BigInt(update.chat_member.new_chat_member.user.id)
      }).catch(() => undefined);
    }
  }

  if (update.chat_join_request && update.chat_join_request.from.id !== botProfile.id) {
    await syncJoinRequest({
      chatId: syncedChat.id,
      user: update.chat_join_request.from,
      date: update.chat_join_request.date,
      updateId: update.update_id
    });
    await recordTelegramJoinRequest({
      chatId: syncedChat.id,
      request: update.chat_join_request,
      updateId: update.update_id
    });
  }

  if (update.callback_query?.message && update.callback_query.from.id !== botProfile.id) {
    await observeMember({
      chatId: syncedChat.id,
      user: update.callback_query.from,
      date: update.callback_query.message.date,
      updateId: update.update_id
    });

    const targetTelegramUserId = update.callback_query.data
      ? parseCaptchaCallbackData(update.callback_query.data)
      : null;
    if (targetTelegramUserId !== null) {
      const result = await verifyCaptchaChallenge({
        chatId: syncedChat.id,
        telegramChatId: BigInt(chat.id),
        fromTelegramUserId: update.callback_query.from.id,
        targetTelegramUserId
      });

      if (result.outcome === "verified") {
        await client.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
          text: "✅ Проверка пройдена, добро пожаловать!",
          showAlert: true
        }).catch(() => undefined);
        // The captcha challenge is ephemeral (message_id is always 0 for
        // those) -- deleteMessage won't find it, deleteEphemeralMessage will.
        const ephemeralMessageId = update.callback_query.message.ephemeral_message_id;
        if (ephemeralMessageId !== undefined) {
          await client.deleteEphemeralMessage(Number(chat.id), ephemeralMessageId).catch((error) => {
            console.warn("[captcha] failed to delete ephemeral challenge after verification", {
              chatId: chat.id,
              ephemeralMessageId,
              error: error instanceof Error ? error.message.slice(0, 300) : "Unknown Telegram error"
            });
          });
        } else {
          console.warn("[captcha] verified callback had no ephemeral_message_id to delete", {
            chatId: chat.id,
            messageId: update.callback_query.message.message_id
          });
        }
      } else if (result.outcome === "wrong_user") {
        await client.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
          text: "Эта кнопка не для вас.",
          showAlert: true
        }).catch(() => undefined);
      } else {
        await client.answerCallbackQuery({
          callbackQueryId: update.callback_query.id,
          text: "Проверка уже недействительна."
        }).catch(() => undefined);
      }
    }
  }

  if (update.my_chat_member?.from && update.my_chat_member.from.id !== botProfile.id) {
    await observeMember({
      chatId: syncedChat.id,
      user: update.my_chat_member.from,
      date: update.my_chat_member.date,
      updateId: update.update_id
    });
  }

  return { accepted: true, ignored: false };
}
