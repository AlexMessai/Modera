"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, MessageSquareText, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { FormattedTextarea } from "@/components/formatted-textarea";

export type WelcomeButtonValue = { text: string; url: string };
export type ContentSettingsValue = {
  welcomeEnabled: boolean;
  welcomeMessageTemplate: string;
  welcomeButtons: WelcomeButtonValue[];
  muteNewMembersMinutes: number;
  blockRtlNames: boolean;
  blockChatFolderJoins: boolean;
  blockInvitedBots: boolean;
  blockMissingUsername: boolean;
  maxNameLength: number;
  blockedNamePatterns: string[];
  checkExistingMembers: boolean;
};

type Props = { chatId: string; initial: ContentSettingsValue; canEdit: boolean; onSaved?: (saved: ContentSettingsValue) => void };

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <button type="button" className={`switch ${checked ? "switch--on" : ""}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span className="switch-thumb" /></button>;
}
function ProtectionToggle({ title, description, checked, disabled, onChange }: { title: string; description?: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <div className="new-user-protection-row"><div><strong>{title}</strong>{description ? <small>{description}</small> : null}</div><Toggle checked={checked} disabled={disabled} label={title} onChange={onChange} /></div>;
}

export function ContentSettings({ chatId, initial, canEdit, onSaved }: Props) {
  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState<ContentSettingsValue | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const disabled = !canEdit || saving;

  useEffect(() => {
    if (!welcomeOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) { setWelcomeOpen(false); setDraft(null); } };
    document.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", close); };
  }, [welcomeOpen, saving]);

  function openWelcome(next = settings) { setDraft(structuredClone(next)); setWelcomeOpen(true); setError(null); }
  function closeWelcome() { setWelcomeOpen(false); setDraft(null); }
  async function save(next: ContentSettingsValue, closeAfter = false) {
    setSaving(true); setError(null); setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/content`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки новых пользователей.");
      const saved = payload.data as ContentSettingsValue;
      setSettings(saved); setSuccess("Настройки новых пользователей сохранены."); onSaved?.(saved);
      if (closeAfter) closeWelcome();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось сохранить настройки новых пользователей."); }
    finally { setSaving(false); }
  }

  function toggleWelcome(checked: boolean) {
    const next = { ...settings, welcomeEnabled: checked };
    setSettings(next);
    if (checked) openWelcome(next);
  }

  return <div className="automod-settings new-user-settings">
    {!canEdit ? <div className="moderation-readonly"><ShieldCheck size={18} /><div><strong>Только просмотр</strong><p>Изменять настройки чата могут OWNER и ADMIN.</p></div></div> : null}
    <article className={`automod-rule-card ${settings.welcomeEnabled ? "" : "automod-rule-card--disabled"}`}>
      <button type="button" className="automod-rule-open" onClick={() => openWelcome()}><span className="automod-rule-icon"><MessageSquareText size={19} /></span><span className="automod-rule-copy"><strong>Приветствие новых участников</strong><small>{settings.welcomeEnabled ? `${settings.welcomeButtons.length ? `${settings.welcomeButtons.length} кнопок · ` : ""}Текст настроен` : "Выключено"}</small></span><span className="automod-rule-chevron"><ChevronRight size={17} /></span></button>
      <Toggle checked={settings.welcomeEnabled} disabled={disabled} label="Приветствие новых участников" onChange={toggleWelcome} />
    </article>

    <details className="new-user-advanced" open>
      <summary><span><ChevronDown size={17} />Расширенные настройки</span><small>Проверки применяются при вступлении.</small></summary>
      <div className="new-user-advanced-body">
        <label className="automod-field new-user-duration"><span>Заглушить новых пользователей</span><select value={settings.muteNewMembersMinutes} disabled={disabled} onChange={(event) => setSettings((current) => ({ ...current, muteNewMembersMinutes: Number(event.target.value) }))}><option value={0}>Выключено</option><option value={1}>1 минута</option><option value={5}>5 минут</option><option value={15}>15 минут</option><option value={60}>1 час</option><option value={360}>6 часов</option><option value={1440}>1 день</option><option value={4320}>3 дня</option><option value={10080}>7 дней</option></select><small>Telegram автоматически снимет ограничение по истечении срока.</small></label>
        <ProtectionToggle title="Блокировать на 60 секунд, если имя содержит символы RTL" description="Проверяет арабские, персидские, ивритские и другие RTL-символы." checked={settings.blockRtlNames} disabled={disabled} onChange={(checked) => setSettings((current) => ({ ...current, blockRtlNames: checked }))} />
        <ProtectionToggle title="Блокировать вступивших через папки с чатами" checked={settings.blockChatFolderJoins} disabled={disabled} onChange={(checked) => setSettings((current) => ({ ...current, blockChatFolderJoins: checked }))} />
        <ProtectionToggle title="Исключать приглашённых Telegram-ботов" description="Приглашённый бот удаляется из группы." checked={settings.blockInvitedBots} disabled={disabled} onChange={(checked) => setSettings((current) => ({ ...current, blockInvitedBots: checked }))} />
        <ProtectionToggle title="Блокировать на 60 секунд пользователей без username" checked={settings.blockMissingUsername} disabled={disabled} onChange={(checked) => setSettings((current) => ({ ...current, blockMissingUsername: checked }))} />
        <label className="automod-field"><span>Блокировать, если имя длиннее</span><input type="number" min={0} max={256} value={settings.maxNameLength} disabled={disabled} onChange={(event) => setSettings((current) => ({ ...current, maxNameLength: Math.max(0, Number(event.target.value)) }))} /><small>0 — проверка выключена.</small></label>
        <label className="automod-field"><span>Блокировать, если имя содержит</span><textarea rows={5} value={settings.blockedNamePatterns.join("\n")} disabled={disabled} onChange={(event) => setSettings((current) => ({ ...current, blockedNamePatterns: event.target.value.split(/\r?\n/) }))} placeholder={"casino\nr:[0-9]+"} /><small>Одно значение на строку. Для регулярного выражения используйте префикс r:.</small></label>
        <ProtectionToggle title="Также проверить существующих пользователей" description="После сохранения Modera проверит до 500 обычных участников по правилам имени." checked={settings.checkExistingMembers} disabled={disabled} onChange={(checked) => setSettings((current) => ({ ...current, checkExistingMembers: checked }))} />
      </div>
    </details>

    {error && !welcomeOpen ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}{success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
    {canEdit ? <div className="automod-actions"><button className="button button--primary" type="button" disabled={saving} onClick={() => void save(settings)}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить настройки"}</button></div> : null}

    {welcomeOpen && draft ? <div className="automod-modal-backdrop" role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) closeWelcome(); }}><div className="automod-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-modal-title"><div className="automod-modal-header"><div className="automod-modal-heading"><span><MessageSquareText size={19} /></span><div><h3 id="welcome-modal-title">Приветствие новых участников</h3><p>Сообщение отправляется сразу после вступления.</p></div></div><button className="icon-button" type="button" aria-label="Закрыть" disabled={saving} onClick={closeWelcome}><X size={18} /></button></div><div className="automod-modal-body">
      <div className="automod-outcome-stack"><ProtectionToggle title="Отправлять приветствие" checked={draft.welcomeEnabled} disabled={disabled} onChange={(checked) => setDraft((current) => current ? { ...current, welcomeEnabled: checked } : current)} />
        <label className="automod-field"><span>Текст приветствия</span><FormattedTextarea rows={7} maxLength={2000} value={draft.welcomeMessageTemplate} disabled={disabled} variables={["{name}", "{username}", "{group}", "{member_count}"]} onChange={(value) => setDraft((current) => current ? { ...current, welcomeMessageTemplate: value } : current)} /><small>{"{name} · {username} · {group} · {member_count}"}</small></label>
        <div className="welcome-buttons"><div className="welcome-buttons-header"><div><strong>Кнопки</strong><small>Ссылки появятся под приветствием в одной строке.</small></div><button type="button" className="button" disabled={disabled || draft.welcomeButtons.length >= 8} onClick={() => setDraft((current) => current ? { ...current, welcomeButtons: [...current.welcomeButtons, { text: "", url: "" }] } : current)}><Plus size={15} />Добавить кнопку</button></div>
          {draft.welcomeButtons.map((button, index) => <div className="welcome-button-row" key={index}><label><span>Название</span><input value={button.text} maxLength={64} disabled={disabled} onChange={(event) => setDraft((current) => current ? { ...current, welcomeButtons: current.welcomeButtons.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item) } : current)} /></label><label><span>Ссылка</span><input type="url" value={button.url} maxLength={500} placeholder="https://example.com" disabled={disabled} onChange={(event) => setDraft((current) => current ? { ...current, welcomeButtons: current.welcomeButtons.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item) } : current)} /></label><button type="button" className="icon-button" aria-label="Удалить кнопку" disabled={disabled} onClick={() => setDraft((current) => current ? { ...current, welcomeButtons: current.welcomeButtons.filter((_, itemIndex) => itemIndex !== index) } : current)}><Trash2 size={16} /></button></div>)}
        </div>
      </div>{error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
    </div><div className="automod-modal-footer"><button className="button" type="button" disabled={saving} onClick={closeWelcome}>Отмена</button>{canEdit ? <button className="button button--primary" type="button" disabled={saving} onClick={() => void save(draft, true)}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить"}</button> : null}</div></div></div> : null}
  </div>;
}
