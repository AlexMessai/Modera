import { getChatModerationProfile, updateChatModerationSettings } from "@/server/services/chat-moderation-settings-service";
import { LINK_PROTECTION_MODES, type LinkProtectionMode, type ModerationSettingsValue } from "@/server/services/global-moderation-service";
import { getChatCaptchaProfile, updateChatCaptchaProfile, type CaptchaSettingsValue } from "@/server/services/captcha-settings-service";
import { getChatAntiRaidProfile, updateChatAntiRaidSettings, type AntiRaidSettingsValue } from "@/server/services/anti-raid-settings-service";
import { getChatReportProfile, updateChatReportSettings, type ReportSettingsValue } from "@/server/services/report-settings-service";
import { getChatLogChannelProfile, startLogChannelLink, unlinkLogChannel, updateChatLogChannelSettings, type LogChannelSettingsValue } from "@/server/services/log-channel-service";
import { getChatContentProfile, updateChatContentSettings, type ContentSettingsValue } from "@/server/services/content-settings-service";
import { getActiveSilence } from "@/server/services/silence-service";
import { listAutoResponseRules } from "@/server/services/auto-response-service";
import { listCustomCommands } from "@/server/services/custom-command-service";
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
    text: `⚙️ Настройки чата «${chatTitle}»\n\nИзменения здесь применяются только к этому чату.`,
    keyboard: {
      inline_keyboard: [
        [{ text: "⚖️ Модерация", callback_data: buildSettingsCallbackData(telegramChatId, "moderation") }],
        [{ text: "🛡 Автомодерация", callback_data: buildSettingsCallbackData(telegramChatId, "automod") }],
        [{ text: "🔐 Защита", callback_data: buildSettingsCallbackData(telegramChatId, "protection") }],
        [{ text: "🚩 Жалобы", callback_data: buildSettingsCallbackData(telegramChatId, "reports") }],
        [{ text: "📋 Логи", callback_data: buildSettingsCallbackData(telegramChatId, "logs") }],
        [{ text: "💬 Чат", callback_data: buildSettingsCallbackData(telegramChatId, "chat") }],
        [{ text: "🤖 Автоматизация", callback_data: buildSettingsCallbackData(telegramChatId, "automation") }],
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
        [{ text: `📎 Фильтры: ${settings.mediaFilters.filter((rule) => rule.enabled).length} тип(ов) ограничено`, callback_data: buildSettingsCallbackData(telegramChatId, "automod.media") }],
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
  const enabledCount = settings.mediaFilters.filter((rule) => rule.enabled).length;
  return {
    text: `📎 Фильтры\n\nОграничено типов: ${enabledCount}. Список редактируется в Web Admin (Настройки → Фильтры).`,
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
    text: `🤖 CAPTCHA при вступлении\n\nНовый участник должен подтвердить, что не бот, прежде чем сможет писать в чат. Кто не подтвердит — будет исключён (не заблокирован) при ближайшей ежедневной проверке. Текст сообщения общий для всех чатов, редактируется в Web Admin → Система → Уведомления.`,
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
    rows.push(toggleRow(`Блокировать чат во время рейда: ${settings.lockChat ? "✅ вкл" : "⬜ выкл"}`, "protection.antiraid.lockchat", telegramChatId));
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
    text: `🔨 Наказания\n\nЦепочка наказаний за накопленные предупреждения (полный список правил редактируется в Web Admin; тексты сообщений — в Система → Уведомления):\n${chain || "не настроена"}`,
    keyboard: {
      inline_keyboard: [
        toggleRow(`Автонаказания: ${settings.autoEscalationEnabled ? "✅ включены" : "⬜ выключены"}`, "moderation.punishments.auto.toggle", telegramChatId),
        toggleRow(`Объявлять в чате: ${settings.announceEscalationEnabled ? "✅ вкл" : "⬜ выкл"}`, "moderation.punishments.announce.toggle", telegramChatId),
        backRow("moderation", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
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
    let settings = profile.settings;

    const stepperMatch = /^moderation\.warnings\.expiry\.([+-]\d+)$/.exec(path);
    if (stepperMatch) {
      const nextValue = Math.min(3650, Math.max(0, settings.warningExpiryDays + Number(stepperMatch[1])));
      const merged: ModerationSettingsValue = { ...settings, warningExpiryDays: nextValue };
      const saved = await updateChatModerationSettings({ chatId: input.chatId, actingAdminId: input.actingAdminId, ...merged });
      settings = saved ?? merged;
    }
    return renderWarningsDetail(settings, input.telegramChatId);
  }

  if (path === "moderation.punishments" || path === "moderation.punishments.auto.toggle" || path === "moderation.punishments.announce.toggle") {
    const profile = await getChatModerationProfile(input.chatId);
    if (!profile) return null;
    let settings = profile.settings;

    let patch: Partial<ModerationSettingsValue> | null = null;
    if (path === "moderation.punishments.auto.toggle") patch = { autoEscalationEnabled: !settings.autoEscalationEnabled };
    if (path === "moderation.punishments.announce.toggle") patch = { announceEscalationEnabled: !settings.announceEscalationEnabled };

    if (patch) {
      const merged: ModerationSettingsValue = { ...settings, ...patch };
      const saved = await updateChatModerationSettings({ chatId: input.chatId, actingAdminId: input.actingAdminId, ...merged });
      settings = saved ?? merged;
    }
    return renderPunishmentsDetail(settings, input.telegramChatId);
  }

  return null;
}

function renderReportsDetail(settings: ReportSettingsValue, telegramChatId: number) {
  const rows = [toggleRow(`Статус: ${settings.enabled ? "✅ включены" : "⬜ выключены"}`, "reports.toggle", telegramChatId)];
  if (settings.enabled) {
    rows.push(stepperRow("Срок, мин", settings.muteDurationMinutes, "duration", "reports", telegramChatId, 15));
  }
  rows.push(backRow("root", telegramChatId));
  return {
    text: `🚩 Жалобы\n\nУчастник может ответить (Reply) на сообщение командой /report [причина]. Администраторы получают приватную карточку в Telegram с кнопками: Удалить / Предупредить / Ограничить / Забанить / Отклонить. Кнопка «Ограничить» всегда использует фиксированный срок mute («Срок» ниже) — для другого срока используйте /mute напрямую.`,
    keyboard: { inline_keyboard: rows } satisfies TelegramInlineKeyboardMarkup
  };
}

async function renderReportsSection(input: { chatId: string; chatTitle: string; telegramChatId: number; actingAdminId: string; path: string }) {
  const profile = await getChatReportProfile(input.chatId);
  if (!profile) return null;
  let settings = profile.settings;

  let patch: Partial<ReportSettingsValue> | null = null;
  if (input.path === "reports.toggle") {
    patch = { enabled: !settings.enabled };
  } else {
    const stepperMatch = /^reports\.duration\.([+-]\d+)$/.exec(input.path);
    if (stepperMatch) {
      const nextValue = Math.min(10080, Math.max(1, settings.muteDurationMinutes + Number(stepperMatch[1])));
      patch = { muteDurationMinutes: nextValue };
    }
  }

  if (patch) {
    const merged: ReportSettingsValue = { ...settings, ...patch };
    const saved = await updateChatReportSettings({
      chatId: input.chatId,
      actingAdminId: input.actingAdminId,
      settings: merged
    });
    settings = saved ?? merged;
  }
  return renderReportsDetail(settings, input.telegramChatId);
}

function renderLogsDetail(settings: LogChannelSettingsValue, telegramChatId: number) {
  if (!settings.logChannelTelegramId) {
    return {
      text: `📋 Логи\n\nКанал для пересылки событий модерации (mute/ban/kick/warn и их отмена) не подключён.\n\nЧтобы подключить:\n1. Добавьте меня в канал или группу администратором с правом публикации сообщений.\n2. Нажмите «Подключить канал».\n3. Перешлите мне сюда, в личные сообщения, любой пост из этого канала (именно «Переслать», не копию текста).`,
      keyboard: {
        inline_keyboard: [
          [{ text: "🔗 Подключить канал", callback_data: buildSettingsCallbackData(telegramChatId, "logs.link") }],
          backRow("root", telegramChatId)
        ]
      } satisfies TelegramInlineKeyboardMarkup
    };
  }
  return {
    text: `📋 Логи\n\nКанал: ${settings.logChannelTitle ?? settings.logChannelTelegramId}\nПересылаются события: mute/ban/kick/warn и их отмена.`,
    keyboard: {
      inline_keyboard: [
        toggleRow(`Статус: ${settings.enabled ? "✅ пересылка включена" : "⬜ пересылка выключена"}`, "logs.toggle", telegramChatId),
        [{ text: "🔁 Переподключить канал", callback_data: buildSettingsCallbackData(telegramChatId, "logs.link") }],
        [{ text: "🗑 Отключить канал", callback_data: buildSettingsCallbackData(telegramChatId, "logs.unlink") }],
        backRow("root", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

async function renderLogsSection(input: { chatId: string; chatTitle: string; telegramChatId: number; actingAdminId: string; path: string }) {
  if (input.path === "logs.link") {
    await startLogChannelLink({ chatId: input.chatId, actingAdminId: input.actingAdminId });
    return {
      text: `🔗 Подключение канала логов\n\nПерешлите мне сюда, в личные сообщения, любой пост из нужного канала (я уже должен быть в нём администратором с правом публикации). Жду в течение 10 минут.`,
      keyboard: { inline_keyboard: [backRow("logs", input.telegramChatId)] } satisfies TelegramInlineKeyboardMarkup
    };
  }
  if (input.path === "logs.unlink") {
    await unlinkLogChannel({ chatId: input.chatId, actingAdminId: input.actingAdminId });
    return renderLogsDetail({ enabled: false, logChannelTelegramId: null, logChannelTitle: null }, input.telegramChatId);
  }

  const profile = await getChatLogChannelProfile(input.chatId);
  if (!profile) return null;
  let settings = profile.settings;

  if (input.path === "logs.toggle" && settings.logChannelTelegramId) {
    const saved = await updateChatLogChannelSettings({
      chatId: input.chatId,
      actingAdminId: input.actingAdminId,
      enabled: !settings.enabled
    });
    settings = saved ?? settings;
  }
  return renderLogsDetail(settings, input.telegramChatId);
}

function renderChatMenu(settings: ContentSettingsValue, telegramChatId: number) {
  return {
    text: "💬 Чат\n\nВыберите раздел, чтобы посмотреть или изменить его.",
    keyboard: {
      inline_keyboard: [
        [{ text: `👋 Приветствие: ${settings.welcomeEnabled ? "вкл" : "выкл"}`, callback_data: buildSettingsCallbackData(telegramChatId, "chat.welcome") }],
        [{ text: "🔇 Режим тишины", callback_data: buildSettingsCallbackData(telegramChatId, "chat.silence") }],
        backRow("root", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

// Telegram caps a message at 4096 characters; welcomeMessageTemplate can be
// up to 2000 on its own, so the preview shown here (which also has to fit
// the surrounding explanation) is truncated -- the full text is always
// visible in Web Admin, this is just a status preview.
const CONTENT_PREVIEW_LIMIT = 1500;

function previewText(value: string, limit: number = CONTENT_PREVIEW_LIMIT) {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function renderWelcomeDetail(settings: ContentSettingsValue, telegramChatId: number) {
  return {
    text: `👋 Приветствие новых участников\n\nОтправляется приватно вступившему участнику сразу после вступления (видно только ему, как нативное «Приветствие» в самом Telegram). Редактируется в Web Admin → этот чат → Новые пользователи.\n\nТекущий текст:\n${previewText(settings.welcomeMessageTemplate)}`,
    keyboard: {
      inline_keyboard: [
        toggleRow(`Статус: ${settings.welcomeEnabled ? "✅ включено" : "⬜ выключено"}`, "chat.welcome.toggle", telegramChatId),
        backRow("chat", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

async function renderChatSection(input: { chatId: string; chatTitle: string; telegramChatId: number; actingAdminId: string; path: string }) {
  const profile = await getChatContentProfile(input.chatId);
  if (!profile) return null;
  let settings = profile.settings;

  if (input.path === "chat") return renderChatMenu(settings, input.telegramChatId);

  if (input.path === "chat.welcome" || input.path === "chat.welcome.toggle") {
    if (input.path === "chat.welcome.toggle") {
      const saved = await updateChatContentSettings({
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        settings: { ...settings, welcomeEnabled: !settings.welcomeEnabled }
      });
      settings = saved ?? { ...settings, welcomeEnabled: !settings.welcomeEnabled };
    }
    return renderWelcomeDetail(settings, input.telegramChatId);
  }

  if (input.path === "chat.silence") {
    const active = await getActiveSilence(input.chatId);
    const text = active
      ? `🔇 Режим тишины\n\nСейчас включён до ${active.expiresAt ? new Date(active.expiresAt).toLocaleString("ru-RU") : "—"}. Снять раньше: команда /unsilence в чате.`
      : `🔇 Режим тишины\n\nСейчас выключен. Включить: команда /silence [срок] в чате, например /silence 30m. Модераторы и администраторы продолжают писать, пока включён.`;
    return { text, keyboard: { inline_keyboard: [backRow("chat", input.telegramChatId)] } satisfies TelegramInlineKeyboardMarkup };
  }

  return null;
}

// Trigger/response(-text) fields are each admin-controlled free text (up to
// 200/1000 chars for auto-responses, 32/1000 for custom commands, up to 20
// rows each) -- every list below is truncated per-line and capped in count
// so it can't push past Telegram's 4096-char message limit the way an
// untruncated preview did in an earlier PR.
const MAX_LISTED_AUTOMATION_ITEMS = 10;

function renderAutomationMenu(telegramChatId: number) {
  return {
    text: "🤖 Автоматизация\n\nВыберите раздел. Добавление и редактирование — в Web Admin.",
    keyboard: {
      inline_keyboard: [
        [{ text: "💬 Автоответы", callback_data: buildSettingsCallbackData(telegramChatId, "automation.responses") }],
        [{ text: "⚙️ Свои команды", callback_data: buildSettingsCallbackData(telegramChatId, "automation.commands") }],
        backRow("root", telegramChatId)
      ]
    } satisfies TelegramInlineKeyboardMarkup
  };
}

async function renderAutomationSection(input: { chatId: string; chatTitle: string; telegramChatId: number; actingAdminId: string; path: string }) {
  if (input.path === "automation") return renderAutomationMenu(input.telegramChatId);

  if (input.path === "automation.responses") {
    const rules = await listAutoResponseRules(input.chatId);
    const enabledCount = rules.filter((rule) => rule.enabled).length;
    const shown = rules.slice(0, MAX_LISTED_AUTOMATION_ITEMS);
    const lines = shown.length
      ? shown.map((rule) => `${rule.enabled ? "✅" : "⬜"} «${previewText(rule.trigger, 40)}» → ${previewText(rule.responseText, 60)}`)
      : ["Автоответов пока нет."];
    if (rules.length > MAX_LISTED_AUTOMATION_ITEMS) lines.push(`…и ещё ${rules.length - MAX_LISTED_AUTOMATION_ITEMS}, см. Web Admin.`);

    return {
      text: `💬 Автоответы\n\nВключено: ${enabledCount} из ${rules.length}.\n\n${lines.join("\n")}`,
      keyboard: { inline_keyboard: [backRow("automation", input.telegramChatId)] } satisfies TelegramInlineKeyboardMarkup
    };
  }

  if (input.path === "automation.commands") {
    const commands = await listCustomCommands(input.chatId);
    const enabledCount = commands.filter((command) => command.enabled).length;
    const shown = commands.slice(0, MAX_LISTED_AUTOMATION_ITEMS);
    const lines = shown.length
      ? shown.map((command) => `${command.enabled ? "✅" : "⬜"} /${command.trigger}${command.adminOnly ? " (админы)" : ""} → ${previewText(command.responseText, 60)}`)
      : ["Своих команд пока нет."];
    if (commands.length > MAX_LISTED_AUTOMATION_ITEMS) lines.push(`…и ещё ${commands.length - MAX_LISTED_AUTOMATION_ITEMS}, см. Web Admin.`);

    return {
      text: `⚙️ Свои команды\n\nВключено: ${enabledCount} из ${commands.length}.\n\n${lines.join("\n")}`,
      keyboard: { inline_keyboard: [backRow("automation", input.telegramChatId)] } satisfies TelegramInlineKeyboardMarkup
    };
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
    ...merged
  });
  return { viewPath, settings: saved ?? merged };
}

async function renderAutomodSection(input: { chatId: string; chatTitle: string; telegramChatId: number; actingAdminId: string; path: string }) {
  const profile = await getChatModerationProfile(input.chatId);
  if (!profile) return null;

  const { viewPath, settings } = await applyAutomodAction(input.chatId, input.actingAdminId, profile.settings, input.path);
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
    return renderProtectionMenu(captchaProfile.settings, antiRaidProfile.settings, input.telegramChatId);
  }

  if (path === "protection.captcha" || path === "protection.captcha.toggle") {
    const profile = await getChatCaptchaProfile(input.chatId);
    if (!profile) return null;
    let settings = profile.settings;
    if (path === "protection.captcha.toggle") {
      const saved = await updateChatCaptchaProfile({
        chatId: input.chatId,
        actingAdminId: input.actingAdminId,
        settings: { ...settings, enabled: !settings.enabled }
      });
      settings = saved ?? { ...settings, enabled: !settings.enabled };
    }
    return renderCaptchaDetail(settings, input.telegramChatId);
  }

  if (path.startsWith("protection.antiraid")) {
    const profile = await getChatAntiRaidProfile(input.chatId);
    if (!profile) return null;
    let settings = profile.settings;

    let patch: Partial<AntiRaidSettingsValue> | null = null;
    if (path === "protection.antiraid.toggle") {
      patch = { enabled: !settings.enabled };
    } else if (path === "protection.antiraid.forcecaptcha") {
      patch = { forceCaptcha: !settings.forceCaptcha };
    } else if (path === "protection.antiraid.lockchat") {
      patch = { lockChat: !settings.lockChat };
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
  if (input.path === "reports" || input.path.startsWith("reports.")) {
    return (await renderReportsSection(input)) ?? renderRoot(input.chatTitle, input.telegramChatId);
  }
  if (input.path === "logs" || input.path.startsWith("logs.")) {
    return (await renderLogsSection(input)) ?? renderRoot(input.chatTitle, input.telegramChatId);
  }
  if (input.path === "chat" || input.path.startsWith("chat.")) {
    return (await renderChatSection(input)) ?? renderRoot(input.chatTitle, input.telegramChatId);
  }
  if (input.path === "automation" || input.path.startsWith("automation.")) {
    return (await renderAutomationSection(input)) ?? renderRoot(input.chatTitle, input.telegramChatId);
  }

  return (await renderAutomodSection(input)) ?? renderRoot(input.chatTitle, input.telegramChatId);
}
