"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Check, Globe2, Plus, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";

const mediaTypes = [
  ["PHOTO", "Фото"], ["VIDEO", "Видео"], ["ANIMATION", "GIF / анимации"], ["DOCUMENT", "Файлы"],
  ["STICKER", "Стикеры"], ["VOICE", "Голосовые"], ["AUDIO", "Аудио"], ["VIDEO_NOTE", "Видеосообщения"],
  ["POLL", "Опросы"], ["DICE", "Игровые кубики"], ["LOCATION", "Геолокация"], ["CONTACT", "Контакты"]
] as const;

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
};

const ESCALATION_DURATION_MAX: Record<EscalationRuleValue["action"], number> = {
  MUTE: 10080,
  BAN: 366 * 24 * 60
};

function renumberEscalationRules(rules: EscalationRuleValue[]): EscalationRuleValue[] {
  return rules.map((rule, index) => ({ ...rule, order: index + 1 }));
}

type Props = {
  chatId?: string;
  initial: ModerationSettingsValue;
  canEdit: boolean;
  botCanDeleteMessages?: boolean;
  botCanRestrictMembers?: boolean;
  scope?: "chat" | "global";
  initialUseGlobalProfile?: boolean;
  globalSettings?: ModerationSettingsValue;
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
  scope = "chat",
  initialUseGlobalProfile = false,
  globalSettings,
  onSaved
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [useGlobalProfile, setUseGlobalProfile] = useState(initialUseGlobalProfile);
  const [domains, setDomains] = useState(initial.allowedDomains.join("\n"));
  const [blockedDomainsText, setBlockedDomainsText] = useState(initial.blockedDomains.join("\n"));
  const [terms, setTerms] = useState(initial.blockedTerms.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isGlobalScope = scope === "global";
  const inherited = !isGlobalScope && useGlobalProfile && Boolean(globalSettings);
  const visibleSettings = inherited && globalSettings ? globalSettings : settings;
  const visibleDomains = inherited && globalSettings ? globalSettings.allowedDomains.join("\n") : domains;
  const visibleBlockedDomains = inherited && globalSettings ? globalSettings.blockedDomains.join("\n") : blockedDomainsText;
  const visibleTerms = inherited && globalSettings ? globalSettings.blockedTerms.join("\n") : terms;
  const fieldsDisabled = !canEdit || saving || inherited;
  const anyRuleEnabled = visibleSettings.linkProtectionMode !== "ALLOW_ALL" || visibleSettings.spamEnabled || visibleSettings.blockedTermsEnabled || visibleSettings.massMentionsEnabled || visibleSettings.duplicateEnabled || visibleSettings.blockedMessageTypes.length > 0;

  async function save() {
    if (!isGlobalScope && !chatId) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(isGlobalScope ? "/api/moderation/global" : `/api/chats/${chatId}/moderation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...settings,
          ...(isGlobalScope ? {} : { useGlobalProfile }),
          allowedDomains: splitList(domains),
          blockedDomains: splitList(blockedDomainsText),
          blockedTerms: splitList(terms)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки.");

      if (isGlobalScope) {
        const saved = payload.data as ModerationSettingsValue;
        setSettings(saved); setDomains(saved.allowedDomains.join("\n")); setBlockedDomainsText(saved.blockedDomains.join("\n")); setTerms(saved.blockedTerms.join("\n"));
        setSuccess("Глобальная политика сохранена. Чаты с наследованием применят её к новым Telegram-событиям.");
        onSaved?.(saved);
      } else {
        const saved = payload.data as ModerationSettingsValue & { useGlobalProfile: boolean };
        const { useGlobalProfile: savedMode, ...savedSettings } = saved;
        setUseGlobalProfile(savedMode); setSettings(savedSettings); setDomains(savedSettings.allowedDomains.join("\n")); setBlockedDomainsText(savedSettings.blockedDomains.join("\n")); setTerms(savedSettings.blockedTerms.join("\n"));
        setSuccess(savedMode ? "Чат переключён на глобальную политику модерации." : "Индивидуальные правила сохранены и применяются к новым Telegram-событиям.");
        onSaved?.(savedSettings);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки.");
    } finally { setSaving(false); }
  }

  function toggleMedia(type: string, checked: boolean) {
    setSettings((current) => ({ ...current, blockedMessageTypes: checked ? Array.from(new Set([...current.blockedMessageTypes, type])) : current.blockedMessageTypes.filter((item) => item !== type) }));
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
      {!isGlobalScope ? (
        <div className="automod-rule">
          <label className="automod-toggle-row">
            <input type="checkbox" checked={useGlobalProfile} disabled={!canEdit || saving} onChange={(event) => setUseGlobalProfile(event.target.checked)} />
            <span><strong>Использовать глобальную политику</strong><small>Правила этого чата будут автоматически следовать настройкам из раздела «Модерация».</small></span>
          </label>
          {useGlobalProfile ? <div className="moderation-readonly"><Globe2 size={18} /><div><strong>Глобальное наследование включено</strong><p>Индивидуальные значения сохранены, но пока не применяются. Отключите наследование, чтобы вернуться к ним.</p></div></div> : null}
        </div>
      ) : null}

      {!botCanDeleteMessages && anyRuleEnabled ? <div className="moderation-notice"><TriangleAlert size={16} /><span>По последней проверке у бота нет права удаления сообщений. Telegram будет отклонять автоматические удаления до выдачи права.</span></div> : null}
      {!isGlobalScope && visibleSettings.autoEscalationEnabled && !botCanRestrictMembers ? <div className="moderation-notice"><TriangleAlert size={16} /><span>Автонаказания включены, но у бота нет права ограничивать участников. Предупреждения сохранятся, а mute/ban будут завершаться ошибкой до выдачи права.</span></div> : null}
      {!canEdit ? <div className="moderation-readonly"><ShieldCheck size={18} /><div><strong>Только просмотр</strong><p>{isGlobalScope ? "Изменять глобальную политику могут OWNER и ADMIN." : "Изменять правила чата могут OWNER и ADMIN."}</p></div></div> : null}

      <div className="automod-rule">
        <div className="automod-rule-heading"><strong>Защита от ссылок</strong><small>Режим определяет, какие ссылки удаляются автоматически.</small></div>
        <label className="automod-field automod-field--short">
          <span>Режим</span>
          <select
            value={visibleSettings.linkProtectionMode}
            disabled={fieldsDisabled}
            onChange={(event) => setSettings((current) => ({ ...current, linkProtectionMode: event.target.value as LinkProtectionMode }))}
          >
            {LINK_PROTECTION_MODES.map((mode) => <option key={mode} value={mode}>{LINK_PROTECTION_MODE_LABELS[mode]}</option>)}
          </select>
        </label>
        {visibleSettings.linkProtectionMode === "WHITELIST_ONLY" ? (
          <label className="automod-field"><span>Разрешённые домены</span><textarea rows={3} value={visibleDomains} disabled={fieldsDisabled} onChange={(event) => setDomains(event.target.value)} placeholder={"example.com\nsubdomain.ru"} /><small>По одному домену на строку. Поддомены разрешённого домена тоже пропускаются. Ссылки не из списка удаляются.</small></label>
        ) : null}
        {visibleSettings.linkProtectionMode === "BLACKLIST_ONLY" ? (
          <label className="automod-field"><span>Запрещённые домены</span><textarea rows={3} value={visibleBlockedDomains} disabled={fieldsDisabled} onChange={(event) => setBlockedDomainsText(event.target.value)} placeholder={"spam.example\nbad-domain.ru"} /><small>По одному домену на строку. Поддомены запрещённого домена тоже удаляются. Остальные ссылки разрешены.</small></label>
        ) : null}
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.blockedTermsEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, blockedTermsEnabled: event.target.checked }))} /><span><strong>Запрещённые слова и фразы</strong><small>Проверяет текст сообщения и подпись к медиа без учёта регистра.</small></span></label>
        {visibleSettings.blockedTermsEnabled ? <label className="automod-field"><span>Список выражений</span><textarea rows={3} value={visibleTerms} disabled={fieldsDisabled} onChange={(event) => setTerms(event.target.value)} placeholder={"рекламная фраза\nзапрещенное слово"} /><small>Одно слово или фраза на строку. До 200 выражений.</small></label> : null}
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.spamEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, spamEnabled: event.target.checked }))} /><span><strong>Антифлуд</strong><small>Удаляет текущее сообщение при превышении лимита сообщений за окно времени.</small></span></label>
        {visibleSettings.spamEnabled ? <div className="automod-number-grid">
          <label className="automod-field"><span>Окно, секунд</span><input type="number" min={3} max={120} value={visibleSettings.spamWindowSeconds} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, spamWindowSeconds: Number(event.target.value) }))} /></label>
          <label className="automod-field"><span>Сообщений разрешено</span><input type="number" min={2} max={50} value={visibleSettings.spamMaxMessages} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, spamMaxMessages: Number(event.target.value) }))} /></label>
        </div> : null}
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.duplicateEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateEnabled: event.target.checked }))} /><span><strong>Повторяющиеся сообщения</strong><small>Сравнивает нормализованный текст пользователя с его недавними сообщениями в этом чате.</small></span></label>
        {visibleSettings.duplicateEnabled ? <div className="automod-number-grid">
          <label className="automod-field"><span>Окно, секунд</span><input type="number" min={5} max={3600} value={visibleSettings.duplicateWindowSeconds} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateWindowSeconds: Number(event.target.value) }))} /></label>
          <label className="automod-field"><span>Одинаковых разрешено</span><input type="number" min={1} max={20} value={visibleSettings.duplicateMaxMessages} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateMaxMessages: Number(event.target.value) }))} /></label>
        </div> : null}
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.massMentionsEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, massMentionsEnabled: event.target.checked }))} /><span><strong>Массовые упоминания</strong><small>Считает реальные Telegram mention/text_mention entities.</small></span></label>
        {visibleSettings.massMentionsEnabled ? <label className="automod-field automod-field--short"><span>Максимум упоминаний</span><input type="number" min={1} max={50} value={visibleSettings.maxMentions} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, maxMentions: Number(event.target.value) }))} /></label> : null}
      </div>

      <div className="automod-rule">
        <div className="automod-rule-heading"><strong>Запрещённые типы контента</strong><small>Выбранные типы удаляются сразу после получения Telegram update.</small></div>
        <div className="automod-media-grid">{mediaTypes.map(([value, label]) => <label className="automod-media-option" key={value}><input type="checkbox" checked={visibleSettings.blockedMessageTypes.includes(value)} disabled={fieldsDisabled} onChange={(event) => toggleMedia(value, event.target.checked)} /><span>{label}</span></label>)}</div>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.autoEscalationEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, autoEscalationEnabled: event.target.checked }))} /><span><strong>Автоматические наказания</strong><small>Каждое успешно удалённое automod-сообщение добавляет предупреждение. По достижении порогов Modera применяет временный mute, затем ban.</small></span></label>
        {visibleSettings.autoEscalationEnabled ? <>
          <div className="escalation-rule-list">
            {visibleSettings.escalationRules.length === 0 ? <p className="hint-note">Правил нет — предупреждения ни к чему не приводят автоматически. Добавьте хотя бы одно правило.</p> : null}
            {visibleSettings.escalationRules.map((rule, index) => (
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
                  <button type="button" className="icon-button" disabled={fieldsDisabled || index === visibleSettings.escalationRules.length - 1} onClick={() => moveEscalationRule(index, 1)} title="Переместить ниже"><ArrowDown size={15} /></button>
                  <button type="button" className="icon-button icon-button--danger" disabled={fieldsDisabled} onClick={() => removeEscalationRule(index)} title="Удалить правило"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
            <button type="button" className="button button--secondary" disabled={fieldsDisabled} onClick={addEscalationRule}><Plus size={15} />Добавить правило</button>
          </div>
          <label className="automod-field automod-field--short"><span>Срок предупреждений, дней</span><input type="number" min={0} max={3650} value={visibleSettings.warningExpiryDays} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, warningExpiryDays: Number(event.target.value) }))} /></label>
          <small className="hint-note">0 — предупреждения не сгорают, иначе старые перестают учитываться в порогах по истечении срока. Пустой срок = бессрочно (до ручного unmute/unban). Если несколько порогов пройдены за раз, применяется правило с самым высоким порогом.</small>

          <label className="automod-toggle-row automod-toggle-row--compact"><input type="checkbox" checked={visibleSettings.announceEscalationEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, announceEscalationEnabled: event.target.checked }))} /><span><strong>Объявлять в чате</strong><small>Когда automod доводит участника до mute/ban по порогу предупреждений, бот пишет об этом в чат (по умолчанию выключено — automod иначе наказывает молча).</small></span></label>
          {visibleSettings.announceEscalationEnabled ? <>
            <label className="automod-field"><span>Текст при mute</span><textarea rows={2} value={visibleSettings.escalationMuteMessageTemplate} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, escalationMuteMessageTemplate: event.target.value }))} /></label>
            <label className="automod-field"><span>Текст при ban</span><textarea rows={2} value={visibleSettings.escalationBanMessageTemplate} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, escalationBanMessageTemplate: event.target.value }))} /></label>
            <small className="hint-note">Доступны %target%, %duration%, %warns%, %warns_limit%.</small>
          </> : null}
        </> : null}
      </div>

      <label className="automod-toggle-row automod-toggle-row--compact"><input type="checkbox" checked={visibleSettings.ignoreAdmins} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, ignoreAdmins: event.target.checked }))} /><span><strong>Не применять к администраторам Telegram</strong><small>Рекомендуется оставить включённым. Автоматический mute/ban владельца или администратора в любом случае заблокирован сервером.</small></span></label>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? <div className="automod-actions"><button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}><Check size={16} />{saving ? "Сохраняю…" : isGlobalScope ? "Сохранить глобальную политику" : "Сохранить правила"}</button></div> : null}
    </div>
  );
}