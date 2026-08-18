"use client";

import { useState } from "react";
import { Check, ShieldCheck, TriangleAlert } from "lucide-react";

const mediaTypes = [
  ["PHOTO", "Фото"],
  ["VIDEO", "Видео"],
  ["ANIMATION", "GIF / анимации"],
  ["DOCUMENT", "Файлы"],
  ["STICKER", "Стикеры"],
  ["VOICE", "Голосовые"],
  ["AUDIO", "Аудио"],
  ["VIDEO_NOTE", "Видеосообщения"],
  ["POLL", "Опросы"],
  ["DICE", "Игровые кубики"],
  ["LOCATION", "Геолокация"],
  ["CONTACT", "Контакты"]
] as const;

type Settings = {
  blockLinks: boolean;
  allowedDomains: string[];
  spamEnabled: boolean;
  spamWindowSeconds: number;
  spamMaxMessages: number;
  blockedTermsEnabled: boolean;
  blockedTerms: string[];
  massMentionsEnabled: boolean;
  maxMentions: number;
  duplicateEnabled: boolean;
  duplicateWindowSeconds: number;
  duplicateMaxMessages: number;
  blockedMessageTypes: string[];
  ignoreAdmins: boolean;
};

type Props = {
  chatId: string;
  initial: Settings;
  canEdit: boolean;
  botCanDeleteMessages: boolean;
};

function splitList(value: string) {
  return value
    .split(/\r?\n/)
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
  const [terms, setTerms] = useState(initial.blockedTerms.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const anyRuleEnabled =
    settings.blockLinks ||
    settings.spamEnabled ||
    settings.blockedTermsEnabled ||
    settings.massMentionsEnabled ||
    settings.duplicateEnabled ||
    settings.blockedMessageTypes.length > 0;

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
          allowedDomains: splitList(domains),
          blockedTerms: splitList(terms)
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки.");
      }

      const saved = payload.data as Settings;
      setSettings(saved);
      setDomains(saved.allowedDomains.join("\n"));
      setTerms(saved.blockedTerms.join("\n"));
      setSuccess("Настройки сохранены и применяются к новым Telegram-событиям.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки.");
    } finally {
      setSaving(false);
    }
  }

  function toggleMedia(type: string, checked: boolean) {
    setSettings((current) => ({
      ...current,
      blockedMessageTypes: checked
        ? Array.from(new Set([...current.blockedMessageTypes, type]))
        : current.blockedMessageTypes.filter((item) => item !== type)
    }));
  }

  return (
    <div className="automod-settings">
      {!botCanDeleteMessages && anyRuleEnabled ? (
        <div className="moderation-notice">
          <TriangleAlert size={16} />
          <span>
            По последней проверке у бота нет права удаления сообщений. Правила можно сохранить, но Telegram будет отклонять удаления до выдачи права.
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
          <input type="checkbox" checked={settings.blockLinks} disabled={!canEdit || saving} onChange={(event) => setSettings((current) => ({ ...current, blockLinks: event.target.checked }))} />
          <span><strong>Запрещённые ссылки</strong><small>Удаляет ссылки, которых нет в allowlist доменов.</small></span>
        </label>
        <label className="automod-field">
          <span>Разрешённые домены</span>
          <textarea rows={4} value={domains} disabled={!canEdit || saving || !settings.blockLinks} onChange={(event) => setDomains(event.target.value)} placeholder={"example.com\nsubdomain.ru"} />
          <small>По одному домену на строку. Поддомены разрешённого домена тоже пропускаются.</small>
        </label>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row">
          <input type="checkbox" checked={settings.blockedTermsEnabled} disabled={!canEdit || saving} onChange={(event) => setSettings((current) => ({ ...current, blockedTermsEnabled: event.target.checked }))} />
          <span><strong>Запрещённые слова и фразы</strong><small>Проверяет текст сообщения и подпись к медиа без учёта регистра.</small></span>
        </label>
        <label className="automod-field">
          <span>Список выражений</span>
          <textarea rows={5} value={terms} disabled={!canEdit || saving || !settings.blockedTermsEnabled} onChange={(event) => setTerms(event.target.value)} placeholder={"рекламная фраза\nзапрещенное слово"} />
          <small>Одно слово или фраза на строку. До 200 выражений.</small>
        </label>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row">
          <input type="checkbox" checked={settings.spamEnabled} disabled={!canEdit || saving} onChange={(event) => setSettings((current) => ({ ...current, spamEnabled: event.target.checked }))} />
          <span><strong>Антифлуд</strong><small>Удаляет текущее сообщение при превышении лимита сообщений за окно времени.</small></span>
        </label>
        <div className="automod-number-grid">
          <label className="automod-field"><span>Окно, секунд</span><input type="number" min={3} max={120} value={settings.spamWindowSeconds} disabled={!canEdit || saving || !settings.spamEnabled} onChange={(event) => setSettings((current) => ({ ...current, spamWindowSeconds: Number(event.target.value) }))} /></label>
          <label className="automod-field"><span>Сообщений разрешено</span><input type="number" min={2} max={50} value={settings.spamMaxMessages} disabled={!canEdit || saving || !settings.spamEnabled} onChange={(event) => setSettings((current) => ({ ...current, spamMaxMessages: Number(event.target.value) }))} /></label>
        </div>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row">
          <input type="checkbox" checked={settings.duplicateEnabled} disabled={!canEdit || saving} onChange={(event) => setSettings((current) => ({ ...current, duplicateEnabled: event.target.checked }))} />
          <span><strong>Повторяющиеся сообщения</strong><small>Сравнивает нормализованный текст пользователя с его недавними сообщениями в этом чате.</small></span>
        </label>
        <div className="automod-number-grid">
          <label className="automod-field"><span>Окно, секунд</span><input type="number" min={5} max={3600} value={settings.duplicateWindowSeconds} disabled={!canEdit || saving || !settings.duplicateEnabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateWindowSeconds: Number(event.target.value) }))} /></label>
          <label className="automod-field"><span>Одинаковых разрешено</span><input type="number" min={1} max={20} value={settings.duplicateMaxMessages} disabled={!canEdit || saving || !settings.duplicateEnabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateMaxMessages: Number(event.target.value) }))} /></label>
        </div>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row">
          <input type="checkbox" checked={settings.massMentionsEnabled} disabled={!canEdit || saving} onChange={(event) => setSettings((current) => ({ ...current, massMentionsEnabled: event.target.checked }))} />
          <span><strong>Массовые упоминания</strong><small>Считает реальные Telegram mention/text_mention entities.</small></span>
        </label>
        <label className="automod-field automod-field--short"><span>Максимум упоминаний</span><input type="number" min={1} max={50} value={settings.maxMentions} disabled={!canEdit || saving || !settings.massMentionsEnabled} onChange={(event) => setSettings((current) => ({ ...current, maxMentions: Number(event.target.value) }))} /></label>
      </div>

      <div className="automod-rule">
        <div className="automod-rule-heading"><strong>Запрещённые типы контента</strong><small>Выбранные типы удаляются сразу после получения Telegram update.</small></div>
        <div className="automod-media-grid">
          {mediaTypes.map(([value, label]) => (
            <label className="automod-media-option" key={value}>
              <input type="checkbox" checked={settings.blockedMessageTypes.includes(value)} disabled={!canEdit || saving} onChange={(event) => toggleMedia(value, event.target.checked)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      <label className="automod-toggle-row automod-toggle-row--compact">
        <input type="checkbox" checked={settings.ignoreAdmins} disabled={!canEdit || saving} onChange={(event) => setSettings((current) => ({ ...current, ignoreAdmins: event.target.checked }))} />
        <span><strong>Не применять к администраторам Telegram</strong><small>Рекомендуется оставить включённым, чтобы правила не удаляли сообщения владельца и администраторов.</small></span>
      </label>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}

      {canEdit ? (
        <div className="automod-actions">
          <button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}>
            <Check size={16} />{saving ? "Сохраняю…" : "Сохранить правила"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
