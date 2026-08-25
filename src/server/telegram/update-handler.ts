import { prisma } from "@/server/db/prisma";
import { consumeLinkCode } from "@/server/services/admin-link-service";
import { canAdminModerateChat } from "@/server/services/chat-admin-access-service";
import { getAppealMessages, parseAppealCallbackData } from "@/server/services/appeal-notification-service";
import { AppealError, resolveAppeal, submitLatestAppeal } from "@/server/services/appeal-service";
import { processAutomodMessage } from "@/server/services/automod-service";
import { evaluateRaidOnJoin } from "@/server/services/anti-raid-service";
import { findMatchingAutoResponse } from "@/server/services/auto-response-service";
import { findCustomCommand } from "@/server/services/custom-command-service";
import { sendWelcomeMessage } from "@/server/services/welcome-service";
import { maybeIssueCaptchaChallenge, parseCaptchaCallbackData, verifyCaptchaChallenge } from "@/server/services/captcha-service";
import { hasChatPermission, type ChatPermission } from "@/server/services/chat-role-service";
import { markBotChatTelegramError, syncTelegramChat, upsertTelegramBot } from "@/server/services/chat-service";
import { recordTelegramJoinRequest } from "@/server/services/join-request-service";
import { applyNewMemberProtection } from "@/server/services/new-member-protection-service";
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
  applyAutomodRulePunishment,
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
import { resolveEffectiveManualModerationSettings } from "@/server/services/manual-moderation-settings-service";
import { getModerationNotificationProfile, renderTelegramModerationNotification, renderTelegramTemplate, type ModerationNotificationProfile } from "@/server/services/moderation-notification-settings-service";
import { createReport, notifyAdminsOfNewReport, parseReportCallbackData, ReportError, resolveReport, type ReportCallbackAction } from "@/server/services/report-service";
import { parseSettingsCallbackData, renderSettingsMenu } from "@/server/services/settings-menu-service";
import { completePendingLogChannelLink } from "@/server/services/log-channel-service";
import { getSelfServiceStatusMessage, listActiveMutes, selfUnmute } from "@/server/services/self-unmute-service";
import { isTrustedTelegramMember, TRUSTED_INTERNAL_ROLE } from "@/server/services/trusted-member-service";
import { parseDurationToken, parseModerationCommandArguments } from "@/server/telegram/command-parser";
import { SILENCE_DEFAULT_MINUTES, SilenceError, startSilence, stopSilence } from "@/server/services/silence-service";
import { buildAdminRightsDeepLinkParam, getTelegramBotProfile, getTelegramClient, GROUP_ADMIN_RIGHTS, TelegramApiError } from "@/server/telegram/client";
import { parseTelegramHtml } from "@/server/telegram/formatted-text";
import type { TelegramChat, TelegramChatMember, TelegramChatMemberUpdated, TelegramInlineKeyboardMarkup, TelegramMessage, TelegramMessageEntity, TelegramUpdate } from "@/server/telegram/types";

const BOT_CHAT_REFRESH_MS = 5 * 60 * 1000;
const RULE_BY_AUTOMOD_RESULT: Record<string, string> = {
  DELETED_LINK: "LINK",
  DELETED_TERM: "TERM",
  DELETED_MEDIA: "MEDIA",
  DELETED_MENTIONS: "MENTIONS",
  DELETED_DUPLICATE: "DUPLICATE",
  DELETED_SPAM: "SPAM",
  TRIGGERED_LINK: "LINK",
  TRIGGERED_TERM: "TERM",
  TRIGGERED_MEDIA: "MEDIA",
  TRIGGERED_MENTIONS: "MENTIONS",
  TRIGGERED_DUPLICATE: "DUPLICATE",
  TRIGGERED_SPAM: "SPAM"
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

  // Filters use the same independent outcome model as Automod rules.
  if (result.mediaFilterRule) {
    if (result.mediaFilterRule.notifyEnabled && result.mediaFilterRule.notifyText) {
      const notification = renderTelegramTemplate(result.mediaFilterRule.notifyText, {
        target: { text: telegramDisplayName(input.message.from), telegramUserId: input.message.from.id },
        chat: input.message.chat.title ?? ""
      });
      await getTelegramClient().sendMessage({ chatId: input.message.chat.id, ...notification }).catch(() => undefined);
    }
    if (!result.mediaFilterRule.punishmentEnabled) return;

    const escalation = await applyAutomodRulePunishment({
      chatId: input.chatId,
      telegramUserId: input.message.from.id,
      rule: `MEDIA:${result.mediaFilterRule.type}`,
      telegramMessageId: String(input.message.message_id),
      action: result.mediaFilterRule.punishmentAction,
      muteDurationMinutes: result.mediaFilterRule.muteDurationMinutes
    }).catch(() => undefined);
    if (!escalation?.escalated || !escalation.action || result.mediaFilterRule.punishmentAction === "MUTE") return;

    const { settings } = await resolveEffectiveModerationSettings(input.chatId);
    if (!settings.announceEscalationEnabled) return;
    const profile = await getModerationNotificationProfile(escalation.action);
    if (!profile.channels.PUBLIC.enabled) return;
    const notification = renderTelegramModerationNotification(profile.channels.PUBLIC, "AUTOMATED", {
      admin: "",
      target: { text: telegramDisplayName(input.message.from), telegramUserId: input.message.from.id },
      chat: input.message.chat.title ?? "",
      reason: "",
      duration: escalation.action === "MUTE" && escalation.muteDurationMinutes ? formatMinutes(escalation.muteDurationMinutes) : "",
      warns: String(escalation.activeWarningCount ?? escalation.warningCount ?? ""),
      warnsLimit: escalation.threshold !== undefined ? String(escalation.threshold) : ""
    });
    await getTelegramClient().sendMessage({ chatId: input.message.chat.id, ...notification }).catch(() => undefined);
    return;
  }

  const ruleAction = "ruleAction" in result ? result.ruleAction : null;
  if (ruleAction?.notifyEnabled && ruleAction.notifyText) {
    const notification = renderTelegramTemplate(ruleAction.notifyText, {
      target: { text: telegramDisplayName(input.message.from), telegramUserId: input.message.from.id },
      chat: input.message.chat.title ?? ""
    });
    await getTelegramClient().sendMessage({ chatId: input.message.chat.id, ...notification }).catch(() => undefined);
  }

  if (ruleAction && !ruleAction.punishmentEnabled) return;

  const violation = {
    chatId: input.chatId,
    telegramUserId: input.message.from.id,
    rule,
    telegramMessageId: String(input.message.message_id)
  };
  const escalation = ruleAction
    ? await applyAutomodRulePunishment({
        ...violation,
        action: ruleAction.punishmentAction,
        muteDurationMinutes: ruleAction.muteDurationMinutes
      }).catch(() => undefined)
    : await recordAutomodViolationAndEscalate(violation).catch(() => undefined);
  if (!escalation?.escalated || !escalation.action) return;

  // A direct rule-level Mute is fully described by that rule's own optional
  // message. The legacy escalation announcement belongs only to a Warn that
  // crossed the shared escalation chain.
  if (ruleAction?.punishmentAction === "MUTE") return;

  const { settings } = await resolveEffectiveModerationSettings(input.chatId);
  if (!settings.announceEscalationEnabled) return;

  const profile = await getModerationNotificationProfile(escalation.action);
  if (!profile.channels.PUBLIC.enabled) return;
  const notification = renderTelegramModerationNotification(profile.channels.PUBLIC, "AUTOMATED", {
    admin: "",
    target: { text: telegramDisplayName(input.message.from), telegramUserId: input.message.from.id },
    reason: "",
    duration: escalation.action === "MUTE" && escalation.muteDurationMinutes ? formatMinutes(escalation.muteDurationMinutes) : "",
    warns: String(escalation.activeWarningCount ?? escalation.warningCount ?? ""),
    warnsLimit: escalation.threshold !== undefined ? String(escalation.threshold) : ""
  });
  await getTelegramClient().sendMessage({ chatId: input.message.chat.id, ...notification }).catch(() => undefined);
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

const CHAT_PERMISSION_BY_ACTION: Record<GroupModerationCommand, ChatPermission> = {
  WARNING: "moderation.warn",
  UNWARN: "moderation.warn",
  MUTE: "moderation.mute",
  UNMUTE: "moderation.mute",
  BAN: "moderation.ban",
  UNBAN: "moderation.ban",
  KICK: "moderation.kick"
};

const COMMAND_KEY_BY_ACTION = {
  WARNING: "warn", UNWARN: "unwarn", MUTE: "mute", UNMUTE: "unmute", BAN: "ban", UNBAN: "unban", KICK: "kick"
} as const;

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

/** `adminOnly` keeps internal diagnostics (e.g. a failed auto-punishment) out of the public chat announcement — only the admin who ran the command needs to see them. */
type ModerationOutcomeLine = { text: string; textEntities?: TelegramMessageEntity[]; publicText?: string; publicEntities?: TelegramMessageEntity[]; targetText?: string; targetEntities?: TelegramMessageEntity[]; adminOnly?: boolean };

function joinTelegramLines(lines: Array<{ text: string; entities?: TelegramMessageEntity[] }>) {
  const entities: TelegramMessageEntity[] = [];
  let text = "";
  for (const line of lines) {
    if (text) text += "\n";
    const offset = text.length;
    text += line.text;
    entities.push(...(line.entities ?? []).map((entity) => ({ ...entity, offset: entity.offset + offset })));
  }
  return { text, entities };
}

/** Runs the moderation action against a single already-resolved target; used in a loop for multi-target commands. */
async function applyModerationCommandToTarget(input: {
  chatId: string;
  action: GroupModerationCommand;
  target: ResolvedModerationTarget;
  reason: string | null;
  /** Minutes; applies to MUTE or BAN depending on `action` — null means permanent/no duration. */
  durationMinutes: number | null;
  telegramActor: { telegramUserId: number; username?: string; displayName?: string };
  notificationProfile: ModerationNotificationProfile;
  amount: number;
}): Promise<ModerationOutcomeLine[]> {
  let warns = "";
  let warnsLimit = "";
  let escalation: ManualWarningEscalation | null = null;

  if (input.action === "UNWARN") {
    const member = await prisma.chatMember.findFirst({ where: { chatId: input.chatId, user: { telegramUserId: BigInt(input.target.telegramUserId) } }, select: { userId: true } });
    if (!member) throw new ModerationError("MEMBER_NOT_FOUND", "Участник не найден.", 404);
    const available = await prisma.moderationAction.count({ where: { chatId: input.chatId, affectedUserId: member.userId, type: "WARNING", status: "SUCCEEDED", revokedAt: null } });
    if (input.amount > available) throw new ModerationError("INVALID_WARNING_AMOUNT", `Нельзя снять ${input.amount} предупреждения: у пользователя только ${available}`, 409);
    let revoked: Awaited<ReturnType<typeof executeTelegramActorWarningRevoke>> | null = null;
    for (let index = 0; index < input.amount; index += 1) {
      revoked = await executeTelegramActorWarningRevoke({ chatId: input.chatId, targetTelegramUserId: input.target.telegramUserId, telegramActor: input.telegramActor, suppressTargetNotification: true });
    }
    if (!revoked) throw new ModerationError("NO_WARNINGS", "У участника нет предупреждений.", 409);
    const remaining = await describeWarningStanding({
      chatId: revoked.chatId,
      affectedUserId: revoked.affectedUserId
    });
    warns = String(remaining.activeWarningCount);
    warnsLimit = remaining.warnsLimit !== null ? String(remaining.warnsLimit) : "";
  } else {
    const actionResult = await executeTelegramActorModerationAction({
      chatId: input.chatId,
      targetTelegramUserId: input.target.telegramUserId,
      action: input.action,
      reason: input.reason,
      muteDurationMinutes: input.action === "MUTE" ? input.durationMinutes : null,
      banDurationMinutes: input.action === "BAN" ? input.durationMinutes : null,
      telegramActor: input.telegramActor,
      suppressTargetNotification: true
    });

    if (input.action === "WARNING") {
      escalation = await escalateAfterManualWarning({
        chatId: input.chatId,
        targetTelegramUserId: input.target.telegramUserId,
        reason: input.reason ?? "Предупреждение от администратора чата",
        warningActionId: actionResult.id
      });
      warns = String(escalation.activeWarningCount);
      warnsLimit = escalation.warnsLimit !== null ? String(escalation.warnsLimit) : "";
    }
  }

  const placeholders = {
    admin: { text: input.telegramActor.displayName ?? input.telegramActor.username ?? "Администратор", telegramUserId: input.telegramActor.telegramUserId },
    target: { text: input.target.displayName, telegramUserId: input.target.telegramUserId },
    reason: input.reason ?? "",
    duration: (input.action === "MUTE" || input.action === "BAN") && input.durationMinutes ? formatMinutes(input.durationMinutes) : "",
    warns,
    warnsLimit,
    amount: String(input.amount)
  };
  // Rendered unconditionally — the admin running the command always gets a
  // private confirmation that the action went through, even when public
  // chat announcements are switched off (silent moderation is the default;
  // "silent" means the chat stays quiet, not that the admin is left guessing).
  const lines: ModerationOutcomeLine[] = [];
  const targetNotification = input.notificationProfile.channels.OFFENDER.enabled
    ? renderTelegramModerationNotification(input.notificationProfile.channels.OFFENDER, "MANUAL", placeholders)
    : null;
  if (input.notificationProfile.channels.MODERATOR.enabled) {
    const moderator = renderTelegramModerationNotification(input.notificationProfile.channels.MODERATOR, "MANUAL", placeholders);
    const publicNotification = input.notificationProfile.channels.PUBLIC.enabled
      ? renderTelegramModerationNotification(input.notificationProfile.channels.PUBLIC, "MANUAL", placeholders)
      : null;
    lines.push({
      text: moderator.text,
      textEntities: moderator.entities,
      ...(publicNotification ? { publicText: publicNotification.text, publicEntities: publicNotification.entities } : {}),
      ...(targetNotification ? { targetText: targetNotification.text, targetEntities: targetNotification.entities } : {})
    });
  } else if (input.notificationProfile.channels.PUBLIC.enabled) {
    const publicNotification = renderTelegramModerationNotification(input.notificationProfile.channels.PUBLIC, "MANUAL", placeholders);
    lines.push({ text: "", publicText: publicNotification.text, publicEntities: publicNotification.entities, ...(targetNotification ? { targetText: targetNotification.text, targetEntities: targetNotification.entities } : {}) });
  } else if (targetNotification) {
    lines.push({ text: "", targetText: targetNotification.text, targetEntities: targetNotification.entities });
  }

  // The warning that crossed the threshold also triggered a punishment — say so
  // in the same summary rather than leaving the admin to guess why the mute landed.
  if (escalation?.escalated && escalation.action) {
    const escalationProfile = await getModerationNotificationProfile(escalation.action);
    const escalationPlaceholders = {
          ...placeholders,
          admin: "",
          reason: `Достигнут порог ${escalation.threshold ?? escalation.warnsLimit} предупреждений.`,
          duration: escalation.muteDurationMinutes ? formatMinutes(escalation.muteDurationMinutes) : ""
        };
    if (escalationProfile.channels.MODERATOR.enabled || escalationProfile.channels.PUBLIC.enabled) {
      const moderator = escalationProfile.channels.MODERATOR.enabled ? renderTelegramModerationNotification(escalationProfile.channels.MODERATOR, "AUTOMATED", escalationPlaceholders) : null;
      const publicNotification = escalationProfile.channels.PUBLIC.enabled ? renderTelegramModerationNotification(escalationProfile.channels.PUBLIC, "AUTOMATED", escalationPlaceholders) : null;
      lines.push({
        text: moderator?.text ?? "",
        textEntities: moderator?.entities,
        ...(publicNotification ? { publicText: publicNotification.text, publicEntities: publicNotification.entities } : {})
      });
    }
  } else if (escalation?.attemptedAction && escalation.error) {
    // Threshold was crossed but the mute/ban itself failed (e.g. the bot
    // lacks "Ограничивать участников") — without this line the admin sees a
    // plain warning confirmation with no sign anything went wrong, and the
    // same failing attempt silently repeats on every subsequent warning.
    lines.push({
      text: `⚠️ Порог ${escalation.threshold ?? escalation.warnsLimit} предупреждений достигнут, но автонаказание (${escalation.attemptedAction === "MUTE" ? "mute" : "ban"}) не применилось: ${escalation.error}`,
      adminOnly: true
    });
  }

  return lines;
}

async function deleteTargetMessagesFromCurrentChat(input: { chatId: string; telegramChatId: number; targetTelegramUserId: number; repliedMessageId: number; client: ReturnType<typeof getTelegramClient> }) {
  const user = await prisma.telegramUser.findUnique({ where: { telegramUserId: BigInt(input.targetTelegramUserId) }, select: { id: true } });
  const stored = user ? await prisma.message.findMany({ where: { chatId: input.chatId, senderUserId: user.id, deletedAt: null }, select: { id: true, telegramMessageId: true } }) : [];
  const storedIds = new Map(stored.map((message) => [Number(message.telegramMessageId), message.id]));
  const messageIds = Array.from(new Set([input.repliedMessageId, ...stored.map((message) => Number(message.telegramMessageId))]));
  let deleted = 0;
  let failed = 0;
  for (let offset = 0; offset < messageIds.length; offset += 20) {
    const batch = messageIds.slice(offset, offset + 20);
    const results = await Promise.allSettled(batch.map((messageId) => input.client.deleteMessage(input.telegramChatId, messageId)));
    const databaseIds: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") { deleted += 1; const id = storedIds.get(batch[index]!); if (id) databaseIds.push(id); }
      else failed += 1;
    });
    if (databaseIds.length) await prisma.message.updateMany({ where: { id: { in: databaseIds } }, data: { deletedAt: new Date() } });
  }
  return { deleted, failed };
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

  const { settings } = await resolveEffectiveManualModerationSettings(input.chatId);
  const commandProfile = settings.commands.find((profile) => profile.command === COMMAND_KEY_BY_ACTION[action])!;
  let commandArguments = commandMatch[2]?.trim() ?? "";
  let amount = 1;
  let amountError: string | null = null;
  if (action === "UNWARN" && commandProfile.allowAmount && commandArguments) {
    const parts = commandArguments.split(/\s+/);
    const last = parts.at(-1) ?? "";
    const invalidStandaloneAmount = /^[+-]?(?:0|\d+[.,]\d+)$/.test(last);
    if ((Boolean(input.message.reply_to_message) || parts.length > 1 || invalidStandaloneAmount) && /^[+-]?\d+(?:[.,]\d+)?$/.test(last)) {
      const parsedAmount = Number(last.replace(",", "."));
      if (!Number.isInteger(parsedAmount) || parsedAmount < 1) amountError = "Количество должно быть целым числом от 1.";
      else amount = parsedAmount;
      parts.pop();
      commandArguments = parts.join(" ");
    }
  }

  const { targetTokens, durationMinutes, reason } = parseModerationCommandArguments(
    commandArguments,
    { allowDuration, requireDurationUnit }
  );

  // Validation hints, per-target errors, and the admin's own action summary
  // (below) are for whoever ran the command, not the rest of the chat — sent
  // ephemeral (Bot API 10.2, visible only to `from`) rather than as a normal
  // chat message. Only the separately-sent public announcement (also below,
  // gated by the global public-punishment-messages toggle) is meant for the whole chat.
  const privateReply = (replyText: string, entities?: TelegramMessageEntity[]) =>
    input.client.sendMessage({ chatId: input.telegramChatId, text: replyText, entities, receiverUserId: from.id }).catch(() => undefined);

  // The command text itself (e.g. "/warn спам") never belongs in the chat —
  // delete it immediately, before any validation, so it disappears whether
  // the command succeeds, fails permission/format checks, or errors out.
  if (commandProfile.deleteCommandMessage) await input.client.deleteMessage(input.telegramChatId, input.message.message_id).catch(() => undefined);

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
  if (amountError) { await privateReply(amountError); return true; }

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

  const notificationProfile = await getModerationNotificationProfile(action);
  for (const [recipient, channel] of [["TARGET", "OFFENDER"], ["PUBLIC", "PUBLIC"], ["MODERATOR", "MODERATOR"]] as const) {
    const configured = commandProfile.notifications[recipient];
    notificationProfile.channels[channel] = { enabled: configured.enabled, templates: { ...notificationProfile.channels[channel].templates, MANUAL: configured.template } };
  }
  // Only meaningful in reply mode — target-token commands (@username/ID) have
  // no "message this was a reply to" to delete.
  const massDelete = (action === "MUTE" || action === "BAN") && commandProfile.deleteTargetMessage && commandProfile.deleteAllTargetMessages && input.message.reply_to_message && targets.length === 1;
  if (commandProfile.deleteTargetMessage && input.message.reply_to_message && !massDelete) {
    await input.client.deleteMessage(input.telegramChatId, input.message.reply_to_message.message_id).catch(() => undefined);
  }

  // The notification center controls public and moderator-facing channels
  // independently for every action. Validation failures stay private even
  // when the moderator disabled ordinary success confirmations.
  const publicLines: Array<{ text: string; entities?: TelegramMessageEntity[] }> = [];
  const adminSummaryLines: Array<{ text: string; entities?: TelegramMessageEntity[] }> = [];
  let actionSucceeded = false;
  for (const target of targets) {
    try {
      const outcomes = await applyModerationCommandToTarget({
        chatId: input.chatId,
        action,
        target,
        reason,
        durationMinutes,
        telegramActor,
        notificationProfile,
        amount
      });
      actionSucceeded = true;
      for (const outcome of outcomes) {
        const prefix = targets.length > 1 ? `${target.displayName}: ` : "";
        const prefixEntity = prefix ? [{ type: "text_link", offset: 0, length: target.displayName.length, url: `tg://user?id=${target.telegramUserId}` }] : [];
        if (outcome.text) adminSummaryLines.push({ text: prefix + outcome.text, entities: [...prefixEntity, ...(outcome.textEntities ?? []).map((entity) => ({ ...entity, offset: entity.offset + prefix.length }))] });
        if (outcome.publicText && !outcome.adminOnly) publicLines.push({ text: prefix + outcome.publicText, entities: [...prefixEntity, ...(outcome.publicEntities ?? []).map((entity) => ({ ...entity, offset: entity.offset + prefix.length }))] });
        if (outcome.targetText && !outcome.adminOnly) await input.client.sendMessage({ chatId: input.telegramChatId, text: outcome.targetText, entities: outcome.targetEntities, receiverUserId: target.telegramUserId }).catch(() => undefined);
      }
    } catch (error) {
      const message = error instanceof ModerationError ? error.message : "Не удалось выполнить действие модерации.";
      adminSummaryLines.push({ text: `❌ ${target.displayName}: ${message}`, entities: [{ type: "text_link", offset: 2, length: target.displayName.length, url: `tg://user?id=${target.telegramUserId}` }] });
    }
  }
  if (unresolvedUsernames.length > 0) {
    adminSummaryLines.push({ text: `❌ Не найдены в чате: ${unresolvedUsernames.map((name) => `@${name}`).join(", ")}` });
  }

  if (publicLines.length > 0) {
    await input.client.sendMessage({ chatId: input.telegramChatId, ...joinTelegramLines(publicLines) }).catch(() => undefined);
  }
  if (massDelete && actionSucceeded && input.message.reply_to_message) {
    const result = await deleteTargetMessagesFromCurrentChat({ chatId: input.chatId, telegramChatId: input.telegramChatId, targetTelegramUserId: targets[0]!.telegramUserId, repliedMessageId: input.message.reply_to_message.message_id, client: input.client });
    adminSummaryLines.push({ text: result.failed ? `Удалено сообщений: ${result.deleted}. Не удалось удалить: ${result.failed}` : `Удалено сообщений: ${result.deleted}` });
  }
  if (adminSummaryLines.length > 0) {
    const summary = joinTelegramLines(adminSummaryLines);
    await privateReply(summary.text, summary.entities);
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

const CUSTOM_COMMAND_WORD_PATTERN = /^\/([a-zA-Z0-9_]{1,32})(?:@\w+)?(?:\s|$)/;

/**
 * Custom Commands (§41, Phase 10) -- checked last in the command chain so
 * every built-in command above always wins a name collision (on top of
 * custom-command-service.ts rejecting reserved trigger words outright at
 * create/update time). Doesn't delete the invoking message -- this is a
 * "show me info" command, not a moderation action, and members generally
 * expect their question to stay visible next to the answer.
 */
async function processCustomCommand(input: {
  chatId: string;
  telegramChatId: number;
  message: TelegramMessage;
  client: ReturnType<typeof getTelegramClient>;
}): Promise<boolean> {
  const text = input.message.text?.trim() ?? "";
  const from = input.message.from;
  if (!from || from.is_bot) return false;

  const match = CUSTOM_COMMAND_WORD_PATTERN.exec(text);
  if (!match) return false;

  const command = await findCustomCommand(input.chatId, match[1]);
  if (!command) return false;

  if (command.adminOnly) {
    const allowed = await hasChatPermission({
      chatId: input.chatId,
      chatTelegramId: input.telegramChatId,
      telegramUserId: from.id,
      permission: "automod.manage"
    });
    if (!allowed) return false;
  }

  await input.client.sendMessage({ chatId: input.telegramChatId, ...parseTelegramHtml(command.responseText) }).catch(() => undefined);
  return true;
}

const SILENCE_COMMAND_PATTERN = /^\/silence(?:@\w+)?(?:\s+([\s\S]*))?$/i;
const UNSILENCE_COMMAND_PATTERN = /^\/unsilence(?:@\w+)?\s*$/i;

/**
 * /silence [duration] — BOT_PRODUCT_SPEC §28. Chat-wide lockdown for regular
 * members via a real setChatPermissions call (moderators/admins keep
 * posting on their own native rights) -- unlike Slow Mode (confirmed
 * unbuildable, no Bot API setter exists), this one is genuinely
 * implementable. Announces publicly since the whole chat is affected and
 * needs to know why it suddenly can't post, unlike the private-by-default
 * admin commands above.
 */
async function processSilenceCommand(input: {
  chatId: string;
  telegramChatId: number;
  message: TelegramMessage;
  client: ReturnType<typeof getTelegramClient>;
}): Promise<boolean> {
  const text = input.message.text?.trim() ?? "";
  const from = input.message.from;
  if (!from || from.is_bot) return false;

  const match = SILENCE_COMMAND_PATTERN.exec(text);
  if (!match) return false;

  await input.client.deleteMessage(input.telegramChatId, input.message.message_id).catch(() => undefined);
  const reply = (replyText: string) =>
    input.client.sendMessage({ chatId: input.telegramChatId, text: replyText, receiverUserId: from.id }).catch(() => undefined);

  const allowed = await hasChatPermission({
    chatId: input.chatId,
    chatTelegramId: input.telegramChatId,
    telegramUserId: from.id,
    permission: "moderation.mute"
  });
  if (!allowed) {
    await reply("❌ У вас нет прав ограничивать участников в этом чате.");
    return true;
  }

  const durationArg = (match[1] ?? "").trim().split(/\s+/)[0];
  const durationMinutes = durationArg ? parseDurationToken(durationArg) : SILENCE_DEFAULT_MINUTES;
  if (durationArg && durationMinutes === null) {
    await reply("Укажите срок, например: /silence 30m");
    return true;
  }

  try {
    const { expiresAt } = await startSilence({
      chatId: input.chatId,
      telegramChatId: input.telegramChatId,
      durationMinutes: durationMinutes ?? SILENCE_DEFAULT_MINUTES,
      actorTelegramUserId: from.id,
      actorDisplayName: telegramDisplayName(from)
    });
    await input.client.sendMessage({
      chatId: input.telegramChatId,
      text: `🔇 Режим тишины включён до ${formatDateTime(expiresAt)}. Обычные участники не могут писать — модераторы и администраторы продолжают работу. Снять раньше: /unsilence`
    }).catch(() => undefined);
  } catch (error) {
    await reply(error instanceof SilenceError ? error.message : "Не удалось включить режим тишины.");
  }
  return true;
}

async function processUnsilenceCommand(input: {
  chatId: string;
  telegramChatId: number;
  message: TelegramMessage;
  client: ReturnType<typeof getTelegramClient>;
}): Promise<boolean> {
  const text = input.message.text?.trim() ?? "";
  const from = input.message.from;
  if (!from || from.is_bot) return false;
  if (!UNSILENCE_COMMAND_PATTERN.test(text)) return false;

  await input.client.deleteMessage(input.telegramChatId, input.message.message_id).catch(() => undefined);
  const reply = (replyText: string) =>
    input.client.sendMessage({ chatId: input.telegramChatId, text: replyText, receiverUserId: from.id }).catch(() => undefined);

  const allowed = await hasChatPermission({
    chatId: input.chatId,
    chatTelegramId: input.telegramChatId,
    telegramUserId: from.id,
    permission: "moderation.mute"
  });
  if (!allowed) {
    await reply("❌ У вас нет прав ограничивать участников в этом чате.");
    return true;
  }

  try {
    await stopSilence({
      chatId: input.chatId,
      telegramChatId: input.telegramChatId,
      actorTelegramUserId: from.id,
      actorDisplayName: telegramDisplayName(from)
    });
    await input.client.sendMessage({ chatId: input.telegramChatId, text: "🔊 Режим тишины снят — все участники снова могут писать." }).catch(() => undefined);
  } catch (error) {
    await reply(error instanceof SilenceError ? error.message : "Не удалось снять режим тишины.");
  }
  return true;
}

const REPORT_COMMAND_PATTERN = /^\/report(?:@\w+)?(?:\s+([\s\S]*))?$/i;

/**
 * /report — BOT_PRODUCT_SPEC §32. Unlike the admin commands above, any regular
 * member can run this (no permission gate) — it only queues a private card
 * for moderators, it doesn't act on its own. Reply-only, matching the spec's
 * documented syntax; there's no @username/ID form since a report is
 * inherently about a specific message.
 */
async function processReportCommand(input: {
  chatId: string;
  chatTitle: string;
  chatUsername: string | null;
  telegramChatId: number;
  message: TelegramMessage;
  client: ReturnType<typeof getTelegramClient>;
}): Promise<boolean> {
  const text = input.message.text?.trim() ?? "";
  const from = input.message.from;
  if (!from || from.is_bot) return false;

  const match = REPORT_COMMAND_PATTERN.exec(text);
  if (!match) return false;

  await input.client.deleteMessage(input.telegramChatId, input.message.message_id).catch(() => undefined);

  const reply = (replyText: string) =>
    input.client.sendMessage({ chatId: input.telegramChatId, text: replyText, receiverUserId: from.id }).catch(() => undefined);

  const target = input.message.reply_to_message?.from;
  if (!target || !input.message.reply_to_message) {
    await reply("Чтобы пожаловаться, ответьте (Reply) на сообщение участника командой /report и, по желанию, причиной.");
    return true;
  }
  if (target.is_bot) {
    await reply("Нельзя пожаловаться на бота.");
    return true;
  }

  const result = await createReport({
    chatId: input.chatId,
    reporterTelegramUserId: from.id,
    reportedTelegramUserId: target.id,
    messageTelegramId: input.message.reply_to_message.message_id,
    reason: (match[1] ?? "").trim() || null
  });

  if (result.outcome === "disabled") {
    await reply("Жалобы отключены в этом чате.");
    return true;
  }
  if (result.outcome === "self_report") {
    await reply("Нельзя пожаловаться на самого себя.");
    return true;
  }
  if (result.outcome === "reporter_not_found" || result.outcome === "reported_user_not_found") {
    await reply("Не удалось отправить жалобу — участник ещё не распознан ботом. Попробуйте ещё раз чуть позже.");
    return true;
  }

  await notifyAdminsOfNewReport({
    reportId: result.reportId,
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    chatTelegramId: BigInt(input.telegramChatId),
    chatUsername: input.chatUsername,
    reporterDisplayName: result.reporterDisplayName,
    reportedDisplayName: result.reportedDisplayName,
    reason: (match[1] ?? "").trim() || null,
    messageTelegramId: input.message.reply_to_message.message_id
  }).catch(() => undefined);

  await reply("✅ Жалоба отправлена администраторам чата.");
  return true;
}

const SETTINGS_COMMAND_PATTERN = /^\/settings(?:@\w+)?\s*$/i;

/**
 * /settings — BOT_PRODUCT_SPEC §45 (Phase 8, v1: only the Automod section is
 * wired so far; more sections land as follow-ups on top of
 * settings-menu-service.ts's callback-driven navigation). Requires a linked
 * AdminUser (same /link flow appeals/reports already rely on) rather than
 * just live Telegram admin status -- settings changes need a real
 * actingAdminId for the audit trail, the same requirement
 * chat-moderation-settings-service.ts already has for the Web Admin path.
 */
async function processSettingsCommand(input: {
  chatId: string;
  chatTitle: string;
  telegramChatId: number;
  message: TelegramMessage;
  client: ReturnType<typeof getTelegramClient>;
}): Promise<boolean> {
  const text = input.message.text?.trim() ?? "";
  const from = input.message.from;
  if (!from || from.is_bot) return false;
  if (!SETTINGS_COMMAND_PATTERN.test(text)) return false;

  await input.client.deleteMessage(input.telegramChatId, input.message.message_id).catch(() => undefined);

  const reply = (replyText: string) =>
    input.client.sendMessage({ chatId: input.telegramChatId, text: replyText, receiverUserId: from.id }).catch(() => undefined);

  const allowed = await hasChatPermission({
    chatId: input.chatId,
    chatTelegramId: input.telegramChatId,
    telegramUserId: from.id,
    permission: "automod.manage"
  });
  if (!allowed) {
    await reply("❌ У вас нет прав изменять настройки этого чата.");
    return true;
  }

  const admin = await prisma.adminUser.findFirst({ where: { telegramUserId: BigInt(from.id), isActive: true } });
  if (!admin) {
    await reply("Чтобы открыть настройки, привяжите Telegram к аккаунту администратора: напишите мне в личные сообщения /link <код> (код выдаётся в панели, Система → Аккаунты), затем повторите /settings.");
    return true;
  }

  const view = await renderSettingsMenu({
    chatId: input.chatId,
    chatTitle: input.chatTitle,
    telegramChatId: input.telegramChatId,
    actingAdminId: admin.id,
    path: "root"
  });
  if (!view) {
    await reply("Не удалось открыть настройки этого чата.");
    return true;
  }

  try {
    await input.client.sendMessage({ chatId: from.id, text: view.text, replyMarkup: view.keyboard ?? undefined });
    await reply("📬 Отправил настройки вам в личные сообщения.");
  } catch {
    await reply("Не удалось отправить настройки в личные сообщения — откройте диалог со мной (нажмите на моё имя → Start), затем повторите /settings.");
  }

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
  "/appeal — подать апелляцию на бан или предупреждение",
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

  // A forwarded post is how /settings' "Подключить канал" flow confirms a
  // log channel -- only meaningful if this admin has an active pending link,
  // so an unrelated forward from a non-admin (or one with nothing pending)
  // falls through to the normal flow untouched.
  if (message.forward_origin) {
    const forwardingAdmin = await prisma.adminUser.findFirst({
      where: { telegramUserId: BigInt(message.from.id), isActive: true }
    });
    if (forwardingAdmin) {
      const linkResult = await completePendingLogChannelLink({
        actingAdminId: forwardingAdmin.id,
        forwardOrigin: message.forward_origin
      });
      if (linkResult.outcome !== "no_pending_link") {
        const replyText = {
          linked: linkResult.outcome === "linked"
            ? `✅ Канал «${linkResult.channelTitle}» подключён для пересылки логов чата «${linkResult.chatTitle}».`
            : "",
          not_a_channel_forward: "Нужно переслать сообщение именно из канала (не из группы, и не скопированный текст). Попробуйте ещё раз.",
          bot_not_in_channel: "Сначала добавьте меня в этот канал администратором с правом публикации сообщений, затем перешлите пост ещё раз."
        }[linkResult.outcome];
        await client.sendMessage({ chatId: message.from.id, text: replyText }).catch(() => undefined);
        return { accepted: true, ignored: false };
      }
    }
  }

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

  // No Reply required anymore (the DM it used to match against is gone,
  // see appeal-service.ts::listAppealCandidates) -- find the user's latest
  // appeal-eligible punishment automatically. When it's ambiguous across
  // more than one chat, same numbered-picker pattern as /unmute just above:
  // "/appeal <номер> <причина>" once the bot has listed the candidates.
  const raw = (match[1] ?? "").trim();
  const indexMatch = /^(\d+)(?:\s+([\s\S]*))?$/.exec(raw);

  const firstResult = await submitLatestAppeal({
    fromTelegramUserId: message.from.id,
    text: raw
  });

  let result = firstResult;
  if (firstResult.outcome === "multiple_chats") {
    const index = indexMatch ? Number(indexMatch[1]) : NaN;
    if (!indexMatch || !Number.isInteger(index) || index < 1 || index > firstResult.candidates.length) {
      const list = firstResult.candidates.map((candidate, position) => `${position + 1}. ${candidate.chatTitle}`).join("\n");
      await client.sendMessage({
        chatId: message.from.id,
        text: `У вас есть наказания, доступные для апелляции, сразу в нескольких чатах. Укажите номер чата:\n${list}\n\nНапример: /appeal 1 причина`
      }).catch(() => undefined);
      return { accepted: true, ignored: false };
    }
    result = await submitLatestAppeal({
      fromTelegramUserId: message.from.id,
      text: indexMatch[2] ?? "",
      chatId: firstResult.candidates[index - 1].chatId
    });
  }

  const messages = await getAppealMessages();
  const replyText = {
    submitted: messages.appealSubmittedMessageTemplate,
    already_submitted: "По этому наказанию апелляция уже была подана.",
    empty_message: "Опишите причину апелляции текстом после команды /appeal.",
    action_not_found: "Нет наказаний, доступных для апелляции.",
    multiple_chats: "Не удалось определить чат для апелляции."
  }[result.outcome];

  await client.sendMessage({ chatId: message.from.id, text: replyText }).catch(() => undefined);
  return { accepted: true, ignored: false };
}

async function processAppealCallback(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
  parsed: NonNullable<ReturnType<typeof parseAppealCallbackData>>
) {
  const client = getTelegramClient();
  const [admin, appealRecord] = await Promise.all([
    prisma.adminUser.findFirst({
      where: { telegramUserId: BigInt(callbackQuery.from.id), isActive: true }
    }),
    prisma.appeal.findUnique({
      where: { id: parsed.appealId },
      select: { chatId: true, status: true }
    })
  ]);
  const allowed = Boolean(
    admin && appealRecord && await canAdminModerateChat(admin, appealRecord.chatId)
  );
  if (!admin || !appealRecord || !allowed) {
    await client.answerCallbackQuery({
      callbackQueryId: callbackQuery.id,
      text: "У вас нет прав решать апелляции.",
      showAlert: true
    }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  try {
    const wasPending = appealRecord.status === "PENDING";

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
      messageId: callbackQuery.message!.message_id,
      text: `${callbackQuery.message!.text ?? ""}\n\n— ${result.status === "APPROVED" ? "Одобрено" : "Отклонено"} (${admin.displayName})`
    }).catch(() => undefined);
  } catch (error) {
    const message = error instanceof AppealError ? error.message : "Не удалось обработать апелляцию.";
    await client.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: message, showAlert: true }).catch(() => undefined);
  }

  return { accepted: true, ignored: false };
}

const REPORT_ACTION_LABELS: Record<ReportCallbackAction, string> = {
  DELETE: "🗑 Сообщение удалено",
  WARN: "⚠️ Выдано предупреждение",
  MUTE: "🔇 Участник ограничен",
  BAN: "⛔ Участник заблокирован",
  DISMISS: "❌ Жалоба отклонена"
};

async function processReportCallback(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
  parsed: NonNullable<ReturnType<typeof parseReportCallbackData>>
) {
  const client = getTelegramClient();
  const [admin, reportRecord] = await Promise.all([
    prisma.adminUser.findFirst({
      where: { telegramUserId: BigInt(callbackQuery.from.id), isActive: true }
    }),
    prisma.report.findUnique({
      where: { id: parsed.reportId },
      select: { chatId: true }
    })
  ]);
  const allowed = Boolean(
    admin && reportRecord && await canAdminModerateChat(admin, reportRecord.chatId)
  );
  if (!admin || !reportRecord || !allowed) {
    await client.answerCallbackQuery({
      callbackQueryId: callbackQuery.id,
      text: "У вас нет прав решать жалобы.",
      showAlert: true
    }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  try {
    const result = await resolveReport({ reportId: parsed.reportId, actingAdminId: admin.id, action: parsed.action });
    const label = REPORT_ACTION_LABELS[result.actionTaken ?? "DISMISS"];
    await client.answerCallbackQuery({
      callbackQueryId: callbackQuery.id,
      text: `${label} (${admin.displayName})`
    }).catch(() => undefined);
    await client.editMessageText({
      chatId: callbackQuery.from.id,
      messageId: callbackQuery.message!.message_id,
      text: `${callbackQuery.message!.text ?? ""}\n\n— ${label} (${admin.displayName})`
    }).catch(() => undefined);
  } catch (error) {
    const message = error instanceof ReportError ? error.message : "Не удалось обработать жалобу.";
    await client.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: message, showAlert: true }).catch(() => undefined);
  }

  return { accepted: true, ignored: false };
}

async function processSettingsCallback(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
  parsed: NonNullable<ReturnType<typeof parseSettingsCallbackData>>
) {
  const client = getTelegramClient();
  const admin = await prisma.adminUser.findFirst({
    where: { telegramUserId: BigInt(callbackQuery.from.id), isActive: true }
  });
  if (!admin) {
    await client.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Сессия недействительна.", showAlert: true }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  const chat = await prisma.chat.findUnique({
    where: { telegramChatId: BigInt(parsed.telegramChatId) },
    select: { id: true, title: true }
  });
  if (!chat) {
    await client.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Чат не найден.", showAlert: true }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  // Re-checked on every tap, not just at /settings time -- admin rights can
  // change between opening the menu and pressing a button minutes later.
  const allowed = await hasChatPermission({
    chatId: chat.id,
    chatTelegramId: parsed.telegramChatId,
    telegramUserId: callbackQuery.from.id,
    permission: "automod.manage"
  });
  if (!allowed) {
    await client.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "У вас нет прав изменять настройки этого чата.", showAlert: true }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  const view = await renderSettingsMenu({
    chatId: chat.id,
    chatTitle: chat.title,
    telegramChatId: parsed.telegramChatId,
    actingAdminId: admin.id,
    path: parsed.path
  });
  if (!view) {
    await client.answerCallbackQuery({ callbackQueryId: callbackQuery.id, text: "Не удалось загрузить настройки.", showAlert: true }).catch(() => undefined);
    return { accepted: true, ignored: false };
  }

  await client.answerCallbackQuery({ callbackQueryId: callbackQuery.id }).catch(() => undefined);
  await client.editMessageText({
    chatId: callbackQuery.from.id,
    messageId: callbackQuery.message!.message_id,
    text: view.text,
    replyMarkup: view.keyboard ?? undefined
  }).catch(() => undefined);

  return { accepted: true, ignored: false };
}

async function processPrivateCallbackQuery(callbackQuery: NonNullable<TelegramUpdate["callback_query"]>) {
  if (!callbackQuery.message || !callbackQuery.data) return { accepted: true, ignored: true };

  const appeal = parseAppealCallbackData(callbackQuery.data);
  if (appeal) return processAppealCallback(callbackQuery, appeal);

  const report = parseReportCallbackData(callbackQuery.data);
  if (report) return processReportCallback(callbackQuery, report);

  const settings = parseSettingsCallbackData(callbackQuery.data);
  if (settings) return processSettingsCallback(callbackQuery, settings);

  return { accepted: true, ignored: true };
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
          })) || (await processSilenceCommand({
            chatId: syncedChat.id,
            telegramChatId: chat.id,
            message: update.message,
            client
          })) || (await processUnsilenceCommand({
            chatId: syncedChat.id,
            telegramChatId: chat.id,
            message: update.message,
            client
          })) || (await processReportCommand({
            chatId: syncedChat.id,
            chatTitle: syncedChat.title,
            chatUsername: syncedChat.username,
            telegramChatId: chat.id,
            message: update.message,
            client
          })) || (await processSettingsCommand({
            chatId: syncedChat.id,
            chatTitle: syncedChat.title,
            telegramChatId: chat.id,
            message: update.message,
            client
          })) || (await processCustomCommand({
            chatId: syncedChat.id,
            telegramChatId: chat.id,
            message: update.message,
            client
          }))
        : false;
      if (!commandHandled) {
        await runAutomod({ chatId: syncedChat.id, message: update.message, isEdited: false });

        const matchedRule = await findMatchingAutoResponse(syncedChat.id, groupMessageText).catch(() => null);
        if (matchedRule) {
          await client.sendMessage({ chatId: chat.id, ...parseTelegramHtml(matchedRule.responseText) }).catch(() => undefined);
        }
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

    const joinedAt = new Date(update.chat_member.date * 1000);
    const protection = isNewMemberJoin(update.chat_member)
      ? await applyNewMemberProtection({
          chatId: syncedChat.id,
          membershipId: syncedMember.membership.id,
          userId: syncedMember.user.id,
          telegramChatId: BigInt(chat.id),
          user: update.chat_member.new_chat_member.user,
          joinedAt,
          viaChatFolderInviteLink: update.chat_member.via_chat_folder_invite_link
        }).catch(() => ({ outcome: "allowed" as const }))
      : { outcome: "allowed" as const };

    if (isNewMemberJoin(update.chat_member) && protection.outcome !== "blocked") {
      await sendWelcomeMessage({
        chatId: syncedChat.id,
        telegramChatId: chat.id,
        chatTitle: syncedChat.title,
        memberCount: syncedChat.knownMemberCount,
        newMemberFirstName: update.chat_member.new_chat_member.user.first_name,
        newMemberUsername: update.chat_member.new_chat_member.user.username ?? null
      }).catch(() => undefined);
    }

    if (
      isNewMemberJoin(update.chat_member) &&
      protection.outcome !== "blocked" &&
      syncedMember.membership.internalRole !== TRUSTED_INTERNAL_ROLE
    ) {
      await evaluateRaidOnJoin({ chatId: syncedChat.id, at: joinedAt }).catch(() => undefined);
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
        // The id is read back from what issueCaptchaChallenge persisted at
        // send time, not from this callback update -- Telegram does not
        // reliably echo ephemeral_message_id back on callback_query.message.
        const ephemeralMessageId = result.ephemeralMessageId;
        if (result.deleteAfterVerification && ephemeralMessageId !== null) {
          await client.deleteEphemeralMessage(Number(chat.id), ephemeralMessageId).catch((error) => {
            console.warn("[captcha] failed to delete ephemeral challenge after verification", {
              chatId: chat.id,
              ephemeralMessageId,
              error: error instanceof Error ? error.message.slice(0, 300) : "Unknown Telegram error"
            });
          });
        } else if (result.deleteAfterVerification) {
          console.warn("[captcha] verified member had no stored ephemeral_message_id to delete", {
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
