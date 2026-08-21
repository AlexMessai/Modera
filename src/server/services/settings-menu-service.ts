import { getChatModerationProfile, updateChatModerationSettings } from "@/server/services/chat-moderation-settings-service";
import { LINK_PROTECTION_MODES, type LinkProtectionMode, type ModerationSettingsValue } from "@/server/services/global-moderation-service";
import { getChatCaptchaProfile, updateChatCaptchaProfile, type CaptchaSettingsValue } from "@/server/services/captcha-settings-service";
import { getChatAntiRaidProfile, updateChatAntiRaidSettings, type AntiRaidSettingsValue } from "@/server/services/anti-raid-settings-service";
import { getChatManualModerationProfile, updateChatManualModerationProfile, type ManualModerationSettingsValue } from "@/server/services/manual-moderation-settings-service";
import type { TelegramInlineKeyboardMarkup } from "@/server/telegram/types";

// Telegram callback_data is capped at 64 bytes, so the path is a compact
// dot-separated token string, and the chat is identified by its numeric
// Telegram id (short) rather than the internal UUID (36 chars) -- callers
// resolve the numeric id back to a DB chat row themselves (one extra lookup,
// same as report-service.ts's callback data carrying only a report id).
const CALLBACK_PREFIX = "s|";
const PATH_PATTERN = /^[A-Za-z0-9_.+-]{1,48}$/;

export function buildSettingsCallbackData(telegramChatId: number, path: string) {
  return `${CALLBACK_PREFIX}${telegramChatId}|${path}`;
}

export function parseSettingsCallbackData(data: string): { telegramChatId: number; path: string } | null {
  if (!data.startsWith(CALLBACK_PREFIX)) return null;
  const rest = data.slice(CALLBACK_PREFIX.length);
  const separatorIndex = rest.indexOf("|");
  if (separatorIndex === -1) return null;
  const chatIdPart = rest.slice(0, separatorIndex);
  const path = rest.slice(separatorIndex + 1);
  const telegramChatId = Number(chatIdPart);
  if (!Number.isInteger(telegramChatId) || !PATH_PATTERN.test(path)) return null;
  return { telegramChatId, path };
}

type NumericField = "spamMaxMessages" | "spamWindowSeconds" | "maxMentions" | "duplicateWindowSeconds" | "duplicateMaxMessages";
const NUMERIC_FIELD_BOUNDS: Record<NumericField, { min: number; max: number }> = {
  spamMaxMessages: { min: 2, max: 50 },
  spamWindowSeconds: { min: 5, max: 300 },
  maxMentions: { min: 1, max: 50 },
  duplicateWindowSeconds: { min: 10, max: 600 },
  duplicateMaxMessages: { min: 2, max: 20 }
};

function clampField(field: NumericField, value: number) {
  const bounds = NUMERIC_FIELD_BOUNDS[field];
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

function backRow(path: string, telegramChatId: number) {
  return [{ text: "🔙 Назад", callback_data: buildSettingsCallbackData(telegramChatId, path) }];
}

function toggleRow(label: string, path: string, telegramChatId: number) {
  return [{ text: label, callback_data: buildSettingsCallbackData(telegramChatId, path) }];
}

function stepperRow(label: string, value: number, field: string, basePath: string, telegramChatId: number, step: number) {
  return [
    { text: "➖", callback_data: buildSettingsCallbackData(telegramChatId, `${basePath}.${field}.-${step}`) },
    { text: `${label}: ${value}`, callback_data: buildSettingsCallbackData(telegramChatId, basePath) },
    { text: "➕", callback_data: buildSettingsCallbackData(telegramChatId, `${basePath}.${field}.+${step}`) }
  ];
}

function renderRoot(chatTitle: string, telegramChatId: number) {
  return {
    text: `⚙️ Настройки чата «${chatTitle}»\n\nИзменения здесь применяются только к этому чату (не влияют на глобальную политику и другие чаты).`,
    keyboard: {
      inline_keyboard: [
        [{ text: "⚖️ Модерация", callback_data: buildSettingsCallbackData(telegramChatId, "moderation") }],
        [{ text: "🛡 Автомодерация", callback_data: buildSettingsCallbackData(telegramChatId, "automod") }],
        [{ text: "🔐 Защита", callback_data: buildSettingsCallbackData(telegramChatId, "protection") }],
        [{ text: "✖️ Закрыть", callback_data: buildSettingsCallbackData(telegramChatId, "close") }]
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

function renderAutomodMenu(settings: ModerationSettingsValue, telegramChatId: number) {
  const linkLabel = { ALLOW_ALL: "выключена", BLOCK_ALL: "все ссылки", WHITELIST_ONLY: "белый список", BLACKLIST_ONLY: "чёрный список" }[settings.linkProtectionMode];
  return {
    text: "🛡 Автомодерация\n\nВыберите правило, чтобы посмотреть или изменить его.",
    keyboard: {
      inline_keyboard: [
        [{ text: `🔗 Ссылки: ${linkLabel}`, callback_data: buildSettingsCallbackData(telegramChatId, "automod.links") }],
        [{ text: `💬 Спам/флуд: ${settings.spamEnabled ? "вкл" : "выкл"}`, callback_data: buildSettingsCallbackData(telegramChatId, "automod.flood") }],
        [{ text: `🚫 Запрещённые слова: ${settings.blockedTermsEnabled ? "вкл" : "выкл"}`, callback_data: buildSettingsCallbackData(telegramChatId, "automod.terms") }],
        [{ text: `📢 Массовые упоминания: ${settings.massMentionsEnabled ? "вкл" : "выкл"}`, callback_data: buildSettingsCallbackData(telegramChatId, "automod.mentions") }],
        [{ text: `🔁 Повторы: ${settings.duplicateEnabled ? "вкл" : "выкл"}`, callback_data: buildSettingsCallbackData(telegramChatId, "automod.duplicates") }],
        [{ text: `📎 Медиа: ${settings.blockedMessageTypes.length} тип(ов) ограничено`, callback_data: buildSettingsCallbackData(telegramChatId, "automod.media") }],
        backRow("root", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

const LINK_MODE_LABELS: Record<LinkProtectionMode, string> = {
  ALLOW_ALL: "Выключена",
  BLOCK_ALL: "Блокировать все ссылки",
  WHITELIST_ONLY: "Разрешать только из белого списка",
  BLACKLIST_ONLY: "Блокировать только из чёрного списка"
};

function renderLinksDetail(settings: ModerationSettingsValue, telegramChatId: number) {
  const rows = LINK_PROTECTION_MODES.map((mode) => [{
    text: `${settings.linkProtectionMode === mode ? "✅ " : ""}${LINK_MODE_LABELS[mode]}`,
    callback_data: buildSettingsCallbackData(telegramChatId, `automod.links.set.${mode}`)
  }]);
  const domainCount = settings.linkProtectionMode === "WHITELIST_ONLY" ? settings.allowedDomains.length : settings.blockedDomains.length;
  const domainNote = settings.linkProtectionMode === "WHITELIST_ONLY" || settings.linkProtectionMode === "BLACKLIST_ONLY"
    ? `\n\nСписок доменов (${domainCount}) редактируется в Web Admin.`
    : "";
  return {
    text: `🔗 Защита от ссылок${domainNote}`,
    keyboard: { inline_keyboard: [...rows, backRow("automod", telegramChatId)] } satisfies TelegramInlineKeyboardMarkup
  };
}

function renderFloodDetail(settings: ModerationSettingsValue, telegramChatId: number) {
  const rows = [toggleRow(`Статус: ${settings.spamEnabled ? "✅ включён" : "⬜ выключен"}`, "automod.flood.toggle", telegramChatId)];
  if (settings.spamEnabled) {
    rows.push(stepperRow("Сообщений", settings.spamMaxMessages, "limit", "automod.flood", telegramChatId, 1));
    rows.push(stepperRow("Период, сек", settings.spamWindowSeconds, "window", "automod.flood", telegramChatId, 5));
  }
  rows.push(backRow("automod", telegramChatId));
  return {
    text: `💬 Защита от флуда\n\nЕсли участник отправляет больше «Сообщений» за «Период» секунд — срабатывает предупреждение с обычной эскалацией (как и за другие нарушения).`,
    keyboard: { inline_keyboard: rows } satisfies TelegramInlineKeyboardMarkup
  };
}

function renderTermsDetail(settings: ModerationSettingsValue, telegramChatId: number) {
  return {
    text: `🚫 Запрещённые слова и фразы\n\nСписок (${settings.blockedTerms.length} слов) редактируется в Web Admin — здесь можно только включить или выключить правило.`,
    keyboard: {
      inline_keyboard: [
        toggleRow(`Статус: ${settings.blockedTermsEnabled ? "✅ включено" : "⬜ выключено"}`, "automod.terms.toggle", telegramChatId),
        backRow("automod", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

function renderMentionsDetail(settings: ModerationSettingsValue, telegramChatId: number) {
  const rows = [toggleRow(`Статус: ${settings.massMentionsEnabled ? "✅ включено" : "⬜ выключено"}`, "automod.mentions.toggle", telegramChatId)];
  if (settings.massMentionsEnabled) {
    rows.push(stepperRow("Упоминаний", settings.maxMentions, "max", "automod.mentions", telegramChatId, 1));
  }
  rows.push(backRow("automod", telegramChatId));
  return {
    text: `📢 Защита от массовых упоминаний\n\nЕсли в одном сообщении участник упоминает (@username) больше чем «Упоминаний» людей — срабатывает предупреждение с обычной эскалацией (как и за другие нарушения).`,
    keyboard: { inline_keyboard: rows } satisfies TelegramInlineKeyboardMarkup
  };
}

function renderDuplicatesDetail(settings: ModerationSettingsValue, telegramChatId: number) {
  const rows = [toggleRow(`Статус: ${settings.duplicateEnabled ? "✅ включено" : "⬜ выключено"}`, "automod.duplicates.toggle", telegramChatId)];
  if (settings.duplicateEnabled) {
    rows.push(stepperRow("Повторов", settings.duplicateMaxMessages, "count", "automod.duplicates", telegramChatId, 1));
    rows.push(stepperRow("Период, сек", settings.duplicateWindowSeconds, "window", "automod.duplicates", telegramChatId, 10));
  }
  rows.push(backRow("automod", telegramChatId));
  return {
    text: `🔁 Защита от повторяющихся сообщений\n\nЕсли участник отправляет одно и то же сообщение подряд «Повторов» раз в течение «Период» секунд — срабатывает предупреждение с обычной эскалацией (как и за другие нарушения).`,
    keyboard: { inline_keyboard: rows } satisfies TelegramInlineKeyboardMarkup
  };
}

function renderMediaDetail(settings: ModerationSettingsValue, telegramChatId: number) {
  return {
    text: `📎 Ограничение типов сообщений\n\nОграничено типов: ${settings.blockedMessageTypes.length}. Список редактируется в Web Admin (Модерация → правило чата).`,
    keyboard: { inline_keyboard: [backRow("automod", telegramChatId)] } satisfies TelegramInlineKeyboardMarkup
  };
}

const AUTOMOD_VIEWS: Record<string, (settings: ModerationSettingsValue, telegramChatId: number) => { text: string; keyboard: TelegramInlineKeyboardMarkup }> = {
  automod: renderAutomodMenu,
  "automod.links": renderLinksDetail,
  "automod.flood": renderFloodDetail,
  "automod.terms": renderTermsDetail,
  "automod.mentions": renderMentionsDetail,
  "automod.duplicates": renderDuplicatesDetail,
  "automod.media": renderMediaDetail
};

function renderProtectionMenu(captcha: CaptchaSettingsValue, antiRaid: AntiRaidSettingsValue, telegramChatId: number) {
  return {
    text: "🔐 Защита\n\nВыберите правило, чтобы посмотреть или изменить его.",
    keyboard: {
      inline_keyboard: [
        [{ text: `🤖 CAPTCHA: ${captcha.enabled ? "вкл" : "выкл"}`, callback_data: buildSettingsCallbackData(telegramChatId, "protection.captcha") }],
        [{ text: `🚨 Anti-Raid: ${antiRaid.enabled ? "вкл" : "выкл"}`, callback_data: buildSettingsCallbackData(telegramChatId, "protection.antiraid") }],
        backRow("root", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

function renderCaptchaDetail(settings: CaptchaSettingsValue, telegramChatId: number) {
  return {
    text: `🤖 CAPTCHA при вступлении\n\nНовый участник должен подтвердить, что не бот, прежде чем сможет писать в чат. Кто не подтвердит — будет исключён (не заблокирован) при ближайшей ежедневной проверке. Текст сообщения с кнопкой подтверждения редактируется в Web Admin.`,
    keyboard: {
      inline_keyboard: [
        toggleRow(`Статус: ${settings.enabled ? "✅ включена" : "⬜ выключена"}`, "protection.captcha.toggle", telegramChatId),
        backRow("protection", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

function renderAntiRaidDetail(settings: AntiRaidSettingsValue, telegramChatId: number) {
  const rows = [toggleRow(`Статус: ${settings.enabled ? "✅ включена" : "⬜ выключена"}`, "protection.antiraid.toggle", telegramChatId)];
  if (settings.enabled) {
    rows.push(stepperRow("Порог", settings.joinThreshold, "threshold", "protection.antiraid", telegramChatId, 5));
    rows.push(stepperRow("Окно, сек", settings.windowSeconds, "window", "protection.antiraid", telegramChatId, 5));
    rows.push(stepperRow("Затишье", settings.cooldownMinutes, "cooldown", "protection.antiraid", telegramChatId, 5));
    rows.push(toggleRow(`Капча во время рейда: ${settings.forceCaptcha ? "✅ вкл" : "⬜ выкл"}`, "protection.antiraid.forcecaptcha", telegramChatId));
  }
  rows.push(backRow("protection", telegramChatId));
  return {
    text: `🚨 Anti-Raid\n\nЕсли за «Окно» секунд в чат вступает «Порог» и больше новых участников — это считается рейдом: капча включается принудительно (если включена опция ниже), пока наплыв не стихнет. Снимается автоматически после «Затишье» минут без новых вступлений (проверяется раз в сутки — может занять до суток).`,
    keyboard: { inline_keyboard: rows } satisfies TelegramInlineKeyboardMarkup
  };
}

function renderModerationMenu(telegramChatId: number) {
  return {
    text: "⚖️ Модерация\n\nВыберите раздел, чтобы посмотреть или изменить его.",
    keyboard: {
      inline_keyboard: [
        [{ text: "⚠️ Предупреждения", callback_data: buildSettingsCallbackData(telegramChatId, "moderation.warnings") }],
        [{ text: "🔨 Наказания", callback_data: buildSettingsCallbackData(telegramChatId, "moderation.punishments") }],
        [{ text: "📣 Уведомления", callback_data: buildSettingsCallbackData(telegramChatId, "moderation.notifications") }],
        backRow("root", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

function renderWarningsDetail(settings: ModerationSettingsValue, telegramChatId: number) {
  const expiryLabel = settings.warningExpiryDays === 0 ? "бессрочно" : `${settings.warningExpiryDays}`;
  return {
    text: `⚠️ Предупреждения\n\nЧерез сколько дней снятое по времени предупреждение перестаёт учитываться при подсчёте для наказаний. «0» — предупреждения не истекают.`,
    keyboard: {
      inline_keyboard: [
        [
          { text: "➖", callback_data: buildSettingsCallbackData(telegramChatId, "moderation.warnings.expiry.-1") },
          { text: `Дней: ${expiryLabel}`, callback_data: buildSettingsCallbackData(telegramChatId, "moderation.warnings") },
          { text: "➕", callback_data: buildSettingsCallbackData(telegramChatId, "moderation.warnings.expiry.+1") }
        ],
        backRow("moderation", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

function formatRuleDuration(minutes: number | null) {
  if (minutes === null) return "бессрочно";
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} дн.`;
  if (minutes % 60 === 0) return `${minutes / 60} ч.`;
  return `${minutes} мин.`;
}

function renderPunishmentsDetail(settings: ModerationSettingsValue, telegramChatId: number) {
  const chain = [...settings.escalationRules]
    .sort((a, b) => a.order - b.order)
    .map((rule) => `${rule.thresholdWarnings} варн(ов) → ${rule.action === "MUTE" ? "mute" : "бан"} (${formatRuleDuration(rule.durationMinutes)})`)
    .join("\n");
  return {
    text: `🔨 Наказания\n\nЦепочка наказаний за накопленные предупреждения (полный список правил редактируется в Web Admin):\n${chain || "не настроена"}`,
    keyboard: {
      inline_keyboard: [
        toggleRow(`Автонаказания: ${settings.autoEscalationEnabled ? "✅ включены" : "⬜ выключены"}`, "moderation.punishments.auto.toggle", telegramChatId),
        toggleRow(`Объявлять в чате: ${settings.announceEscalationEnabled ? "✅ вкл" : "⬜ выкл"}`, "moderation.punishments.announce.toggle", telegramChatId),
        backRow("moderation", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

type AnnounceField = "warnAnnounceInChat" | "unwarnAnnounceInChat" | "muteAnnounceInChat" | "unmuteAnnounceInChat" | "banAnnounceInChat" | "unbanAnnounceInChat" | "kickAnnounceInChat";

const NOTIFICATION_COMMANDS: Array<{ key: string; label: string; field: AnnounceField }> = [
  { key: "warn", label: "/warn", field: "warnAnnounceInChat" },
  { key: "unwarn", label: "/unwarn", field: "unwarnAnnounceInChat" },
  { key: "mute", label: "/mute", field: "muteAnnounceInChat" },
  { key: "unmute", label: "/unmute", field: "unmuteAnnounceInChat" },
  { key: "ban", label: "/ban", field: "banAnnounceInChat" },
  { key: "unban", label: "/unban", field: "unbanAnnounceInChat" },
  { key: "kick", label: "/kick", field: "kickAnnounceInChat" }
];

function renderNotificationsDetail(settings: ManualModerationSettingsValue, telegramChatId: number) {
  const rows = NOTIFICATION_COMMANDS.map((command) =>
    toggleRow(`${command.label}: ${settings[command.field] ? "✅ объявляется в чате" : "⬜ только приватно"}`, `moderation.notifications.${command.key}.toggle`, telegramChatId)
  );
  rows.push(backRow("moderation", telegramChatId));
  return {
    text: `📣 Уведомления\n\nДля каждой команды: объявлять ли результат публично в чате, или только приватно тому, кто выполнил команду (сами тексты сообщений редактируются в Web Admin).`,
    keyboard: { inline_keyboard: rows } satisfies TelegramInlineKeyboardMarkup
  };
}

async function renderModerationSection(input: { chatId: string; chatTitle: string; telegramChatId: number; actingAdminId: string; path: string }) {
  const { path } = input;

  if (path === "moderation") {
    return renderModerationMenu(input.telegramChatId);
  }

  if (path === "moderation.warnings" || path.startsWith("moderation.warnings.expiry.")) {
    const profile = await getChatModerationProfile(input.chatId);
    if (!profile) return null;
    let settings = profile.effectiveSettings;

    const stepperMatch = /^moderation\.warnings\.expiry\.([+-]\d+)$/.exec(path);
    if (stepperMatch) {
      const nextValue = Math.min(3650, Math.max(0, settings.warningExpiryDays + Number(stepperMatch[1])));
      const merged: ModerationSettingsValue = { ...settings, warningExpiryDays: nextValue };
      const saved = await updateChatModerationSettings({ chatId: input.chatId, actingAdminId: input.actingAdminId, useGlobalProfile: false, ...merged });
      settings = saved ?? merged;
    }
    return renderWarningsDetail(settings, input.telegramChatId);
  }

  if (path === "moderation.punishments" || path === "moderation.punishments.auto.toggle" || path === "moderation.punishments.announce.toggle") {
    const profile = await getChatModerationProfile(input.chatId);
    if (!profile) return null;
    let settings = profile.effectiveSettings;

    let patch: Partial<ModerationSettingsValue> | null = null;
    if (path === "moderation.punishments.auto.toggle") patch = { autoEscalationEnabled: !settings.autoEscalationEnabled };
    if (path === "moderation.punishments.announce.toggle") patch = { announceEscalationEnabled: !settings.announceEscalationEnabled };

    if (patch) {
      const merged: ModerationSettingsValue = { ...settings, ...patch };
      const saved = await updateChatModerationSettings({ chatId: input.chatId, actingAdminId: input.actingAdminId, useGlobalProfile: false, ...merged });
      settings = saved ?? merged;
    }
    return renderPunishmentsDetail(settings, input.telegramChatId);
  }

  if (path === "moderation.notifications" || path.startsWith("moderation.notifications.")) {
    const profile = await getChatManualModerationProfile(input.chatId);
    if (!profile) return null;
    let settings = profile.effectiveSettings;

    const toggleMatch = /^moderation\.notifications\.(\w+)\.toggle$/.exec(path);
    if (toggleMatch) {
      const command = NOTIFICATION_COMMANDS.find((item) => item.key === toggleMatch[1]);
      if (command) {
        const merged: ManualModerationSettingsValue = { ...settings, [command.field]: !settings[command.field] };
        const saved = await updateChatManualModerationProfile({ chatId: input.chatId, actingAdminId: input.actingAdminId, useGlobalProfile: false, settings: merged });
        settings = saved ?? merged;
      }
    }
    return renderNotificationsDetail(settings, input.telegramChatId);
  }

  return null;
}

/** Applies a mutating automod path segment (toggle / stepper / mode-set), returning the view path to render afterward. Non-mutating paths pass through unchanged. */
async function applyAutomodAction(chatId: string, actingAdminId: string, settings: ModerationSettingsValue, path: string): Promise<{ viewPath: string; settings: ModerationSettingsValue }> {
  let patch: Partial<ModerationSettingsValue> | null = null;
  let viewPath = path;

  if (path === "automod.flood.toggle") {
    patch = { spamEnabled: !settings.spamEnabled };
    viewPath = "automod.flood";
  } else if (path === "automod.terms.toggle") {
    patch = { blockedTermsEnabled: !settings.blockedTermsEnabled };
    viewPath = "automod.terms";
  } else if (path === "automod.mentions.toggle") {
    patch = { massMentionsEnabled: !settings.massMentionsEnabled };
    viewPath = "automod.mentions";
  } else if (path === "automod.duplicates.toggle") {
    patch = { duplicateEnabled: !settings.duplicateEnabled };
    viewPath = "automod.duplicates";
  } else if (path.startsWith("automod.links.set.")) {
    const mode = path.slice("automod.links.set.".length);
    if ((LINK_PROTECTION_MODES as readonly string[]).includes(mode)) {
      patch = { linkProtectionMode: mode as LinkProtectionMode };
    }
    viewPath = "automod.links";
  } else {
    const stepperMatch = /^(automod\.(flood|mentions|duplicates))\.(limit|window|max|count)\.([+-]\d+)$/.exec(path);
    if (stepperMatch) {
      const [, base, , fieldKey, deltaText] = stepperMatch;
      const delta = Number(deltaText);
      const fieldByKey: Record<string, NumericField> = {
        "automod.flood.limit": "spamMaxMessages",
        "automod.flood.window": "spamWindowSeconds",
        "automod.mentions.max": "maxMentions",
        "automod.duplicates.window": "duplicateWindowSeconds",
        "automod.duplicates.count": "duplicateMaxMessages"
      };
      const field = fieldByKey[`${base}.${fieldKey}`];
      if (field) {
        patch = { [field]: clampField(field, settings[field] + delta) };
      }
      viewPath = base;
    }
  }

  if (!patch) return { viewPath, settings };

  const merged: ModerationSettingsValue = { ...settings, ...patch };
  const saved = await updateChatModerationSettings({
    chatId,
    actingAdminId,
    useGlobalProfile: false,
    ...merged
  });
  return { viewPath, settings: saved ?? merged };
}

async function renderAutomodSection(input: { chatId: string; chatTitle: string; telegramChatId: number; actingAdminId: string; path: string }) {
  const profile = await getChatModerationProfile(input.chatId);
  if (!profile) return null;

  const { viewPath, settings } = await applyAutomodAction(input.chatId, input.actingAdminId, profile.effectiveSettings, input.path);
  const renderer = AUTOMOD_VIEWS[viewPath];
  if (!renderer) return renderRoot(input.chatTitle, input.telegramChatId);
  return renderer(settings, input.telegramChatId);
}

type NumericAntiRaidField = "joinThreshold" | "windowSeconds" | "cooldownMinutes";
const ANTIRAID_FIELD_BOUNDS: Record<NumericAntiRaidField, { min: number; max: number }> = {
  joinThreshold: { min: 3, max: 500 },
  windowSeconds: { min: 5, max: 600 },
  cooldownMinutes: { min: 1, max: 1440 }
};

function clampAntiRaidField(field: NumericAntiRaidField, value: number) {
  const bounds = ANTIRAID_FIELD_BOUNDS[field];
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

async function renderProtectionSection(input: { chatId: string; chatTitle: string; telegramChatId: number; actingAdminId: string; path: string }) {
  const { path } = input;

  if (path === "protection") {
    const [captchaProfile, antiRaidProfile] = await Promise.all([
      getChatCaptchaProfile(input.chatId),
      getChatAntiRaidProfile(input.chatId)
    ]);
    if (!captchaProfile || !antiRaidProfile) return null;
    return renderProtectionMenu(captchaProfile.effectiveSettings, antiRaidProfile.effectiveSettings, input.telegramChatId);
  }

  if (path === "protection.captcha" || path === "protection.captcha.toggle") {
    const profile = await getChatCaptchaProfile(input.chatId);
    if (!profile) return null;
    let settings = profile.effectiveSettings;
    if (path === "protection.captcha.toggle") {
      const saved = await updateChatCaptchaProfile({
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        useGlobalProfile: false,
        settings: { ...settings, enabled: !settings.enabled }
      });
      settings = saved ?? { ...settings, enabled: !settings.enabled };
    }
    return renderCaptchaDetail(settings, input.telegramChatId);
  }

  if (path.startsWith("protection.antiraid")) {
    const profile = await getChatAntiRaidProfile(input.chatId);
    if (!profile) return null;
    let settings = profile.effectiveSettings;

    let patch: Partial<AntiRaidSettingsValue> | null = null;
    if (path === "protection.antiraid.toggle") {
      patch = { enabled: !settings.enabled };
    } else if (path === "protection.antiraid.forcecaptcha") {
      patch = { forceCaptcha: !settings.forceCaptcha };
    } else {
      const stepperMatch = /^protection\.antiraid\.(threshold|window|cooldown)\.([+-]\d+)$/.exec(path);
      if (stepperMatch) {
        const [, fieldKey, deltaText] = stepperMatch;
        const fieldByKey: Record<string, NumericAntiRaidField> = {
          threshold: "joinThreshold",
          window: "windowSeconds",
          cooldown: "cooldownMinutes"
        };
        const field = fieldByKey[fieldKey];
        if (field) {
          patch = { [field]: clampAntiRaidField(field, settings[field] + Number(deltaText)) };
        }
      }
    }

    if (patch) {
      const merged: AntiRaidSettingsValue = { ...settings, ...patch };
      const saved = await updateChatAntiRaidSettings({
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        useGlobalProfile: false,
        settings: merged
      });
      settings = saved ?? merged;
    }
    return renderAntiRaidDetail(settings, input.telegramChatId);
  }

  return null;
}

export async function renderSettingsMenu(input: {
  chatId: string;
  chatTitle: string;
  telegramChatId: number;
  actingAdminId: string;
  path: string;
}): Promise<{ text: string; keyboard: TelegramInlineKeyboardMarkup | null } | null> {
  if (input.path === "close") {
    return { text: "Настройки закрыты. Наберите /settings в чате, чтобы открыть снова.", keyboard: null };
  }
  if (input.path === "root") {
    return renderRoot(input.chatTitle, input.telegramChatId);
  }
  if (input.path === "protection" || input.path.startsWith("protection.")) {
    return (await renderProtectionSection(input)) ?? renderRoot(input.chatTitle, input.telegramChatId);
  }
  if (input.path === "moderation" || input.path.startsWith("moderation.")) {
    return (await renderModerationSection(input)) ?? renderRoot(input.chatTitle, input.telegramChatId);
  }

  return (await renderAutomodSection(input)) ?? renderRoot(input.chatTitle, input.telegramChatId);
}
