"use client";

import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";
import { SettingsRow } from "@/components/settings-row";

export type ChatAppealSettingsValue = {
  enabled: boolean;
  notifyAdminsOnSubmit: boolean;
  notifyUserOnDecision: boolean;
};

type Props = {
  chatId: string;
  initial: ChatAppealSettingsValue;
  canEdit: boolean;
  onSaved?: (saved: ChatAppealSettingsValue) => void;
};

export function ChatAppealSettings({ chatId, initial, canEdit, onSaved }: Props) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fieldsDisabled = !canEdit || saving;

  function setField(field: keyof ChatAppealSettingsValue, value: boolean) {
    setSettings((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/appeal-settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки апелляций.");

      const savedSettings = payload.data as ChatAppealSettingsValue;
      setSettings(savedSettings);
      setSuccess("Настройки апелляций чата сохранены.");
      onSaved?.(savedSettings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки апелляций.");
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
          title="Апелляции включены"
          description="Участник может подать /appeal боту в личные сообщения на своё последнее предупреждение, mute или бан в этом чате."
          checked={settings.enabled}
          disabled={fieldsDisabled}
          onChange={(checked) => setField("enabled", checked)}
        />
        <SettingsRow
          title="Уведомлять админов о новой апелляции"
          description="Личное сообщение в Telegram каждому администратору с кнопками «Одобрить» / «Отклонить»."
          checked={settings.notifyAdminsOnSubmit}
          disabled={fieldsDisabled}
          onChange={(checked) => setField("notifyAdminsOnSubmit", checked)}
        />
        <SettingsRow
          title="Уведомлять участника о решении"
          description="Личное сообщение автору апелляции, когда её одобрили или отклонили."
          checked={settings.notifyUserOnDecision}
          disabled={fieldsDisabled}
          onChange={(checked) => setField("notifyUserOnDecision", checked)}
        />
        <small className="hint-note">Тексты этих сообщений редактируются в «Система» → «Уведомления».</small>
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
