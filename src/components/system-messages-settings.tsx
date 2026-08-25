"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { FormattedTextarea } from "@/components/formatted-textarea";

export type MediaFilterType =
  | "PHOTO" | "VIDEO" | "ANIMATION" | "VOICE" | "AUDIO" | "VIDEO_NOTE" | "DICE"
  | "DOCUMENT" | "STICKER" | "POLL" | "LOCATION" | "CONTACT";

export type MediaFilterRuleValue = {
  type: MediaFilterType;
  enabled: boolean;
  warnOnTrigger: boolean;
  notifyEnabled: boolean;
  notifyText: string;
};

export type SystemMessagesValue = {
  automod: {
    escalationMuteMessageTemplate: string;
    escalationBanMessageTemplate: string;
    mediaFilters: MediaFilterRuleValue[];
  };
  captcha: { challengeMessageTemplate: string };
  content: { welcomeMessageTemplate: string };
  appeals: {
    appealSubmittedMessageTemplate: string;
    appealNotifyAdminsMessageTemplate: string;
    appealApprovedMessageTemplate: string;
    appealRejectedMessageTemplate: string;
  };
};

type Props = {
  initial: SystemMessagesValue;
  canEdit: boolean;
};

export function SystemMessagesSettings({ initial, canEdit }: Props) {
  const [messages, setMessages] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fieldsDisabled = !canEdit || saving;

  function setAutomodField<K extends keyof SystemMessagesValue["automod"]>(key: K, value: SystemMessagesValue["automod"][K]) {
    setMessages((current) => ({ ...current, automod: { ...current.automod, [key]: value } }));
  }

  function setAppealField<K extends keyof SystemMessagesValue["appeals"]>(key: K, value: SystemMessagesValue["appeals"][K]) {
    setMessages((current) => ({ ...current, appeals: { ...current.appeals, [key]: value } }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/system-messages", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(messages)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить системные сообщения.");

      setMessages(payload.data as SystemMessagesValue);
      setSuccess("Системные сообщения сохранены и применяются во всех чатах.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить системные сообщения.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel automod-settings">
      <div className="panel-header">
        <div>
          <h2>Другие системные сообщения</h2>
          <p>Automod, CAPTCHA, апелляции и приветствие. Сообщения наказаний настраиваются выше, в едином центре.</p>
        </div>
      </div>

      <div className="settings-section">
        <span className="settings-section-title">Automod — автонаказания</span>
        <label className="automod-field">
          <span>Текст при автоматическом mute</span>
          <FormattedTextarea rows={2} value={messages.automod.escalationMuteMessageTemplate} disabled={fieldsDisabled} onChange={(value) => setAutomodField("escalationMuteMessageTemplate", value)} />
          <small>Доступны %target%, %duration%, %warns%, %warns_limit%.</small>
        </label>
        <label className="automod-field">
          <span>Текст при автоматическом ban</span>
          <FormattedTextarea rows={2} value={messages.automod.escalationBanMessageTemplate} disabled={fieldsDisabled} onChange={(value) => setAutomodField("escalationBanMessageTemplate", value)} />
          <small>Доступны %target%, %warns%, %warns_limit%.</small>
        </label>
      </div>

      <div className="settings-section">
        <span className="settings-section-title">Капча</span>
        <label className="automod-field">
          <span>Текст сообщения с капчой</span>
          <FormattedTextarea rows={3} value={messages.captcha.challengeMessageTemplate} disabled={fieldsDisabled} onChange={(value) => setMessages((current) => ({ ...current, captcha: { challengeMessageTemplate: value } }))} />
          <small>Видит только сам новый участник (ephemeral). Без плейсхолдеров, текст статичный.</small>
        </label>
      </div>

      <div className="settings-section">
        <span className="settings-section-title">Апелляции</span>
        <label className="automod-field">
          <span>/appeal — подтверждение подачи</span>
          <FormattedTextarea rows={2} value={messages.appeals.appealSubmittedMessageTemplate} disabled={fieldsDisabled} onChange={(value) => setAppealField("appealSubmittedMessageTemplate", value)} />
          <small>Присылается автору апелляции сразу после отправки. Без плейсхолдеров.</small>
        </label>
        <label className="automod-field">
          <span>Новая апелляция — уведомление админам</span>
          <FormattedTextarea rows={2} value={messages.appeals.appealNotifyAdminsMessageTemplate} disabled={fieldsDisabled} onChange={(value) => setAppealField("appealNotifyAdminsMessageTemplate", value)} />
          <small>Доступны %user%, %chat%, %action%, %message%.</small>
        </label>
        <label className="automod-field">
          <span>Апелляция одобрена</span>
          <FormattedTextarea rows={2} value={messages.appeals.appealApprovedMessageTemplate} disabled={fieldsDisabled} onChange={(value) => setAppealField("appealApprovedMessageTemplate", value)} />
          <small>Доступны %chat%, %comment%.</small>
        </label>
        <label className="automod-field">
          <span>Апелляция отклонена</span>
          <FormattedTextarea rows={2} value={messages.appeals.appealRejectedMessageTemplate} disabled={fieldsDisabled} onChange={(value) => setAppealField("appealRejectedMessageTemplate", value)} />
          <small>Доступны %chat%, %comment%.</small>
        </label>
        <small className="hint-note">Включение апелляций и уведомления вокруг них настраиваются по каждому чату отдельно — вкладка «Апелляции» в настройках чата.</small>
      </div>

      <div className="settings-section">
        <span className="settings-section-title">Приветствие</span>
        <label className="automod-field">
          <span>Текст приветствия новых участников</span>
          <FormattedTextarea rows={3} maxLength={2000} value={messages.content.welcomeMessageTemplate} disabled={fieldsDisabled} onChange={(value) => setMessages((current) => ({ ...current, content: { welcomeMessageTemplate: value } }))} />
          <small>Переменные: {"{name}"}, {"{username}"}, {"{group}"}, {"{member_count}"}.</small>
        </label>
      </div>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? (
        <div className="automod-actions">
          <button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}>
            <Check size={16} />{saving ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
