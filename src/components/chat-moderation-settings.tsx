"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { SettingsRow, ConditionalSettingsSection } from "@/components/settings-row";

// The 7 Filters-managed types (below) used to live in this flat list too --
// they're now configured individually in the "Фильтры" section instead, so
// this list only covers the types that still don't have per-type settings.
const mediaTypes = [
  ["DOCUMENT", "Файлы"], ["STICKER", "Стикеры"],
  ["POLL", "Опросы"], ["LOCATION", "Геолокация"], ["CONTACT", "Контакты"]
] as const;

export type MediaFilterType = "PHOTO" | "VIDEO" | "ANIMATION" | "VOICE" | "AUDIO" | "VIDEO_NOTE" | "DICE";

export type MediaFilterRuleValue = {
  type: MediaFilterType;
  enabled: boolean;
  warnOnTrigger: boolean;
  notifyEnabled: boolean;
  notifyText: string;
};

const MEDIA_FILTER_LABELS: Record<MediaFilterType, string> = {
  PHOTO: "Изображения",
  VIDEO: "Видео",
  ANIMATION: "GIF",
  VOICE: "Голосовые сообщения",
  AUDIO: "Аудиофайлы",
  VIDEO_NOTE: "Видеосообщения",
  DICE: "Анимированные кости"
};

const MEDIA_FILTER_ORDER: MediaFilterType[] = ["PHOTO", "VIDEO", "ANIMATION", "VOICE", "AUDIO", "VIDEO_NOTE", "DICE"];

export type EscalationRuleValue = {
  order: number;
  thresholdWarnings: number;
  action: "MUTE" | "BAN";
  durationMinutes: number | null;
};

export const LINK_PROTECTION_MODES = ["ALLOW_ALL", "BLOCK_ALL", "WHITELIST_ONLY", "BLACKLIST_ONLY"] as const;
export type LinkProtectionMode = (typeof LINK_PROTECTION_MODES)[number];

const LINK_PROTECTION_MODE_LABELS: Record<LinkProtectionMode, string> = {
  ALLOW_ALL: "Разрешить все ссылки",
  BLOCK_ALL: "Заблокировать все ссылки",
  WHITELIST_ONLY: "Разрешить только из списка",
  BLACKLIST_ONLY: "Заблокировать только из списка"
};

export type ModerationSettingsValue = {
  linkProtectionMode: LinkProtectionMode;
  allowedDomains: string[];
  blockedDomains: string[];
  spamEnabled: boolean;
  spamWindowSeconds: number;
  spamMaxMessages: number;
  blockedTermsEnabled: boolean;
  blockedTerms: string[];
  massMentionsEnabled: boolean;
  maxMentions: number;
  duplicateEnabled: boolean;
  duplicateWindowSeconds: number;
  duplicateMaxMessages: number;
  blockedMessageTypes: string[];
  ignoreAdmins: boolean;
  autoEscalationEnabled: boolean;
  escalationRules: EscalationRuleValue[];
  warningExpiryDays: number;
  announceEscalationEnabled: boolean;
  escalationMuteMessageTemplate: string;
  escalationBanMessageTemplate: string;
  mediaFilters: MediaFilterRuleValue[];
};

const ESCALATION_DURATION_MAX: Record<EscalationRuleValue["action"], number> = {
  MUTE: 10080,
  BAN: 366 * 24 * 60
};

function renumberEscalationRules(rules: EscalationRuleValue[]): EscalationRuleValue[] {
  return rules.map((rule, index) => ({ ...rule, order: index + 1 }));
}

// Presets (spec §54) bundle the three "anti-spam cluster" rules (antiflood,
// duplicates, mass mentions) into one choice — Low/Normal/Strict, or Custom
// once any field stops matching a preset exactly. Purely a client-side
// convenience over fields that already exist; no new settings are added.
type AntiSpamPresetKey = "LOW" | "NORMAL" | "STRICT";
const ANTI_SPAM_PRESETS: Record<AntiSpamPresetKey, {
  spamWindowSeconds: number;
  spamMaxMessages: number;
  duplicateWindowSeconds: number;
  duplicateMaxMessages: number;
  maxMentions: number;
}> = {
  LOW: { spamWindowSeconds: 20, spamMaxMessages: 10, duplicateWindowSeconds: 120, duplicateMaxMessages: 5, maxMentions: 10 },
  NORMAL: { spamWindowSeconds: 10, spamMaxMessages: 5, duplicateWindowSeconds: 60, duplicateMaxMessages: 2, maxMentions: 5 },
  STRICT: { spamWindowSeconds: 5, spamMaxMessages: 3, duplicateWindowSeconds: 30, duplicateMaxMessages: 1, maxMentions: 3 }
};
const ANTI_SPAM_PRESET_LABELS: Record<AntiSpamPresetKey, string> = { LOW: "Мягкий", NORMAL: "Обычный", STRICT: "Строгий" };

function matchingAntiSpamPreset(settings: ModerationSettingsValue): AntiSpamPresetKey | "CUSTOM" {
  if (!settings.spamEnabled || !settings.duplicateEnabled || !settings.massMentionsEnabled) return "CUSTOM";
  const match = (Object.keys(ANTI_SPAM_PRESETS) as AntiSpamPresetKey[]).find((key) => {
    const preset = ANTI_SPAM_PRESETS[key];
    return settings.spamWindowSeconds === preset.spamWindowSeconds
      && settings.spamMaxMessages === preset.spamMaxMessages
      && settings.duplicateWindowSeconds === preset.duplicateWindowSeconds
      && settings.duplicateMaxMessages === preset.duplicateMaxMessages
      && settings.maxMentions === preset.maxMentions;
  });
  return match ?? "CUSTOM";
}

type Props = {
  chatId: string;
  initial: ModerationSettingsValue;
  canEdit: boolean;
  botCanDeleteMessages?: boolean;
  botCanRestrictMembers?: boolean;
  onSaved?: (saved: ModerationSettingsValue) => void;
};

function splitList(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function ChatModerationSettings({
  chatId,
  initial,
  canEdit,
  botCanDeleteMessages = true,
  botCanRestrictMembers = true,
  onSaved
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [domains, setDomains] = useState(initial.allowedDomains.join("\n"));
  const [blockedDomainsText, setBlockedDomainsText] = useState(initial.blockedDomains.join("\n"));
  const [terms, setTerms] = useState(initial.blockedTerms.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fieldsDisabled = !canEdit || saving;
  const anyRuleEnabled = settings.linkProtectionMode !== "ALLOW_ALL" || settings.spamEnabled || settings.blockedTermsEnabled || settings.massMentionsEnabled || settings.duplicateEnabled || settings.blockedMessageTypes.length > 0 || settings.mediaFilters.some((rule) => rule.enabled);
  const activeAntiSpamPreset = matchingAntiSpamPreset(settings);

  function applyAntiSpamPreset(key: AntiSpamPresetKey) {
    const preset = ANTI_SPAM_PRESETS[key];
    setSettings((current) => ({ ...current, spamEnabled: true, duplicateEnabled: true, massMentionsEnabled: true, ...preset }));
  }

  async function save() {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/moderation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...settings,
          allowedDomains: splitList(domains),
          blockedDomains: splitList(blockedDomainsText),
          blockedTerms: splitList(terms)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки.");

      const saved = payload.data as ModerationSettingsValue;
      setSettings(saved); setDomains(saved.allowedDomains.join("\n")); setBlockedDomainsText(saved.blockedDomains.join("\n")); setTerms(saved.blockedTerms.join("\n"));
      setSuccess("Правила сохранены и применяются к новым Telegram-событиям.");
      onSaved?.(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки.");
    } finally { setSaving(false); }
  }

  function toggleMedia(type: string, checked: boolean) {
    setSettings((current) => ({ ...current, blockedMessageTypes: checked ? Array.from(new Set([...current.blockedMessageTypes, type])) : current.blockedMessageTypes.filter((item) => item !== type) }));
  }

  function updateMediaFilter(type: MediaFilterType, patch: Partial<MediaFilterRuleValue>) {
    setSettings((current) => ({
      ...current,
      mediaFilters: current.mediaFilters.map((rule) => (rule.type === type ? { ...rule, ...patch } : rule))
    }));
  }

  function addEscalationRule() {
    setSettings((current) => ({
      ...current,
      escalationRules: renumberEscalationRules([
        ...current.escalationRules,
        { order: 0, thresholdWarnings: 3, action: "MUTE", durationMinutes: 10 }
      ])
    }));
  }

  function updateEscalationRule(index: number, patch: Partial<EscalationRuleValue>) {
    setSettings((current) => ({
      ...current,
      escalationRules: current.escalationRules.map((rule, position) => (position === index ? { ...rule, ...patch } : rule))
    }));
  }

  function removeEscalationRule(index: number) {
    setSettings((current) => ({
      ...current,
      escalationRules: renumberEscalationRules(current.escalationRules.filter((_, position) => position !== index))
    }));
  }

  function moveEscalationRule(index: number, direction: -1 | 1) {
    setSettings((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.escalationRules.length) return current;
      const next = [...current.escalationRules];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, escalationRules: renumberEscalationRules(next) };
    });
  }

  return (
    <div className="automod-settings">
      {!botCanDeleteMessages && anyRuleEnabled ? <div className="moderation-notice"><TriangleAlert size={16} /><span>По последней проверке у бота нет права удаления сообщений. Telegram будет отклонять автоматические удаления до выдачи права.</span></div> : null}
      {settings.autoEscalationEnabled && !botCanRestrictMembers ? <div className="moderation-notice"><TriangleAlert size={16} /><span>Автонаказания включены, но у бота нет права ограничивать участников. Предупреждения сохранятся, а mute/ban будут завершаться ошибкой до выдачи права.</span></div> : null}
      {!canEdit ? <div className="moderation-readonly"><ShieldCheck size={18} /><div><strong>Только просмотр</strong><p>Изменять правила чата могут OWNER и ADMIN.</p></div></div> : null}

      <div className="automod-rule">
        <div className="automod-rule-heading"><strong>Защита от ссылок</strong><small>Режим определяет, какие ссылки удаляются автоматически.</small></div>
        <label className="automod-field automod-field--short">
          <span>Режим</span>
          <select
            value={settings.linkProtectionMode}
            disabled={fieldsDisabled}
            onChange={(event) => setSettings((current) => ({ ...current, linkProtectionMode: event.target.value as LinkProtectionMode }))}
          >
            {LINK_PROTECTION_MODES.map((mode) => <option key={mode} value={mode}>{LINK_PROTECTION_MODE_LABELS[mode]}</option>)}
          </select>
        </label>
        {settings.linkProtectionMode === "WHITELIST_ONLY" ? (
          <label className="automod-field"><span>Разрешённые домены</span><textarea rows={3} value={domains} disabled={fieldsDisabled} onChange={(event) => setDomains(event.target.value)} placeholder={"example.com\nsubdomain.ru"} /><small>По одному домену на строку. Поддомены разрешённого домена тоже пропускаются. Ссылки не из списка удаляются.</small></label>
        ) : null}
        {settings.linkProtectionMode === "BLACKLIST_ONLY" ? (
          <label className="automod-field"><span>Запрещённые домены</span><textarea rows={3} value={blockedDomainsText} disabled={fieldsDisabled} onChange={(event) => setBlockedDomainsText(event.target.value)} placeholder={"spam.example\nbad-domain.ru"} /><small>По одному домену на строку. Поддомены запрещённого домена тоже удаляются. Остальные ссылки разрешены.</small></label>
        ) : null}
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={settings.blockedTermsEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, blockedTermsEnabled: event.target.checked }))} /><span><strong>Запрещённые слова и фразы</strong><small>Проверяет текст сообщения и подпись к медиа без учёта регистра.</small></span></label>
        {settings.blockedTermsEnabled ? <label className="automod-field"><span>Список выражений</span><textarea rows={3} value={terms} disabled={fieldsDisabled} onChange={(event) => setTerms(event.target.value)} placeholder={"рекламная фраза\nзапрещенное слово"} /><small>Одно слово или фраза на строку. До 200 выражений.</small></label> : null}
      </div>

      <div className="automod-rule">
        <div className="automod-rule-heading"><strong>Антиспам-пресеты</strong><small>Быстрая настройка антифлуда, повторов и упоминаний разом. Ручное изменение любого поля ниже переключает на «Свой».</small></div>
        <div className="preset-row">
          {(Object.keys(ANTI_SPAM_PRESETS) as AntiSpamPresetKey[]).map((key) => (
            <button
              type="button"
              key={key}
              className={`preset-button ${activeAntiSpamPreset === key ? "preset-button--active" : ""}`}
              disabled={fieldsDisabled}
              onClick={() => applyAntiSpamPreset(key)}
            >
              {ANTI_SPAM_PRESET_LABELS[key]}
            </button>
          ))}
          <span className={`preset-button preset-button--status ${activeAntiSpamPreset === "CUSTOM" ? "preset-button--active" : ""}`}>
            {activeAntiSpamPreset === "CUSTOM" ? "Свой" : "✓ применён"}
          </span>
        </div>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={settings.spamEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, spamEnabled: event.target.checked }))} /><span><strong>Антифлуд</strong><small>Удаляет текущее сообщение при превышении лимита сообщений за окно времени.</small></span></label>
        {settings.spamEnabled ? <div className="automod-number-grid">
          <label className="automod-field"><span>Окно, секунд</span><input type="number" min={3} max={120} value={settings.spamWindowSeconds} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, spamWindowSeconds: Number(event.target.value) }))} /></label>
          <label className="automod-field"><span>Сообщений разрешено</span><input type="number" min={2} max={50} value={settings.spamMaxMessages} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, spamMaxMessages: Number(event.target.value) }))} /></label>
        </div> : null}
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={settings.duplicateEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateEnabled: event.target.checked }))} /><span><strong>Повторяющиеся сообщения</strong><small>Сравнивает нормализованный текст пользователя с его недавними сообщениями в этом чате.</small></span></label>
        {settings.duplicateEnabled ? <div className="automod-number-grid">
          <label className="automod-field"><span>Окно, секунд</span><input type="number" min={5} max={3600} value={settings.duplicateWindowSeconds} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateWindowSeconds: Number(event.target.value) }))} /></label>
          <label className="automod-field"><span>Одинаковых разрешено</span><input type="number" min={1} max={20} value={settings.duplicateMaxMessages} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateMaxMessages: Number(event.target.value) }))} /></label>
        </div> : null}
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={settings.massMentionsEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, massMentionsEnabled: event.target.checked }))} /><span><strong>Массовые упоминания</strong><small>Считает реальные Telegram mention/text_mention entities.</small></span></label>
        {settings.massMentionsEnabled ? <label className="automod-field automod-field--short"><span>Максимум упоминаний</span><input type="number" min={1} max={50} value={settings.maxMentions} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, maxMentions: Number(event.target.value) }))} /></label> : null}
      </div>

      <div className="automod-rule">
        <div className="automod-rule-heading"><strong>Запрещённые типы контента</strong><small>Выбранные типы удаляются сразу после получения Telegram update.</small></div>
        <div className="automod-media-grid">{mediaTypes.map(([value, label]) => <label className="automod-media-option" key={value}><input type="checkbox" checked={settings.blockedMessageTypes.includes(value)} disabled={fieldsDisabled} onChange={(event) => toggleMedia(value, event.target.checked)} /><span>{label}</span></label>)}</div>
      </div>

      <div className="automod-rule-heading"><strong>Фильтры</strong><small>Для медиатипов ниже — отдельно от общих настроек: можно решить, участвует ли конкретный тип в предупреждениях/автонаказаниях, и отправлять ли сообщение при срабатывании.</small></div>
      {MEDIA_FILTER_ORDER.map((type) => {
        const rule = settings.mediaFilters.find((item) => item.type === type);
        if (!rule) return null;
        return (
          <div className="automod-rule" key={type}>
            <SettingsRow
              title={MEDIA_FILTER_LABELS[type]}
              description="Удалять сообщения этого типа."
              checked={rule.enabled}
              disabled={fieldsDisabled}
              onChange={(checked) => updateMediaFilter(type, { enabled: checked })}
            />
            <ConditionalSettingsSection visible={rule.enabled}>
              <SettingsRow
                title="Выдавать предупреждение нарушителю"
                description="Засчитывается в общий счётчик предупреждений и автонаказаний чата (нужно также включить «Автоматические наказания» ниже)."
                checked={rule.warnOnTrigger}
                disabled={fieldsDisabled}
                onChange={(checked) => updateMediaFilter(type, { warnOnTrigger: checked })}
              />
              <SettingsRow
                title="Отправлять сообщение при срабатывании"
                description="Публикует текст ниже в чат сразу при удалении — независимо от предупреждения."
                checked={rule.notifyEnabled}
                disabled={fieldsDisabled}
                onChange={(checked) => updateMediaFilter(type, { notifyEnabled: checked })}
              />
              {rule.notifyEnabled ? <small className="hint-note">Текст сообщения редактируется в Система → Уведомления.</small> : null}
            </ConditionalSettingsSection>
          </div>
        );
      })}

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={settings.autoEscalationEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, autoEscalationEnabled: event.target.checked }))} /><span><strong>Автоматические наказания</strong><small>Каждое успешно удалённое automod-сообщение добавляет предупреждение. По достижении порогов Modera применяет временный mute, затем ban.</small></span></label>
        {settings.autoEscalationEnabled ? <>
          <div className="escalation-rule-list">
            {settings.escalationRules.length === 0 ? <p className="hint-note">Правил нет — предупреждения ни к чему не приводят автоматически. Добавьте хотя бы одно правило.</p> : null}
            {settings.escalationRules.map((rule, index) => (
              <div className="escalation-rule-row" key={index}>
                <span className="escalation-rule-position">{index + 1}</span>
                <label className="automod-field automod-field--short">
                  <span>Порог предупреждений</span>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={rule.thresholdWarnings}
                    disabled={fieldsDisabled}
                    onChange={(event) => updateEscalationRule(index, { thresholdWarnings: Number(event.target.value) })}
                  />
                </label>
                <label className="automod-field automod-field--short">
                  <span>Действие</span>
                  <select
                    value={rule.action}
                    disabled={fieldsDisabled}
                    onChange={(event) => {
                      const action = event.target.value as EscalationRuleValue["action"];
                      updateEscalationRule(index, {
                        action,
                        durationMinutes: rule.durationMinutes !== null ? Math.min(rule.durationMinutes, ESCALATION_DURATION_MAX[action]) : null
                      });
                    }}
                  >
                    <option value="MUTE">Mute</option>
                    <option value="BAN">Ban</option>
                  </select>
                </label>
                <label className="automod-field automod-field--short">
                  <span>Срок, минут</span>
                  <input
                    type="number"
                    min={1}
                    max={ESCALATION_DURATION_MAX[rule.action]}
                    placeholder="Без срока"
                    value={rule.durationMinutes ?? ""}
                    disabled={fieldsDisabled}
                    onChange={(event) => updateEscalationRule(index, { durationMinutes: event.target.value ? Number(event.target.value) : null })}
                  />
                </label>
                <div className="escalation-rule-actions">
                  <button type="button" className="icon-button" disabled={fieldsDisabled || index === 0} onClick={() => moveEscalationRule(index, -1)} title="Переместить выше"><ArrowUp size={15} /></button>
                  <button type="button" className="icon-button" disabled={fieldsDisabled || index === settings.escalationRules.length - 1} onClick={() => moveEscalationRule(index, 1)} title="Переместить ниже"><ArrowDown size={15} /></button>
                  <button type="button" className="icon-button icon-button--danger" disabled={fieldsDisabled} onClick={() => removeEscalationRule(index)} title="Удалить правило"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
            <button type="button" className="button button--secondary" disabled={fieldsDisabled} onClick={addEscalationRule}><Plus size={15} />Добавить правило</button>
          </div>
          <label className="automod-field automod-field--short"><span>Срок предупреждений, дней</span><input type="number" min={0} max={3650} value={settings.warningExpiryDays} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, warningExpiryDays: Number(event.target.value) }))} /></label>
          <small className="hint-note">0 — предупреждения не сгорают, иначе старые перестают учитываться в порогах по истечении срока. Пустой срок = бессрочно (до ручного unmute/unban). Если несколько порогов пройдены за раз, применяется правило с самым высоким порогом.</small>

          <label className="automod-toggle-row automod-toggle-row--compact"><input type="checkbox" checked={settings.announceEscalationEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, announceEscalationEnabled: event.target.checked }))} /><span><strong>Объявлять в чате</strong><small>Когда automod доводит участника до mute/ban по порогу предупреждений, бот пишет об этом в чат (по умолчанию выключено — automod иначе наказывает молча). Текст сообщений редактируется в Система → Уведомления.</small></span></label>
        </> : null}
      </div>

      <label className="automod-toggle-row automod-toggle-row--compact"><input type="checkbox" checked={settings.ignoreAdmins} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, ignoreAdmins: event.target.checked }))} /><span><strong>Не применять к администраторам Telegram</strong><small>Рекомендуется оставить включённым. Автоматический mute/ban владельца или администратора в любом случае заблокирован сервером.</small></span></label>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? <div className="automod-actions"><button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить правила"}</button></div> : null}
    </div>
  );
}
