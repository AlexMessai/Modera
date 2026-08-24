"use client";

import { useState } from "react";
import { Check } from "lucide-react";

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
  manualModeration: {
    warnMessageTemplate: string;
    warnEphemeralMessageTemplate: string;
    unwarnMessageTemplate: string;
    muteMessageTemplate: string;
    muteEphemeralMessageTemplate: string;
    unmuteMessageTemplate: string;
    banMessageTemplate: string;
    banEphemeralMessageTemplate: string;
    unbanMessageTemplate: string;
    kickMessageTemplate: string;
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

const MEDIA_FILTER_LABELS: Record<MediaFilterType, string> = {
  PHOTO: "Изображения",
  VIDEO: "Видео",
  ANIMATION: "GIF",
  VOICE: "Голосовые сообщения",
  AUDIO: "Аудиофайлы",
  VIDEO_NOTE: "Видеосообщения",
  DICE: "Анимированные кости",
  DOCUMENT: "Файлы",
  STICKER: "Стикеры",
  POLL: "Опросы",
  LOCATION: "Геолокация",
  CONTACT: "Контакты"
};

const MEDIA_FILTER_ORDER: MediaFilterType[] = [
  "PHOTO", "VIDEO", "ANIMATION", "VOICE", "AUDIO", "VIDEO_NOTE", "DICE",
  "DOCUMENT", "STICKER", "POLL", "LOCATION", "CONTACT"
];

type ManualModerationCommandKey = keyof SystemMessagesValue["manualModeration"];

const MANUAL_MODERATION_SECTIONS: Array<{
  title: string;
  fields: Array<{ key: ManualModerationCommandKey; label: string; hint: string }>;
}> = [
  {
    title: "Предупреждения",
    fields: [
      { key: "warnMessageTemplate", label: "/warn — публичное сообщение", hint: "Доступны %admin%, %target%, %reason%, %warns%, %warns_limit%." },
      { key: "warnEphemeralMessageTemplate", label: "/warn — приватное уведомление наказанному", hint: "Видит только сам участник. Доступны %chat%, %reason%, %contact%." },
      { key: "unwarnMessageTemplate", label: "/unwarn — публичное сообщение", hint: "Доступны %admin%, %target%, %warns%, %warns_limit%." }
    ]
  },
  {
    title: "Mute",
    fields: [
      { key: "muteMessageTemplate", label: "/mute — публичное сообщение", hint: "Доступны %admin%, %target%, %reason%, %duration%." },
      { key: "muteEphemeralMessageTemplate", label: "/mute — приватное уведомление наказанному", hint: "Видит только сам участник. Доступны %chat%, %reason%, %contact%." },
      { key: "unmuteMessageTemplate", label: "/unmute — публичное сообщение", hint: "Доступны %admin%, %target%." }
    ]
  },
  {
    title: "Блокировка",
    fields: [
      { key: "banMessageTemplate", label: "/ban — публичное сообщение", hint: "Доступны %admin%, %target%, %reason%." },
      { key: "banEphemeralMessageTemplate", label: "/ban — приватное уведомление наказанному", hint: "Видит только сам участник. Доступны %chat%, %reason%, %contact%." },
      { key: "unbanMessageTemplate", label: "/unban — публичное сообщение", hint: "Доступны %admin%, %target%." }
    ]
  },
  {
    title: "Кик",
    fields: [
      { key: "kickMessageTemplate", label: "/kick — публичное сообщение", hint: "Доступны %admin%, %target%, %reason%." }
    ]
  }
];

export function SystemMessagesSettings({ initial, canEdit }: Props) {
  const [messages, setMessages] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fieldsDisabled = !canEdit || saving;

  function setAutomodField<K extends keyof SystemMessagesValue["automod"]>(key: K, value: SystemMessagesValue["automod"][K]) {
    setMessages((current) => ({ ...current, automod: { ...current.automod, [key]: value } }));
  }

  function setMediaFilterText(type: MediaFilterType, notifyText: string) {
    setMessages((current) => ({
      ...current,
      automod: {
        ...current.automod,
        mediaFilters: current.automod.mediaFilters.map((rule) => (rule.type === type ? { ...rule, notifyText } : rule))
      }
    }));
  }

  function setManualModerationField(key: ManualModerationCommandKey, value: string) {
    setMessages((current) => ({ ...current, manualModeration: { ...current.manualModeration, [key]: value } }));
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
          <h2>Системные сообщения</h2>
          <p>Все тексты, которые бот отправляет в чат или в личные сообщения при каком-либо действии — ручном или автоматическом. Одни на все чаты.</p>
        </div>
      </div>

      <div className="settings-section">
        <span className="settings-section-title">Automod — автонаказания</span>
        <label className="automod-field">
          <span>Текст при автоматическом mute</span>
          <textarea rows={2} value={messages.automod.escalationMuteMessageTemplate} disabled={fieldsDisabled} onChange={(event) => setAutomodField("escalationMuteMessageTemplate", event.target.value)} />
          <small>Доступны %target%, %duration%, %warns%, %warns_limit%.</small>
        </label>
        <label className="automod-field">
          <span>Текст при автоматическом ban</span>
          <textarea rows={2} value={messages.automod.escalationBanMessageTemplate} disabled={fieldsDisabled} onChange={(event) => setAutomodField("escalationBanMessageTemplate", event.target.value)} />
          <small>Доступны %target%, %warns%, %warns_limit%.</small>
        </label>
      </div>

      <div className="settings-section">
        <span className="settings-section-title">Automod — Фильтры контента</span>
        <small className="hint-note">Текст отправляется, когда включена «Отправлять сообщение при срабатывании» для этого типа (настраивается по каждому чату отдельно).</small>
        {MEDIA_FILTER_ORDER.map((type) => {
          const rule = messages.automod.mediaFilters.find((item) => item.type === type);
          if (!rule) return null;
          return (
            <label className="automod-field" key={type}>
              <span>{MEDIA_FILTER_LABELS[type]}</span>
              <textarea rows={2} value={rule.notifyText} disabled={fieldsDisabled} onChange={(event) => setMediaFilterText(type, event.target.value)} />
            </label>
          );
        })}
      </div>

      {MANUAL_MODERATION_SECTIONS.map((section) => (
        <div className="settings-section" key={section.title}>
          <span className="settings-section-title">Ручная модерация — {section.title}</span>
          {section.fields.map((field) => (
            <label className="automod-field" key={field.key}>
              <span>{field.label}</span>
              <textarea rows={2} value={messages.manualModeration[field.key]} disabled={fieldsDisabled} onChange={(event) => setManualModerationField(field.key, event.target.value)} />
              <small>{field.hint}</small>
            </label>
          ))}
        </div>
      ))}

      <div className="settings-section">
        <span className="settings-section-title">Капча</span>
        <label className="automod-field">
          <span>Текст сообщения с капчой</span>
          <textarea rows={3} value={messages.captcha.challengeMessageTemplate} disabled={fieldsDisabled} onChange={(event) => setMessages((current) => ({ ...current, captcha: { challengeMessageTemplate: event.target.value } }))} />
          <small>Видит только сам новый участник (ephemeral). Без плейсхолдеров, текст статичный.</small>
        </label>
      </div>

      <div className="settings-section">
        <span className="settings-section-title">Апелляции</span>
        <label className="automod-field">
          <span>/appeal — подтверждение подачи</span>
          <textarea rows={2} value={messages.appeals.appealSubmittedMessageTemplate} disabled={fieldsDisabled} onChange={(event) => setAppealField("appealSubmittedMessageTemplate", event.target.value)} />
          <small>Присылается автору апелляции сразу после отправки. Без плейсхолдеров.</small>
        </label>
        <label className="automod-field">
          <span>Новая апелляция — уведомление админам</span>
          <textarea rows={2} value={messages.appeals.appealNotifyAdminsMessageTemplate} disabled={fieldsDisabled} onChange={(event) => setAppealField("appealNotifyAdminsMessageTemplate", event.target.value)} />
          <small>Доступны %user%, %chat%, %action%, %message%.</small>
        </label>
        <label className="automod-field">
          <span>Апелляция одобрена</span>
          <textarea rows={2} value={messages.appeals.appealApprovedMessageTemplate} disabled={fieldsDisabled} onChange={(event) => setAppealField("appealApprovedMessageTemplate", event.target.value)} />
          <small>Доступны %chat%, %comment%.</small>
        </label>
        <label className="automod-field">
          <span>Апелляция отклонена</span>
          <textarea rows={2} value={messages.appeals.appealRejectedMessageTemplate} disabled={fieldsDisabled} onChange={(event) => setAppealField("appealRejectedMessageTemplate", event.target.value)} />
          <small>Доступны %chat%, %comment%.</small>
        </label>
        <small className="hint-note">Включение апелляций и уведомления вокруг них настраиваются по каждому чату отдельно — вкладка «Апелляции» в настройках чата.</small>
      </div>

      <div className="settings-section">
        <span className="settings-section-title">Приветствие</span>
        <label className="automod-field">
          <span>Текст приветствия новых участников</span>
          <textarea rows={3} maxLength={2000} value={messages.content.welcomeMessageTemplate} disabled={fieldsDisabled} onChange={(event) => setMessages((current) => ({ ...current, content: { welcomeMessageTemplate: event.target.value } }))} />
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
