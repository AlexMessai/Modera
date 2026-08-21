import { getChatModerationProfile, updateChatModerationSettings } from "@/server/services/chat-moderation-settings-service";
import { LINK_PROTECTION_MODES, type LinkProtectionMode, type ModerationSettingsValue } from "@/server/services/global-moderation-service";
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
        [{ text: "🛡 Автомодерация", callback_data: buildSettingsCallbackData(telegramChatId, "automod") }],
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

/** Applies a mutating path segment (toggle / stepper / mode-set) to settings, returning the view path to render afterward. Non-mutating paths pass through unchanged. */
async function applyAction(chatId: string, actingAdminId: string, settings: ModerationSettingsValue, path: string): Promise<{ viewPath: string; settings: ModerationSettingsValue }> {
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

  const profile = await getChatModerationProfile(input.chatId);
  if (!profile) return null;
  const baseSettings = profile.effectiveSettings;

  const { viewPath, settings } = await applyAction(input.chatId, input.actingAdminId, baseSettings, input.path);
  const renderer = AUTOMOD_VIEWS[viewPath];
  if (!renderer) return renderRoot(input.chatTitle, input.telegramChatId);
  return renderer(settings, input.telegramChatId);
}
