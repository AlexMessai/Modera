"use client";

import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";

export type ReportSettingsValue = {
  enabled: boolean;
  muteDurationMinutes: number;
};

type Props = {
  chatId: string;
  initial: ReportSettingsValue;
  canEdit: boolean;
  onSaved?: (saved: ReportSettingsValue) => void;
};

export function ReportSettings({
  chatId,
  initial,
  canEdit,
  onSaved
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fieldsDisabled = !canEdit || saving;

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/reports`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки жалоб.");

      const savedSettings = payload.data as ReportSettingsValue;
      setSettings(savedSettings);
      setSuccess("Настройки жалоб чата сохранены.");
      onSaved?.(savedSettings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки жалоб.");
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

      <div className="automod-rule">
        <label className="automod-toggle-row">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={fieldsDisabled}
            onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span><strong>Команда /report</strong><small>Участники могут пожаловаться на сообщение (ответом на него), администраторы получают приватную карточку с кнопками действий в Telegram.</small></span>
        </label>
        {settings.enabled ? <>
          <div className="automod-number-grid">
            <label className="automod-field"><span>Срок mute по кнопке «Ограничить», минут</span><input type="number" min={1} max={10080} value={settings.muteDurationMinutes} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, muteDurationMinutes: Number(event.target.value) }))} /></label>
          </div>
          <small className="hint-note">Кнопки «Удалить/Предупредить/Ограничить/Забанить/Отклонить» приходят администратору в личные сообщения. Кнопка «Ограничить» всегда использует этот фиксированный срок — для другого срока используйте /mute напрямую.</small>
        </> : null}
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
