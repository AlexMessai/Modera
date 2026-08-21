"use client";

import { useState } from "react";
import { Check, Globe2, ShieldCheck } from "lucide-react";

export type ReportSettingsValue = {
  enabled: boolean;
  muteDurationMinutes: number;
};

type Props = {
  chatId?: string;
  initial: ReportSettingsValue;
  canEdit: boolean;
  scope?: "chat" | "global";
  initialUseGlobalProfile?: boolean;
  globalSettings?: ReportSettingsValue;
  onSaved?: (saved: ReportSettingsValue) => void;
};

export function ReportSettings({
  chatId,
  initial,
  canEdit,
  scope = "chat",
  initialUseGlobalProfile = false,
  globalSettings,
  onSaved
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [useGlobalProfile, setUseGlobalProfile] = useState(initialUseGlobalProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isGlobalScope = scope === "global";
  const inherited = !isGlobalScope && useGlobalProfile && Boolean(globalSettings);
  const visibleSettings = inherited && globalSettings ? globalSettings : settings;
  const fieldsDisabled = !canEdit || saving || inherited;

  async function save() {
    if (!isGlobalScope && !chatId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(isGlobalScope ? "/api/reports/global" : `/api/chats/${chatId}/reports`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settings, ...(isGlobalScope ? {} : { useGlobalProfile }) })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки жалоб.");

      if (isGlobalScope) {
        const savedSettings = payload.data as ReportSettingsValue;
        setSettings(savedSettings);
        setSuccess("Глобальная политика жалоб сохранена.");
        onSaved?.(savedSettings);
      } else {
        const saved = payload.data as ReportSettingsValue & { useGlobalProfile: boolean };
        const { useGlobalProfile: savedMode, ...savedSettings } = saved;
        setUseGlobalProfile(savedMode);
        setSettings(savedSettings);
        setSuccess(savedMode ? "Чат переключён на глобальную политику жалоб." : "Настройки жалоб чата сохранены.");
        onSaved?.(savedSettings);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки жалоб.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="automod-settings">
      {!isGlobalScope ? (
        <div className="automod-rule">
          <label className="automod-toggle-row">
            <input
              type="checkbox"
              checked={useGlobalProfile}
              disabled={!canEdit || saving}
              onChange={(event) => setUseGlobalProfile(event.target.checked)}
            />
            <span><strong>Использовать глобальную политику жалоб</strong><small>Настройки этого чата будут автоматически следовать глобальным значениям из раздела «Модерация».</small></span>
          </label>
          {useGlobalProfile ? (
            <div className="moderation-readonly">
              <Globe2 size={18} />
              <div><strong>Глобальное наследование включено</strong><p>Индивидуальные значения сохранены, но пока не применяются. Отключите наследование, чтобы вернуться к ним.</p></div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!canEdit ? (
        <div className="moderation-readonly">
          <ShieldCheck size={18} />
          <div><strong>Только просмотр</strong><p>{isGlobalScope ? "Изменять глобальную политику могут OWNER и ADMIN." : "Изменять настройки чата могут OWNER и ADMIN."}</p></div>
        </div>
      ) : null}

      <div className="automod-rule">
        <label className="automod-toggle-row">
          <input
            type="checkbox"
            checked={visibleSettings.enabled}
            disabled={fieldsDisabled}
            onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))}
          />
          <span><strong>Команда /report</strong><small>Участники могут пожаловаться на сообщение (ответом на него), администраторы получают приватную карточку с кнопками действий в Telegram.</small></span>
        </label>
        {visibleSettings.enabled ? <>
          <div className="automod-number-grid">
            <label className="automod-field"><span>Срок mute по кнопке «Ограничить», минут</span><input type="number" min={1} max={10080} value={visibleSettings.muteDurationMinutes} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, muteDurationMinutes: Number(event.target.value) }))} /></label>
          </div>
          <small className="hint-note">Кнопки «Удалить/Предупредить/Ограничить/Забанить/Отклонить» приходят администратору в личные сообщения. Кнопка «Ограничить» всегда использует этот фиксированный срок — для другого срока используйте /mute напрямую.</small>
        </> : null}
      </div>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? (
        <div className="automod-actions">
          <button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}>
            <Check size={16} />{saving ? "Сохраняю…" : isGlobalScope ? "Сохранить глобальную политику" : "Сохранить настройки"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
