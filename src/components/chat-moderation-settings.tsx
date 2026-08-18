"use client";

import { useState } from "react";
import { Check, Globe2, ShieldCheck, TriangleAlert } from "lucide-react";

const mediaTypes = [
  ["PHOTO", "Фото"], ["VIDEO", "Видео"], ["ANIMATION", "GIF / анимации"], ["DOCUMENT", "Файлы"],
  ["STICKER", "Стикеры"], ["VOICE", "Голосовые"], ["AUDIO", "Аудио"], ["VIDEO_NOTE", "Видеосообщения"],
  ["POLL", "Опросы"], ["DICE", "Игровые кубики"], ["LOCATION", "Геолокация"], ["CONTACT", "Контакты"]
] as const;

export type ModerationSettingsValue = {
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
  autoEscalationEnabled: boolean;
  muteAfterWarnings: number;
  muteDurationMinutes: number;
  banAfterWarnings: number;
};

type Props = {
  chatId?: string;
  initial: ModerationSettingsValue;
  canEdit: boolean;
  botCanDeleteMessages?: boolean;
  botCanRestrictMembers?: boolean;
  scope?: "chat" | "global";
  initialUseGlobalProfile?: boolean;
  globalSettings?: ModerationSettingsValue;
};

function splitList(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function ChatModerationSettings({
  chatId,
  initial,
  canEdit,
  botCanDeleteMessages = true,
  botCanRestrictMembers = true,
  scope = "chat",
  initialUseGlobalProfile = false,
  globalSettings
}: Props) {
  const [settings, setSettings] = useState(initial);
  const [useGlobalProfile, setUseGlobalProfile] = useState(initialUseGlobalProfile);
  const [domains, setDomains] = useState(initial.allowedDomains.join("\n"));
  const [terms, setTerms] = useState(initial.blockedTerms.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isGlobalScope = scope === "global";
  const inherited = !isGlobalScope && useGlobalProfile && Boolean(globalSettings);
  const visibleSettings = inherited && globalSettings ? globalSettings : settings;
  const visibleDomains = inherited && globalSettings ? globalSettings.allowedDomains.join("\n") : domains;
  const visibleTerms = inherited && globalSettings ? globalSettings.blockedTerms.join("\n") : terms;
  const fieldsDisabled = !canEdit || saving || inherited;
  const anyRuleEnabled = visibleSettings.blockLinks || visibleSettings.spamEnabled || visibleSettings.blockedTermsEnabled || visibleSettings.massMentionsEnabled || visibleSettings.duplicateEnabled || visibleSettings.blockedMessageTypes.length > 0;

  async function save() {
    if (!isGlobalScope && !chatId) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(isGlobalScope ? "/api/moderation/global" : `/api/chats/${chatId}/moderation`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settings, ...(isGlobalScope ? {} : { useGlobalProfile }), allowedDomains: splitList(domains), blockedTerms: splitList(terms) })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки.");

      if (isGlobalScope) {
        const saved = payload.data as ModerationSettingsValue;
        setSettings(saved); setDomains(saved.allowedDomains.join("\n")); setTerms(saved.blockedTerms.join("\n"));
        setSuccess("Глобальная политика сохранена. Чаты с наследованием применят её к новым Telegram-событиям.");
      } else {
        const saved = payload.data as ModerationSettingsValue & { useGlobalProfile: boolean };
        const { useGlobalProfile: savedMode, ...savedSettings } = saved;
        setUseGlobalProfile(savedMode); setSettings(savedSettings); setDomains(savedSettings.allowedDomains.join("\n")); setTerms(savedSettings.blockedTerms.join("\n"));
        setSuccess(savedMode ? "Чат переключён на глобальную политику модерации." : "Индивидуальные правила сохранены и применяются к новым Telegram-событиям.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки.");
    } finally { setSaving(false); }
  }

  function toggleMedia(type: string, checked: boolean) {
    setSettings((current) => ({ ...current, blockedMessageTypes: checked ? Array.from(new Set([...current.blockedMessageTypes, type])) : current.blockedMessageTypes.filter((item) => item !== type) }));
  }

  return (
    <div className="automod-settings">
      {!isGlobalScope ? (
        <div className="automod-rule">
          <label className="automod-toggle-row">
            <input type="checkbox" checked={useGlobalProfile} disabled={!canEdit || saving} onChange={(event) => setUseGlobalProfile(event.target.checked)} />
            <span><strong>Использовать глобальную политику</strong><small>Правила этого чата будут автоматически следовать настройкам из раздела «Модерация».</small></span>
          </label>
          {useGlobalProfile ? <div className="moderation-readonly"><Globe2 size={18} /><div><strong>Глобальное наследование включено</strong><p>Индивидуальные значения сохранены, но пока не применяются. Отключите наследование, чтобы вернуться к ним.</p></div></div> : null}
        </div>
      ) : null}

      {!botCanDeleteMessages && anyRuleEnabled ? <div className="moderation-notice"><TriangleAlert size={16} /><span>По последней проверке у бота нет права удаления сообщений. Telegram будет отклонять автоматические удаления до выдачи права.</span></div> : null}
      {!isGlobalScope && visibleSettings.autoEscalationEnabled && !botCanRestrictMembers ? <div className="moderation-notice"><TriangleAlert size={16} /><span>Автонаказания включены, но у бота нет права ограничивать участников. Предупреждения сохранятся, а mute/ban будут завершаться ошибкой до выдачи права.</span></div> : null}
      {!canEdit ? <div className="moderation-readonly"><ShieldCheck size={18} /><div><strong>Только просмотр</strong><p>{isGlobalScope ? "Изменять глобальную политику могут OWNER и ADMIN." : "Изменять правила чата могут OWNER и ADMIN."}</p></div></div> : null}

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.blockLinks} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, blockLinks: event.target.checked }))} /><span><strong>Запрещённые ссылки</strong><small>Удаляет ссылки, которых нет в allowlist доменов.</small></span></label>
        <label className="automod-field"><span>Разрешённые домены</span><textarea rows={4} value={visibleDomains} disabled={fieldsDisabled || !visibleSettings.blockLinks} onChange={(event) => setDomains(event.target.value)} placeholder={"example.com\nsubdomain.ru"} /><small>По одному домену на строку. Поддомены разрешённого домена тоже пропускаются.</small></label>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.blockedTermsEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, blockedTermsEnabled: event.target.checked }))} /><span><strong>Запрещённые слова и фразы</strong><small>Проверяет текст сообщения и подпись к медиа без учёта регистра.</small></span></label>
        <label className="automod-field"><span>Список выражений</span><textarea rows={5} value={visibleTerms} disabled={fieldsDisabled || !visibleSettings.blockedTermsEnabled} onChange={(event) => setTerms(event.target.value)} placeholder={"рекламная фраза\nзапрещенное слово"} /><small>Одно слово или фраза на строку. До 200 выражений.</small></label>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.spamEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, spamEnabled: event.target.checked }))} /><span><strong>Антифлуд</strong><small>Удаляет текущее сообщение при превышении лимита сообщений за окно времени.</small></span></label>
        <div className="automod-number-grid">
          <label className="automod-field"><span>Окно, секунд</span><input type="number" min={3} max={120} value={visibleSettings.spamWindowSeconds} disabled={fieldsDisabled || !visibleSettings.spamEnabled} onChange={(event) => setSettings((current) => ({ ...current, spamWindowSeconds: Number(event.target.value) }))} /></label>
          <label className="automod-field"><span>Сообщений разрешено</span><input type="number" min={2} max={50} value={visibleSettings.spamMaxMessages} disabled={fieldsDisabled || !visibleSettings.spamEnabled} onChange={(event) => setSettings((current) => ({ ...current, spamMaxMessages: Number(event.target.value) }))} /></label>
        </div>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.duplicateEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateEnabled: event.target.checked }))} /><span><strong>Повторяющиеся сообщения</strong><small>Сравнивает нормализованный текст пользователя с его недавними сообщениями в этом чате.</small></span></label>
        <div className="automod-number-grid">
          <label className="automod-field"><span>Окно, секунд</span><input type="number" min={5} max={3600} value={visibleSettings.duplicateWindowSeconds} disabled={fieldsDisabled || !visibleSettings.duplicateEnabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateWindowSeconds: Number(event.target.value) }))} /></label>
          <label className="automod-field"><span>Одинаковых разрешено</span><input type="number" min={1} max={20} value={visibleSettings.duplicateMaxMessages} disabled={fieldsDisabled || !visibleSettings.duplicateEnabled} onChange={(event) => setSettings((current) => ({ ...current, duplicateMaxMessages: Number(event.target.value) }))} /></label>
        </div>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.massMentionsEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, massMentionsEnabled: event.target.checked }))} /><span><strong>Массовые упоминания</strong><small>Считает реальные Telegram mention/text_mention entities.</small></span></label>
        <label className="automod-field automod-field--short"><span>Максимум упоминаний</span><input type="number" min={1} max={50} value={visibleSettings.maxMentions} disabled={fieldsDisabled || !visibleSettings.massMentionsEnabled} onChange={(event) => setSettings((current) => ({ ...current, maxMentions: Number(event.target.value) }))} /></label>
      </div>

      <div className="automod-rule">
        <div className="automod-rule-heading"><strong>Запрещённые типы контента</strong><small>Выбранные типы удаляются сразу после получения Telegram update.</small></div>
        <div className="automod-media-grid">{mediaTypes.map(([value, label]) => <label className="automod-media-option" key={value}><input type="checkbox" checked={visibleSettings.blockedMessageTypes.includes(value)} disabled={fieldsDisabled} onChange={(event) => toggleMedia(value, event.target.checked)} /><span>{label}</span></label>)}</div>
      </div>

      <div className="automod-rule">
        <label className="automod-toggle-row"><input type="checkbox" checked={visibleSettings.autoEscalationEnabled} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, autoEscalationEnabled: event.target.checked }))} /><span><strong>Автоматические наказания</strong><small>Каждое успешно удалённое automod-сообщение добавляет предупреждение. По достижении порогов Modera применяет временный mute, затем ban.</small></span></label>
        <div className="automod-number-grid">
          <label className="automod-field"><span>Mute после предупреждений</span><input type="number" min={2} max={20} value={visibleSettings.muteAfterWarnings} disabled={fieldsDisabled || !visibleSettings.autoEscalationEnabled} onChange={(event) => setSettings((current) => ({ ...current, muteAfterWarnings: Number(event.target.value) }))} /></label>
          <label className="automod-field"><span>Срок mute, минут</span><input type="number" min={1} max={10080} value={visibleSettings.muteDurationMinutes} disabled={fieldsDisabled || !visibleSettings.autoEscalationEnabled} onChange={(event) => setSettings((current) => ({ ...current, muteDurationMinutes: Number(event.target.value) }))} /></label>
          <label className="automod-field"><span>Ban после предупреждений</span><input type="number" min={3} max={50} value={visibleSettings.banAfterWarnings} disabled={fieldsDisabled || !visibleSettings.autoEscalationEnabled} onChange={(event) => setSettings((current) => ({ ...current, banAfterWarnings: Number(event.target.value) }))} /></label>
        </div>
        <small className="row-note">Telegram сам снимет временный mute по заданному сроку. Порог ban должен быть выше порога mute.</small>
      </div>

      <label className="automod-toggle-row automod-toggle-row--compact"><input type="checkbox" checked={visibleSettings.ignoreAdmins} disabled={fieldsDisabled} onChange={(event) => setSettings((current) => ({ ...current, ignoreAdmins: event.target.checked }))} /><span><strong>Не применять к администраторам Telegram</strong><small>Рекомендуется оставить включённым. Автоматический mute/ban владельца или администратора в любом случае заблокирован сервером.</small></span></label>

      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? <div className="automod-actions"><button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}><Check size={16} />{saving ? "Сохраняю…" : isGlobalScope ? "Сохранить глобальную политику" : "Сохранить правила"}</button></div> : null}
    </div>
  );
}