"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { SettingsRow } from "@/components/settings-row";

export type ManualModerationVisibilitySettingsValue = {
  publicPunishmentMessagesEnabled: boolean;
  privatePunishmentMessagesEnabled: boolean;
  proactiveDmNotificationsEnabled: boolean;
};

type Props = {
  initial: ManualModerationVisibilitySettingsValue;
  canEdit: boolean;
};

export function ManualModerationVisibilitySettings({ initial, canEdit }: Props) {
  const [visibility, setVisibility] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fieldsDisabled = !canEdit || saving;

  function setField(field: keyof ManualModerationVisibilitySettingsValue, value: boolean) {
    setVisibility((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/manual-moderation/global", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(visibility)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки видимости.");

      const saved = payload.data as ManualModerationVisibilitySettingsValue;
      setVisibility(saved);
      setSuccess("Настройки видимости сохранены.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки видимости.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel automod-settings">
      <div className="panel-header">
        <div>
          <h2>Уведомления о наказаниях</h2>
          <p>Общие переключатели для всех чатов — управляют тем, видят ли наказанный участник и чат сообщения о /warn /mute /ban и т.п.</p>
        </div>
      </div>

      <div className="settings-section">
        <SettingsRow
          title="Публичные сообщения о наказаниях"
          description="Показывать сообщения о действиях модераторов в общем чате."
          checked={visibility.publicPunishmentMessagesEnabled}
          disabled={fieldsDisabled}
          onChange={(checked) => setField("publicPunishmentMessagesEnabled", checked)}
        />
        <SettingsRow
          title="Приватные сообщения о наказаниях"
          description="Личное уведомление наказанному участнику: в чате, видимое только ему, и в личные сообщения."
          checked={visibility.privatePunishmentMessagesEnabled}
          disabled={fieldsDisabled}
          onChange={(checked) => setField("privatePunishmentMessagesEnabled", checked)}
        />
        <SettingsRow
          title="Проактивные DM-уведомления"
          description="Сообщения, которые бот сам присылает в личные сообщения без прямой команды пользователя в этот момент — например, решение по апелляции."
          checked={visibility.proactiveDmNotificationsEnabled}
          disabled={fieldsDisabled}
          onChange={(checked) => setField("proactiveDmNotificationsEnabled", checked)}
        />
      </div>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? (
        <div className="automod-actions">
          <button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}>
            <Check size={16} />{saving ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
