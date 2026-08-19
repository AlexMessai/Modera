"use client";

import { useState } from "react";
import { Check, Globe2, ShieldCheck } from "lucide-react";

export type ManualModerationSettingsValue = {
  warnMessageTemplate: string;
  warnDeleteCommandMessage: boolean;
  warnDeleteTargetMessage: boolean;
  muteMessageTemplate: string;
  muteDeleteCommandMessage: boolean;
  muteDeleteTargetMessage: boolean;
  banMessageTemplate: string;
  banDeleteCommandMessage: boolean;
  banDeleteTargetMessage: boolean;
  unbanMessageTemplate: string;
  unbanDeleteCommandMessage: boolean;
  unbanDeleteTargetMessage: boolean;
};

type Props = {
  chatId?: string;
  initial: ManualModerationSettingsValue;
  canEdit: boolean;
  scope?: "chat" | "global";
  initialUseGlobalProfile?: boolean;
  globalSettings?: ManualModerationSettingsValue;
  onSaved?: (saved: ManualModerationSettingsValue) => void;
};

type CommandKey = "warn" | "mute" | "ban" | "unban";

const COMMANDS: Array<{ key: CommandKey; command: string; title: string; hasDuration: boolean }> = [
  { key: "warn", command: "/warn", title: "Предупреждение", hasDuration: false },
  { key: "mute", command: "/mute", title: "Mute", hasDuration: true },
  { key: "ban", command: "/ban", title: "Блокировка", hasDuration: false },
  { key: "unban", command: "/unban", title: "Снятие блокировки", hasDuration: false }
];

function templateKey(key: CommandKey) {
  return `${key}MessageTemplate` as const;
}
function deleteCommandKey(key: CommandKey) {
  return `${key}DeleteCommandMessage` as const;
}
function deleteTargetKey(key: CommandKey) {
  return `${key}DeleteTargetMessage` as const;
}

export function ManualModerationSettings({
  chatId,
  initial,
  canEdit,
  scope = "chat",
  initialUseGlobalProfile = false,
  globalSettings,
  onSaved
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [useGlobalProfile, setUseGlobalProfile] = useState(initialUseGlobalProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isGlobalScope = scope === "global";
  const inherited = !isGlobalScope && useGlobalProfile && Boolean(globalSettings);
  const visibleSettings = inherited && globalSettings ? globalSettings : settings;
  const fieldsDisabled = !canEdit || saving || inherited;

  function setField<K extends keyof ManualModerationSettingsValue>(field: K, value: ManualModerationSettingsValue[K]) {
    setSettings((current) => ({ ...current, [field]: value }) as ManualModerationSettingsValue);
  }

  async function save() {
    if (!isGlobalScope && !chatId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(isGlobalScope ? "/api/manual-moderation/global" : `/api/chats/${chatId}/manual-moderation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settings, ...(isGlobalScope ? {} : { useGlobalProfile }) })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки ручной модерации.");

      if (isGlobalScope) {
        const savedSettings = payload.data as ManualModerationSettingsValue;
        setSettings(savedSettings);
        setSuccess("Глобальные шаблоны сохранены.");
        onSaved?.(savedSettings);
      } else {
        const saved = payload.data as ManualModerationSettingsValue & { useGlobalProfile: boolean };
        const { useGlobalProfile: savedMode, ...savedSettings } = saved;
        setUseGlobalProfile(savedMode);
        setSettings(savedSettings);
        setSuccess(savedMode ? "Чат переключён на глобальные шаблоны." : "Шаблоны этого чата сохранены.");
        onSaved?.(savedSettings);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки ручной модерации.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="automod-settings">
      {!isGlobalScope ? (
        <div className="automod-rule">
          <label className="automod-toggle-row">
            <input
              type="checkbox"
              checked={useGlobalProfile}
              disabled={!canEdit || saving}
              onChange={(event) => setUseGlobalProfile(event.target.checked)}
            />
            <span><strong>Использовать глобальные шаблоны</strong><small>Настройки этого чата будут автоматически следовать глобальным значениям из раздела «Модерация».</small></span>
          </label>
          {useGlobalProfile ? (
            <div className="moderation-readonly">
              <Globe2 size={18} />
              <div><strong>Глобальное наследование включено</strong><p>Индивидуальные значения сохранены, но пока не применяются. Отключите наследование, чтобы вернуться к ним.</p></div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!canEdit ? (
        <div className="moderation-readonly">
          <ShieldCheck size={18} />
          <div><strong>Только просмотр</strong><p>{isGlobalScope ? "Изменять глобальные шаблоны могут OWNER и ADMIN." : "Изменять настройки чата могут OWNER и ADMIN."}</p></div>
        </div>
      ) : null}

      <small className="row-note">Плейсхолдеры: %admin% — администратор, %target% — участник, %reason% — причина (или пусто), %duration% — срок mute (или пусто). Команды выполняются ответом (Reply) на сообщение участника.</small>

      {COMMANDS.map(({ key, command, title, hasDuration }) => (
        <div className="automod-rule" key={key}>
          <div className="automod-rule-heading"><strong>{title} ({command})</strong></div>
          <label className="automod-field">
            <span>Текст сообщения после применения команды</span>
            <textarea
              rows={2}
              value={visibleSettings[templateKey(key)]}
              disabled={fieldsDisabled}
              onChange={(event) => setField(templateKey(key), event.target.value)}
            />
            <small>{hasDuration ? "Доступны %admin%, %target%, %reason%, %duration%." : "Доступны %admin%, %target%, %reason%."}</small>
          </label>
          <label className="automod-toggle-row">
            <input
              type="checkbox"
              checked={visibleSettings[deleteCommandKey(key)]}
              disabled={fieldsDisabled}
              onChange={(event) => setField(deleteCommandKey(key), event.target.checked)}
            />
            <span>Удалить сообщение с командой {command}</span>
          </label>
          <label className="automod-toggle-row">
            <input
              type="checkbox"
              checked={visibleSettings[deleteTargetKey(key)]}
              disabled={fieldsDisabled}
              onChange={(event) => setField(deleteTargetKey(key), event.target.checked)}
            />
            <span>Удалить сообщение, на которое была отправлена команда {command}</span>
          </label>
        </div>
      ))}

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? (
        <div className="automod-actions">
          <button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}>
            <Check size={16} />{saving ? "Сохраняю…" : isGlobalScope ? "Сохранить глобальные шаблоны" : "Сохранить настройки"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
