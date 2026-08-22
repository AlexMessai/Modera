"use client";

import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";

export type AntiRaidSettingsValue = {
  enabled: boolean;
  joinThreshold: number;
  windowSeconds: number;
  cooldownMinutes: number;
  forceCaptcha: boolean;
};

type Props = {
  chatId: string;
  initial: AntiRaidSettingsValue;
  canEdit: boolean;
  onSaved?: (saved: AntiRaidSettingsValue) => void;
};

export function AntiRaidSettings({
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
      const response = await fetch(`/api/chats/${chatId}/anti-raid`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки Anti-Raid.");

      const savedSettings = payload.data as AntiRaidSettingsValue;
      setSettings(savedSettings);
      setSuccess("Настройки Anti-Raid чата сохранены.");
      onSaved?.(savedSettings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки Anti-Raid.");
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
          <span><strong>Защита от массового вступления</strong><small>Если за короткое время в чат вступает подозрительно много участников, бот усиливает защиту, пока наплыв не прекратится.</small></span>
        </label>
        {settings.enabled ? <>
          <div className="automod-number-grid">
            <label className="automod-field"><span>Порог, участников</span><input type="number" min={3} max={500} value={settings.joinThreshold} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, joinThreshold: Number(event.target.value) }))} /></label>
            <label className="automod-field"><span>Окно, секунд</span><input type="number" min={5} max={600} value={settings.windowSeconds} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, windowSeconds: Number(event.target.value) }))} /></label>
            <label className="automod-field"><span>Затишье до снятия, минут</span><input type="number" min={1} max={1440} value={settings.cooldownMinutes} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, cooldownMinutes: Number(event.target.value) }))} /></label>
          </div>
          <small className="hint-note">Пример: порог 30 и окно 20 секунд — рейд считается начавшимся, если 30 участников вступили за 20 секунд. Снимается ежедневной проверкой после указанного затишья — может занять до суток (как и таймаут капчи).</small>

          <label className="automod-toggle-row automod-toggle-row--compact">
            <input
              type="checkbox"
              checked={settings.forceCaptcha}
              disabled={fieldsDisabled}
              onChange={(event) => setSettings((current) => ({ ...current, forceCaptcha: event.target.checked }))}
            />
            <span><strong>Принудительная капча во время рейда</strong><small>Каждый новый участник проходит проверку «Я не бот», даже если капча в чате обычно выключена.</small></span>
          </label>
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
