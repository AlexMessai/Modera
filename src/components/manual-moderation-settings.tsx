"use client";

import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { SettingsRow } from "@/components/settings-row";

export type ManualModerationSettingsValue = {
  warnMessageTemplate: string;
  warnDeleteTargetMessage: boolean;
  warnEphemeralMessageTemplate: string;
  unwarnMessageTemplate: string;
  unwarnDeleteTargetMessage: boolean;
  muteMessageTemplate: string;
  muteDeleteTargetMessage: boolean;
  muteEphemeralMessageTemplate: string;
  unmuteMessageTemplate: string;
  unmuteDeleteTargetMessage: boolean;
  banMessageTemplate: string;
  banDeleteTargetMessage: boolean;
  banEphemeralMessageTemplate: string;
  unbanMessageTemplate: string;
  unbanDeleteTargetMessage: boolean;
  kickMessageTemplate: string;
  kickDeleteTargetMessage: boolean;
};

// Single source of truth, global only -- see manual-moderation-settings-service.ts.
export type ManualModerationVisibilitySettingsValue = {
  publicPunishmentMessagesEnabled: boolean;
  privatePunishmentMessagesEnabled: boolean;
  proactiveDmNotificationsEnabled: boolean;
};

type Props = {
  chatId: string;
  initial: ManualModerationSettingsValue;
  /** Global-only visibility flags, shown here read-only for context (edited under Система → Уведомления). */
  visibility: ManualModerationVisibilitySettingsValue;
  canEdit: boolean;
  onSaved?: (saved: ManualModerationSettingsValue) => void;
};

type CommandKey = "warn" | "unwarn" | "mute" | "unmute" | "ban" | "unban" | "kick";

type CommandInfo = {
  key: CommandKey;
  command: string;
  label: string;
};

const COMMAND_SECTIONS: Array<{ title: string; commands: CommandInfo[] }> = [
  {
    title: "Предупреждения",
    commands: [
      { key: "warn", command: "/warn", label: "Предупреждение" },
      { key: "unwarn", command: "/unwarn", label: "Снятие предупреждения" }
    ]
  },
  {
    title: "Mute",
    commands: [
      { key: "mute", command: "/mute", label: "Mute" },
      { key: "unmute", command: "/unmute", label: "Снятие mute" }
    ]
  },
  {
    title: "Блокировка",
    commands: [
      { key: "ban", command: "/ban", label: "Блокировка" },
      { key: "unban", command: "/unban", label: "Разблокировка" }
    ]
  },
  {
    title: "Кик",
    commands: [
      { key: "kick", command: "/kick", label: "Кик" }
    ]
  }
];

function deleteTargetKey(key: CommandKey) {
  return `${key}DeleteTargetMessage` as const;
}

export function ManualModerationSettings({
  chatId,
  initial,
  visibility,
  canEdit,
  onSaved
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fieldsDisabled = !canEdit || saving;

  function setField<K extends keyof ManualModerationSettingsValue>(field: K, value: ManualModerationSettingsValue[K]) {
    setSettings((current) => ({ ...current, [field]: value }) as ManualModerationSettingsValue);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/manual-moderation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки ручной модерации.");

      const savedSettings = payload.data as ManualModerationSettingsValue;
      setSettings(savedSettings);
      setSuccess("Настройки этого чата сохранены.");
      onSaved?.(savedSettings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки ручной модерации.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="automod-settings">
      {!canEdit ? (
        <div className="moderation-readonly">
          <ShieldCheck size={18} />
          <div><strong>Только просмотр</strong><p>Изменять настройки чата могут OWNER и ADMIN.</p></div>
        </div>
      ) : null}

      <div className="settings-section">
        <span className="settings-section-title">Видимость (общая для всех чатов)</span>
        <SettingsRow
          title="Публичные сообщения о наказаниях"
          description="Показывать сообщения о действиях модераторов в общем чате. Единая настройка для /warn, /unwarn, /mute, /unmute, /ban, /unban и /kick."
          checked={visibility.publicPunishmentMessagesEnabled}
          disabled
          onChange={() => undefined}
        />
        <SettingsRow
          title="Приватные сообщения о наказаниях"
          description="Личное уведомление наказанному участнику: в чате, видимое только ему, и в личные сообщения. Не зависит от публичных сообщений выше."
          checked={visibility.privatePunishmentMessagesEnabled}
          disabled
          onChange={() => undefined}
        />
        <small className="hint-note">Тексты и видимость этих сообщений редактируются в «Система» → «Уведомления».</small>
      </div>

      <div className="settings-section">
        <span className="settings-section-title">Независимые настройки команд</span>
        <small className="hint-note">Команды выполняются ответом (Reply) на сообщение участника. Сообщение с самой командой (например, «/warn спам») бот удаляет из чата всегда, сразу после обработки — независимо от результата.</small>
        {COMMAND_SECTIONS.map((section) => (
          <div key={section.title}>
            <span className="manual-mod-group-label">{section.title}</span>
            {section.commands.map((commandInfo) => (
              <SettingsRow
                key={commandInfo.key}
                title={<span className="manual-mod-field-label"><code className="manual-mod-command-chip">{commandInfo.command}</code>Удалять сообщение участника — {commandInfo.label}</span>}
                ariaLabel={`Удалять сообщение участника — ${commandInfo.label} (${commandInfo.command})`}
                description="Удалять исходное сообщение при применении наказания."
                checked={settings[deleteTargetKey(commandInfo.key)]}
                disabled={fieldsDisabled}
                onChange={(checked) => setField(deleteTargetKey(commandInfo.key), checked)}
              />
            ))}
          </div>
        ))}
      </div>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? (
        <div className="automod-actions">
          <button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}>
            <Check size={16} />{saving ? "Сохраняю…" : "Сохранить настройки"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
