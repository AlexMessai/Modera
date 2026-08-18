"use client";

import { useState } from "react";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";

type Settings = {
  blockLinks: boolean;
  allowedDomains: string[];
  spamEnabled: boolean;
  spamWindowSeconds: number;
  spamMaxMessages: number;
  ignoreAdmins: boolean;
};

type Props = {
  chatId: string;
  initial: Settings;
  canEdit: boolean;
  botCanDeleteMessages: boolean;
};

function splitDomains(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ChatModerationSettings({
  chatId,
  initial,
  canEdit,
  botCanDeleteMessages
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [domains, setDomains] = useState(initial.allowedDomains.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/chats/${chatId}/moderation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...settings,
          allowedDomains: splitDomains(domains)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки.");
      }

      const saved = payload.data as Settings;
      setSettings(saved);
      setDomains(saved.allowedDomains.join("\n"));
      setSuccess("Настройки сохранены и применяются к новым Telegram-событиям.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="automod-settings">
      {!botCanDeleteMessages && (settings.blockLinks || settings.spamEnabled) ? (
        <div className="moderation-notice">
          <TriangleAlert size={16} />
          <span>
            По последней проверке у бота нет права удаления сообщений. Правила можно сохранить, но Telegram может отклонять удаления до выдачи права.
          </span>
        </div>
      ) : null}

      {!canEdit ? (
        <div className="moderation-readonly">
          <ShieldCheck size={18} />
          <div>
            <strong>Только просмотр</strong>
            <p>Изменять правила чата могут OWNER и ADMIN.</p>
          </div>
        </div>
      ) : null}

      <div className="automod-rule">
        <label className="automod-toggle-row">
          <input
            type="checkbox"
            checked={settings.blockLinks}
            disabled={!canEdit || saving}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                blockLinks: event.target.checked
              }))
            }
          />
          <span>
            <strong>Удалять запрещённые ссылки</strong>
            <small>Ссылки из Telegram entities и обычного текста проверяются до удаления.</small>
          </span>
        </label>

        <label className="automod-field">
          <span>Разрешённые домены</span>
          <textarea
            rows={5}
            value={domains}
            disabled={!canEdit || saving || !settings.blockLinks}
            onChange={(event) => setDomains(event.target.value)}
            placeholder={"example.com\nsubdomain.ru"}
          />
          <small>По одному домену на строку. Поддомены разрешённого домена тоже пропускаются.</small>
        </label>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row">
          <input
            type="checkbox"
            checked={settings.spamEnabled}
            disabled={!canEdit || saving}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                spamEnabled: event.target.checked
              }))
            }
          />
          <span>
            <strong>Антифлуд</strong>
            <small>Удаляет текущее сообщение, когда пользователь превышает заданный лимит.</small>
          </span>
        </label>

        <div className="automod-number-grid">
          <label className="automod-field">
            <span>Окно, секунд</span>
            <input
              type="number"
              min={3}
              max={120}
              value={settings.spamWindowSeconds}
              disabled={!canEdit || saving || !settings.spamEnabled}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  spamWindowSeconds: Number(event.target.value)
                }))
              }
            />
          </label>
          <label className="automod-field">
            <span>Сообщений разрешено</span>
            <input
              type="number"
              min={2}
              max={50}
              value={settings.spamMaxMessages}
              disabled={!canEdit || saving || !settings.spamEnabled}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  spamMaxMessages: Number(event.target.value)
                }))
              }
            />
          </label>
        </div>
      </div>

      <label className="automod-toggle-row automod-toggle-row--compact">
        <input
          type="checkbox"
          checked={settings.ignoreAdmins}
          disabled={!canEdit || saving}
          onChange={(event) =>
            setSettings((current) => ({
              ...current,
              ignoreAdmins: event.target.checked
            }))
          }
        />
        <span>
          <strong>Не применять к администраторам Telegram</strong>
          <small>Рекомендуется оставить включённым, чтобы автомодерация не удаляла сообщения владельца и администраторов.</small>
        </span>
      </label>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}

      {canEdit ? (
        <div className="automod-actions">
          <button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}>
            <Check size={16} />
            {saving ? "Сохраняю…" : "Сохранить правила"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
