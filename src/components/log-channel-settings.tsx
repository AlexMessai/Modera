"use client";

import { useState } from "react";
import { Check, ShieldCheck, Trash2 } from "lucide-react";

export type LogChannelSettingsValue = {
  enabled: boolean;
  logChannelTelegramId: string | null;
  logChannelTitle: string | null;
};

type Props = {
  chatId: string;
  initial: LogChannelSettingsValue;
  canEdit: boolean;
};

export function LogChannelSettings({ chatId, initial, canEdit }: Props) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function toggle() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/log-channel`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !settings.enabled })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось изменить настройки канала логов.");
      setSettings(payload.data as LogChannelSettingsValue);
      setSuccess("Настройки канала логов сохранены.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить настройки канала логов.");
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/log-channel`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось отключить канал логов.");
      setSettings(payload.data as LogChannelSettingsValue);
      setSuccess("Канал логов отключён.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось отключить канал логов.");
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

      {settings.logChannelTelegramId ? (
        <div className="automod-rule">
          <label className="automod-toggle-row">
            <input type="checkbox" checked={settings.enabled} disabled={!canEdit || saving} onChange={() => void toggle()} />
            <span><strong>Пересылка событий</strong><small>Канал: {settings.logChannelTitle ?? settings.logChannelTelegramId}. Пересылаются mute/ban/kick/warn и их отмена.</small></span>
          </label>
          {canEdit ? (
            <div className="automod-actions">
              <button className="button button--danger" type="button" onClick={() => void unlink()} disabled={saving}>
                <Trash2 size={16} />Отключить канал
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="moderation-readonly">
          <ShieldCheck size={18} />
          <div><strong>Канал не подключён</strong><p>Подключается в Telegram: /settings → Логи → «Подключить канал», затем перешлите боту в личные сообщения любой пост из нужного канала.</p></div>
        </div>
      )}

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
    </div>
  );
}
