"use client";

import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";

export type CaptchaSettingsValue = {
  enabled: boolean;
  challengeMessageTemplate: string;
};

type Props = {
  chatId: string;
  initial: CaptchaSettingsValue;
  canEdit: boolean;
  botCanRestrictMembers?: boolean;
  onSaved?: (saved: CaptchaSettingsValue) => void;
};

export function CaptchaSettings({
  chatId,
  initial,
  canEdit,
  botCanRestrictMembers = true,
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
      const response = await fetch(`/api/chats/${chatId}/captcha`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки капчи.");

      const savedSettings = payload.data as CaptchaSettingsValue;
      setSettings(savedSettings);
      setSuccess("Настройки капчи чата сохранены.");
      onSaved?.(savedSettings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки капчи.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="automod-settings">
      {settings.enabled && !botCanRestrictMembers ? (
        <div className="moderation-notice"><ShieldCheck size={16} /><span>Капча включена, но у бота нет права ограничивать участников — ограничение при вступлении будет завершаться ошибкой до выдачи права.</span></div>
      ) : null}
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
          <span><strong>Капча при вступлении</strong><small>Новый участник супергруппы ограничивается в правах сразу и не может писать в чат, пока не нажмёт кнопку «Я не бот» под сообщением бота.</small></span>
        </label>
        <label className="automod-field">
          <span>Текст сообщения с капчой</span>
          <textarea
            rows={3}
            value={settings.challengeMessageTemplate}
            disabled={fieldsDisabled}
            onChange={(event) => setSettings((current) => ({ ...current, challengeMessageTemplate: event.target.value }))}
          />
          <small>Видит только сам новый участник (ephemeral) — не весь чат. Без плейсхолдеров, текст статичный.</small>
        </label>
        <small className="hint-note">Кто не пройдёт проверку — будет исключён (не заблокирован, сможет зайти снова) при следующей ежедневной проверке; это может занять до суток.</small>
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
