"use client";

import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { SettingsRow, ConditionalSettingsSection } from "@/components/settings-row";

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
type EphemeralCommandKey = "warn" | "mute" | "ban";

type CommandInfo = {
  key: CommandKey;
  command: string;
  /** Plain-language label used in the aggregated template/independent-setting lists (e.g. "Предупреждение"), as opposed to the raw /command chip. */
  label: string;
  description: string;
  hasReason: boolean;
  /** Badge text when this command's %duration% placeholder is meaningful; omitted when it isn't. */
  durationLabel?: string;
  hasWarnCount: boolean;
};

function isEphemeralCommand(key: CommandKey): key is EphemeralCommandKey {
  return key === "warn" || key === "mute" || key === "ban";
}

const COMMAND_SECTIONS: Array<{ title: string; commands: CommandInfo[] }> = [
  {
    title: "Предупреждения",
    commands: [
      { key: "warn", command: "/warn", label: "Предупреждение", description: "Выдаёт предупреждение участнику. Учитывается в общем счётчике вместе с автомодерацией.", hasReason: true, hasWarnCount: true },
      { key: "unwarn", command: "/unwarn", label: "Снятие предупреждения", description: "Снимает одно предупреждение с участника.", hasReason: false, hasWarnCount: true }
    ]
  },
  {
    title: "Mute",
    commands: [
      { key: "mute", command: "/mute", label: "Mute", description: "Запрещает участнику писать сообщения на указанный срок.", hasReason: true, durationLabel: "Срок mute", hasWarnCount: false },
      { key: "unmute", command: "/unmute", label: "Снятие mute", description: "Досрочно снимает mute с участника.", hasReason: false, hasWarnCount: false }
    ]
  },
  {
    title: "Блокировка",
    commands: [
      { key: "ban", command: "/ban", label: "Блокировка", description: "Блокирует участника в чате. Можно указать срок (например, 7d) — иначе блокировка постоянная.", hasReason: true, durationLabel: "Срок блокировки", hasWarnCount: false },
      { key: "unban", command: "/unban", label: "Разблокировка", description: "Снимает блокировку — участник сможет вернуться в чат.", hasReason: false, hasWarnCount: false }
    ]
  },
  {
    title: "Кик",
    commands: [
      { key: "kick", command: "/kick", label: "Кик", description: "Удаляет участника из чата без блокировки — он сможет вернуться по ссылке-приглашению. Личное уведомление недоступно: участник уже покидает чат в момент действия.", hasReason: true, hasWarnCount: false }
    ]
  }
];

function placeholderHint(command: { hasReason: boolean; durationLabel?: string; hasWarnCount: boolean }) {
  const list = ["%admin%", "%target%"];
  if (command.hasReason) list.push("%reason%");
  if (command.durationLabel) list.push("%duration%");
  if (command.hasWarnCount) list.push("%warns%", "%warns_limit%");
  return `Доступны ${list.join(", ")}.`;
}

function templateKey(key: CommandKey) {
  return `${key}MessageTemplate` as const;
}
function deleteTargetKey(key: CommandKey) {
  return `${key}DeleteTargetMessage` as const;
}
function ephemeralTemplateKey(key: EphemeralCommandKey) {
  return `${key}EphemeralMessageTemplate` as const;
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
      setSuccess("Шаблоны этого чата сохранены.");
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
        <SettingsRow
          title="Публичные сообщения о наказаниях"
          description="Показывать сообщения о действиях модераторов в общем чате. Единая настройка для /warn, /unwarn, /mute, /unmute, /ban, /unban и /kick."
          checked={visibility.publicPunishmentMessagesEnabled}
          disabled
          onChange={() => undefined}
        />
        <small className="hint-note">Управляется глобально, в разделе «Система» → «Уведомления».</small>
        <ConditionalSettingsSection visible={visibility.publicPunishmentMessagesEnabled}>
          <span className="settings-section-title">Шаблоны публичных сообщений</span>
          {COMMAND_SECTIONS.map((section) => (
            <div key={section.title}>
              <span className="manual-mod-group-label">{section.title}</span>
              {section.commands.map((commandInfo) => (
                <label className="automod-field" key={commandInfo.key}>
                  <span className="manual-mod-field-label"><code className="manual-mod-command-chip">{commandInfo.command}</code>{commandInfo.label}</span>
                  <textarea
                    rows={2}
                    value={settings[templateKey(commandInfo.key)]}
                    disabled={fieldsDisabled}
                    onChange={(event) => setField(templateKey(commandInfo.key), event.target.value)}
                  />
                  <small>{placeholderHint(commandInfo)}</small>
                </label>
              ))}
            </div>
          ))}
        </ConditionalSettingsSection>
      </div>

      <div className="settings-section">
        <SettingsRow
          title="Приватные сообщения о наказаниях"
          description="Личное уведомление наказанному участнику: в чате, видимое только ему, и в личные сообщения. Не зависит от публичных сообщений выше."
          checked={visibility.privatePunishmentMessagesEnabled}
          disabled
          onChange={() => undefined}
        />
        <small className="hint-note">Управляется глобально, в разделе «Система» → «Уведомления».</small>
        <ConditionalSettingsSection visible={visibility.privatePunishmentMessagesEnabled}>
          <span className="settings-section-title">Шаблоны приватных сообщений</span>
          {COMMAND_SECTIONS.flatMap((section) => section.commands)
            .filter((commandInfo): commandInfo is CommandInfo & { key: EphemeralCommandKey } => isEphemeralCommand(commandInfo.key))
            .map((commandInfo) => (
              <label className="automod-field" key={commandInfo.key}>
                <span>{commandInfo.label} ({commandInfo.command})</span>
                <textarea
                  rows={2}
                  value={settings[ephemeralTemplateKey(commandInfo.key)]}
                  disabled={fieldsDisabled}
                  onChange={(event) => setField(ephemeralTemplateKey(commandInfo.key), event.target.value)}
                />
                <small>Видит только сам наказанный участник. Доступны %chat%, %reason%, %contact% (ссылка на ЛС бота).</small>
              </label>
            ))}
        </ConditionalSettingsSection>
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
