"use client";

import { useState } from "react";
import { Check, Globe2, ShieldCheck } from "lucide-react";

export type ManualModerationSettingsValue = {
  warnMessageTemplate: string;
  warnDeleteTargetMessage: boolean;
  warnAnnounceInChat: boolean;
  warnEphemeralMessageTemplate: string;
  unwarnMessageTemplate: string;
  unwarnDeleteTargetMessage: boolean;
  unwarnAnnounceInChat: boolean;
  muteMessageTemplate: string;
  muteDeleteTargetMessage: boolean;
  muteAnnounceInChat: boolean;
  muteEphemeralMessageTemplate: string;
  unmuteMessageTemplate: string;
  unmuteDeleteTargetMessage: boolean;
  unmuteAnnounceInChat: boolean;
  banMessageTemplate: string;
  banDeleteTargetMessage: boolean;
  banAnnounceInChat: boolean;
  banEphemeralMessageTemplate: string;
  unbanMessageTemplate: string;
  unbanDeleteTargetMessage: boolean;
  unbanAnnounceInChat: boolean;
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

type CommandKey = "warn" | "unwarn" | "mute" | "unmute" | "ban" | "unban";
type EphemeralCommandKey = "warn" | "mute" | "ban";

type CommandInfo = {
  key: CommandKey;
  command: string;
  description: string;
  hasReason: boolean;
  hasDuration: boolean;
  hasWarnCount: boolean;
};

function isEphemeralCommand(key: CommandKey): key is EphemeralCommandKey {
  return key === "warn" || key === "mute" || key === "ban";
}

const COMMAND_SECTIONS: Array<{ title: string; commands: CommandInfo[] }> = [
  {
    title: "Предупреждения",
    commands: [
      { key: "warn", command: "/warn", description: "Выдаёт предупреждение участнику. Учитывается в общем счётчике вместе с автомодерацией.", hasReason: true, hasDuration: false, hasWarnCount: true },
      { key: "unwarn", command: "/unwarn", description: "Снимает одно предупреждение с участника.", hasReason: false, hasDuration: false, hasWarnCount: true }
    ]
  },
  {
    title: "Mute",
    commands: [
      { key: "mute", command: "/mute", description: "Запрещает участнику писать сообщения на указанный срок.", hasReason: true, hasDuration: true, hasWarnCount: false },
      { key: "unmute", command: "/unmute", description: "Досрочно снимает mute с участника.", hasReason: false, hasDuration: false, hasWarnCount: false }
    ]
  },
  {
    title: "Блокировка",
    commands: [
      { key: "ban", command: "/ban", description: "Блокирует участника в чате.", hasReason: true, hasDuration: false, hasWarnCount: false },
      { key: "unban", command: "/unban", description: "Снимает блокировку — участник сможет вернуться в чат.", hasReason: false, hasDuration: false, hasWarnCount: false }
    ]
  }
];

function placeholderHint(command: { hasReason: boolean; hasDuration: boolean; hasWarnCount: boolean }) {
  const list = ["%admin%", "%target%"];
  if (command.hasReason) list.push("%reason%");
  if (command.hasDuration) list.push("%duration%");
  if (command.hasWarnCount) list.push("%warns%", "%warns_limit%");
  return `Доступны ${list.join(", ")}.`;
}

function templateKey(key: CommandKey) {
  return `${key}MessageTemplate` as const;
}
function deleteTargetKey(key: CommandKey) {
  return `${key}DeleteTargetMessage` as const;
}
function announceInChatKey(key: CommandKey) {
  return `${key}AnnounceInChat` as const;
}
function ephemeralTemplateKey(key: EphemeralCommandKey) {
  return `${key}EphemeralMessageTemplate` as const;
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

      <small className="row-note">Команды выполняются ответом (Reply) на сообщение участника. Сообщение с самой командой (например, «/warn спам») бот удаляет из чата всегда, сразу после обработки — независимо от результата. %admin% — администратор, %target% — участник, %reason% — причина, %duration% — срок mute, %warns% / %warns_limit% — текущее число предупреждений и порог, после которого выдаётся mute (пустые плейсхолдеры заменяются на пустую строку).</small>

      {COMMAND_SECTIONS.map((section) => (
        <div className="manual-mod-section" key={section.title}>
          <h3 className="manual-mod-section-title">{section.title}</h3>
          <div className="manual-mod-command-list">
            {section.commands.map((commandInfo) => {
              const { key, command, description } = commandInfo;
              return (
                <article className="manual-mod-card" key={key}>
                  <div className="manual-mod-card-header">
                    <code className="manual-mod-command-chip">{command}</code>
                    <div className="manual-mod-tags">
                      <span className="badge">Ответ на сообщение</span>
                      {commandInfo.hasReason ? <span className="badge">Причина</span> : null}
                      {commandInfo.hasDuration ? <span className="badge">Срок mute</span> : null}
                      {commandInfo.hasWarnCount ? <span className="badge">Счётчик варнов</span> : null}
                    </div>
                  </div>
                  <p className="manual-mod-card-description">{description}</p>

                  <label className="automod-field">
                    <span>Текст ответа бота</span>
                    <textarea
                      rows={2}
                      value={visibleSettings[templateKey(key)]}
                      disabled={fieldsDisabled}
                      onChange={(event) => setField(templateKey(key), event.target.value)}
                    />
                    <small>{placeholderHint(commandInfo)}</small>
                  </label>

                  {isEphemeralCommand(key) ? (
                    <label className="automod-field">
                      <span>Личное уведомление участнику (ephemeral)</span>
                      <textarea
                        rows={2}
                        value={visibleSettings[ephemeralTemplateKey(key)]}
                        disabled={fieldsDisabled}
                        onChange={(event) => setField(ephemeralTemplateKey(key), event.target.value)}
                      />
                      <small>Видит только сам наказанный участник, прямо в чате. Доступны %chat%, %reason%, %contact% (ссылка на ЛС бота).</small>
                    </label>
                  ) : null}

                  <div className="manual-mod-toggle-grid">
                    <label className="automod-toggle-row automod-toggle-row--compact">
                      <input
                        type="checkbox"
                        checked={visibleSettings[deleteTargetKey(key)]}
                        disabled={fieldsDisabled}
                        onChange={(event) => setField(deleteTargetKey(key), event.target.checked)}
                      />
                      <span>Удалить сообщение участника</span>
                    </label>
                    <label className="automod-toggle-row automod-toggle-row--compact">
                      <input
                        type="checkbox"
                        checked={visibleSettings[announceInChatKey(key)]}
                        disabled={fieldsDisabled}
                        onChange={(event) => setField(announceInChatKey(key), event.target.checked)}
                      />
                      <span>Показывать в чате</span>
                    </label>
                  </div>
                </article>
              );
            })}
          </div>
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
