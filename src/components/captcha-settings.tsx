"use client";

import { useState } from "react";
import { Check, Globe2, ShieldCheck } from "lucide-react";

type FailAction = "KICK" | "BAN";

export type CaptchaSettingsValue = {
  enabled: boolean;
  timeoutMinutes: number;
  failAction: FailAction;
};

type Props = {
  chatId?: string;
  initial: CaptchaSettingsValue;
  canEdit: boolean;
  botCanRestrictMembers?: boolean;
  scope?: "chat" | "global";
  initialUseGlobalProfile?: boolean;
  globalSettings?: CaptchaSettingsValue;
};

const failActionLabels: Record<FailAction, string> = {
  KICK: "Исключить (сможет вернуться по новой ссылке)",
  BAN: "Заблокировать без возможности вернуться"
};

export function CaptchaSettings({
  chatId,
  initial,
  canEdit,
  botCanRestrictMembers = true,
  scope = "chat",
  initialUseGlobalProfile = false,
  globalSettings
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
      const response = await fetch(isGlobalScope ? "/api/captcha/global" : `/api/chats/${chatId}/captcha`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settings, ...(isGlobalScope ? {} : { useGlobalProfile }) })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки капчи.");

      if (isGlobalScope) {
        setSettings(payload.data as CaptchaSettingsValue);
        setSuccess("Глобальная политика капчи сохранена.");
      } else {
        const saved = payload.data as CaptchaSettingsValue & { useGlobalProfile: boolean };
        const { useGlobalProfile: savedMode, ...savedSettings } = saved;
        setUseGlobalProfile(savedMode);
        setSettings(savedSettings);
        setSuccess(savedMode ? "Чат переключён на глобальную политику капчи." : "Настройки капчи чата сохранены.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки капчи.");
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
            <span><strong>Использовать глобальную политику капчи</strong><small>Настройки этого чата будут автоматически следовать глобальным значениям из раздела «Модерация».</small></span>
          </label>
          {useGlobalProfile ? (
            <div className="moderation-readonly">
              <Globe2 size={18} />
              <div><strong>Глобальное наследование включено</strong><p>Индивидуальные значения сохранены, но пока не применяются. Отключите наследование, чтобы вернуться к ним.</p></div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!isGlobalScope && visibleSettings.enabled && !botCanRestrictMembers ? (
        <div className="moderation-notice"><ShieldCheck size={16} /><span>Капча включена, но у бота нет права ограничивать участников — ограничение при вступлении будет завершаться ошибкой до выдачи права.</span></div>
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
          <span><strong>Капча при вступлении</strong><small>Новый участник супергруппы ограничивается в правах, пока не нажмёт кнопку «Я не бот» под сообщением бота.</small></span>
        </label>
        <div className="automod-number-grid">
          <label className="automod-field">
            <span>Таймаут, минут</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={visibleSettings.timeoutMinutes}
              disabled={fieldsDisabled || !visibleSettings.enabled}
              onChange={(event) => setSettings((current) => ({ ...current, timeoutMinutes: Number(event.target.value) }))}
            />
          </label>
          <label className="automod-field">
            <span>Если не прошёл проверку</span>
            <select
              className="select-control"
              value={visibleSettings.failAction}
              disabled={fieldsDisabled || !visibleSettings.enabled}
              onChange={(event) => setSettings((current) => ({ ...current, failAction: event.target.value as FailAction }))}
            >
              <option value="KICK">{failActionLabels.KICK}</option>
              <option value="BAN">{failActionLabels.BAN}</option>
            </select>
          </label>
        </div>
        <small className="row-note">Таймаут проверяется той же ежедневной задачей, что снимает истёкшие mute — исключение непрошедших может занять до суток.</small>
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
