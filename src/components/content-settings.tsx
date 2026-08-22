"use client";

import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";

export type ContentSettingsValue = {
  welcomeEnabled: boolean;
  welcomeMessageTemplate: string;
  rulesText: string;
};

type Props = {
  chatId: string;
  initial: ContentSettingsValue;
  canEdit: boolean;
  onSaved?: (saved: ContentSettingsValue) => void;
};

export function ContentSettings({
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
      const response = await fetch(`/api/chats/${chatId}/content`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить приветствие и правила.");

      const savedSettings = payload.data as ContentSettingsValue;
      setSettings(savedSettings);
      setSuccess("Текст этого чата сохранён.");
      onSaved?.(savedSettings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить приветствие и правила.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="automod-settings">
      {!canEdit ? (
        <div className="moderation-readonly">
          <ShieldCheck size={18} />
          <div><strong>Только просмотр</strong><p>Изменять текст чата могут OWNER и ADMIN.</p></div>
        </div>
      ) : null}

      <div className="automod-rule">
        <label className="automod-toggle-row">
          <input
            type="checkbox"
            checked={settings.welcomeEnabled}
            disabled={fieldsDisabled}
            onChange={(event) => setSettings((current) => ({ ...current, welcomeEnabled: event.target.checked }))}
          />
          <span><strong>Приветствие новых участников</strong><small>Отправляется в чат сразу после вступления. Текст редактируется в «Система» → «Уведомления».</small></span>
        </label>
      </div>

      <div className="automod-rule">
        <div className="automod-rule-heading"><strong>Правила чата</strong><small>Показываются по команде /rules. Пусто — команда ответит, что правила ещё не заданы.</small></div>
        <label className="automod-field">
          <span>Текст правил</span>
          <textarea
            value={settings.rulesText}
            disabled={fieldsDisabled}
            maxLength={4000}
            placeholder="Например: 1. Уважайте друг друга. 2. Без спама и рекламы. 3. По всем вопросам — к администрации."
            onChange={(event) => setSettings((current) => ({ ...current, rulesText: event.target.value }))}
          />
        </label>
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
