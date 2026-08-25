"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ShieldCheck } from "lucide-react";
import { SettingsRow } from "@/components/settings-row";

type CommandKey = "warn" | "unwarn" | "mute" | "unmute" | "ban" | "unban" | "kick";
type Recipient = "TARGET" | "PUBLIC" | "MODERATOR";
type CommandProfile = { command: CommandKey; allowAmount: boolean; deleteCommandMessage: boolean; deleteTargetMessage: boolean; deleteAllTargetMessages: boolean; notifications: Record<Recipient, { enabled: boolean; template: string }> };

export type ManualModerationSettingsValue = {
  warnMessageTemplate: string; warnDeleteTargetMessage: boolean; warnEphemeralMessageTemplate: string;
  unwarnMessageTemplate: string; unwarnDeleteTargetMessage: boolean;
  muteMessageTemplate: string; muteDeleteTargetMessage: boolean; muteEphemeralMessageTemplate: string;
  unmuteMessageTemplate: string; unmuteDeleteTargetMessage: boolean;
  banMessageTemplate: string; banDeleteTargetMessage: boolean; banEphemeralMessageTemplate: string;
  unbanMessageTemplate: string; unbanDeleteTargetMessage: boolean;
  kickMessageTemplate: string; kickDeleteTargetMessage: boolean; commands: CommandProfile[];
};
export type ManualModerationVisibilitySettingsValue = { publicPunishmentMessagesEnabled: boolean; privatePunishmentMessagesEnabled: boolean };
type Props = { chatId: string; initial: ManualModerationSettingsValue; visibility?: ManualModerationVisibilitySettingsValue; canEdit: boolean; onSaved?: (saved: ManualModerationSettingsValue) => void };

const GROUPS: Array<{ key: string; title: string; commands: Array<{ key: CommandKey; tab: string }> }> = [
  { key: "warnings", title: "Предупреждения", commands: [{ key: "warn", tab: "/warn · Выдать" }, { key: "unwarn", tab: "/unwarn · Снять" }] },
  { key: "restrictions", title: "Ограничения", commands: [{ key: "mute", tab: "/mute · Ограничить" }, { key: "unmute", tab: "/unmute · Снять" }] },
  { key: "blocks", title: "Блокировки", commands: [{ key: "ban", tab: "/ban · Заблокировать" }, { key: "unban", tab: "/unban · Снять" }] },
  { key: "kick", title: "Исключение из чата", commands: [{ key: "kick", tab: "/kick" }] }
];
const RECIPIENTS: Array<{ key: Recipient; title: string; description: string }> = [
  { key: "TARGET", title: "Нарушителю", description: "Видит только получатель наказания внутри чата" },
  { key: "PUBLIC", title: "Публично в чат", description: "Видят все участники" },
  { key: "MODERATOR", title: "Модераторам", description: "Только модераторам" }
];
const VARIABLES = ["%target%", "%amount%", "%warns%", "%warns_limit%", "%admin%"];
const renderPreview = (template: string) => template.replaceAll("%target%", "@alex_test").replaceAll("%amount%", "2").replaceAll("%warns_limit%", "3").replaceAll("%warns%", "1").replaceAll("%admin%", "Алексей").replace(/<[^>]+>/g, "");

export function ManualModerationSettings({ chatId, initial, canEdit, onSaved }: Props) {
  const [settings, setSettings] = useState(initial);
  const [openGroup, setOpenGroup] = useState<string | null>("warnings");
  const [activeCommands, setActiveCommands] = useState<Record<string, CommandKey>>({ warnings: "unwarn", restrictions: "mute", blocks: "ban", kick: "kick" });
  const [recipient, setRecipient] = useState<Recipient>("PUBLIC");
  const [confirmCommand, setConfirmCommand] = useState<CommandKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const updateCommand = (key: CommandKey, change: (profile: CommandProfile) => CommandProfile) => setSettings((current) => ({ ...current, commands: current.commands.map((profile) => profile.command === key ? change(profile) : profile) }));
  const deleteCommandMessages = settings.commands.every((profile) => profile.deleteCommandMessage);

  function setDeleteCommandMessages(checked: boolean) {
    setSettings((current) => ({ ...current, commands: current.commands.map((profile) => ({ ...profile, deleteCommandMessage: checked })) }));
  }

  async function save() {
    setSaving(true); setFeedback(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/manual-moderation`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить настройки.");
      setSettings(payload.data); onSaved?.(payload.data); setFeedback({ kind: "success", text: "Настройки этого чата сохранены." });
    } catch (error) { setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Не удалось сохранить настройки." }); }
    finally { setSaving(false); }
  }

  function insertVariable(command: CommandKey, variable: string) {
    const editor = editorRef.current;
    const text = settings.commands.find((item) => item.command === command)!.notifications[recipient].template;
    const start = editor?.selectionStart ?? text.length;
    const end = editor?.selectionEnd ?? start;
    updateCommand(command, (current) => ({ ...current, notifications: { ...current.notifications, [recipient]: { ...current.notifications[recipient], template: `${text.slice(0, start)}${variable}${text.slice(end)}` } } }));
    requestAnimationFrame(() => { editorRef.current?.focus(); editorRef.current?.setSelectionRange(start + variable.length, start + variable.length); });
  }

  return <div className="automod-settings manual-mod-settings">
    {!canEdit ? <div className="moderation-readonly"><ShieldCheck size={18} /><div><strong>Только просмотр</strong><p>Изменять настройки чата могут OWNER и ADMIN.</p></div></div> : null}
    <div className="manual-mod-global-setting"><SettingsRow title="Автоматически удалять команды бота" description="Применяется ко всем командам ручной модерации в этом чате" checked={deleteCommandMessages} disabled={!canEdit || saving} onChange={setDeleteCommandMessages} /></div>
    <div className="manual-mod-accordions">{GROUPS.map((group) => {
      const expanded = openGroup === group.key;
      const command = activeCommands[group.key] ?? group.commands[0]!.key;
      const profile = settings.commands.find((item) => item.command === command)!;
      const selectedChannel = profile.notifications[recipient];
      return <section className={`manual-mod-accordion${expanded ? " is-open" : ""}`} key={group.key}>
        <button className="manual-mod-accordion-head" type="button" aria-expanded={expanded} onClick={() => setOpenGroup((current) => current === group.key ? null : group.key)}><strong>{group.title}</strong><span className="manual-mod-accordion-badges">{group.commands.map((item) => <code key={item.key}>/{item.key}</code>)}</span><ChevronDown size={18} /></button>
        {expanded ? <div className="manual-mod-accordion-body">
          <div className="manual-mod-tabs" role="tablist">{group.commands.map((item) => <button key={item.key} type="button" role="tab" aria-selected={command === item.key} className={command === item.key ? "is-active" : ""} onClick={() => { setActiveCommands((current) => ({ ...current, [group.key]: item.key })); setRecipient("PUBLIC"); }}>{item.tab}</button>)}</div>
          {command === "unwarn" ? <><div className="manual-mod-block"><h4>Как использовать</h4><div className="manual-mod-usage"><code>/unwarn @username</code><span>снять одно предупреждение</span><code>/unwarn @username 2</code><span>снять указанное количество</span><code>/unwarn</code><span>ответом на сообщение</span><code>/unwarn 2</code><span>ответом и снять указанное количество</span></div></div><div className="manual-mod-block"><h4>Параметры команды</h4><SettingsRow title="Разрешить указывать количество" description="Если количество не указано, снимается одно предупреждение" checked={profile.allowAmount} disabled={!canEdit || saving} onChange={(checked) => updateCommand(command, (current) => ({ ...current, allowAmount: checked }))} /><p className="manual-mod-note">Принимаются только целые числа от 1. Нельзя снять больше предупреждений, чем есть у пользователя.</p></div></> : null}
          <div className="manual-mod-block"><h4>Кому отправить уведомление</h4><div className="manual-mod-recipients">{RECIPIENTS.map((item) => <div key={item.key} role="button" tabIndex={0} className={`manual-mod-recipient${recipient === item.key ? " is-selected" : ""}`} onClick={() => setRecipient(item.key)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setRecipient(item.key); } }}><div><strong>{item.title}</strong><span>{item.description}</span></div><button type="button" role="switch" aria-checked={profile.notifications[item.key].enabled} aria-label={`Уведомление: ${item.title}`} className={`switch${profile.notifications[item.key].enabled ? " switch--on" : ""}`} disabled={!canEdit || saving} onClick={(event) => { event.stopPropagation(); updateCommand(command, (current) => ({ ...current, notifications: { ...current.notifications, [item.key]: { ...current.notifications[item.key], enabled: !current.notifications[item.key].enabled } } })); }}><span className="switch-thumb" /></button></div>)}</div>
            {selectedChannel.enabled ? <div className="manual-mod-editor"><label htmlFor={`manual-template-${command}-${recipient}`}>Шаблон сообщения</label><textarea ref={editorRef} id={`manual-template-${command}-${recipient}`} rows={4} value={selectedChannel.template} disabled={!canEdit || saving} onChange={(event) => updateCommand(command, (current) => ({ ...current, notifications: { ...current.notifications, [recipient]: { ...current.notifications[recipient], template: event.target.value } } }))} /><div className="manual-mod-variables">{VARIABLES.map((variable) => <button type="button" key={variable} onClick={() => insertVariable(command, variable)} disabled={!canEdit || saving}>{variable}</button>)}</div><div className="manual-mod-preview"><small>ПРЕДПРОСМОТР</small><p>{renderPreview(selectedChannel.template)}</p></div></div> : null}
          </div>
          {command !== "unwarn" && command !== "unmute" && command !== "unban" ? <div className="manual-mod-block"><h4>После применения</h4><SettingsRow title="Удалить сообщение, на которое ответили" description="Сработает, только если команда отправлена ответом" checked={profile.deleteTargetMessage} disabled={!canEdit || saving} onChange={(checked) => updateCommand(command, (current) => ({ ...current, deleteTargetMessage: checked, deleteAllTargetMessages: checked ? current.deleteAllTargetMessages : false }))} />{(command === "mute" || command === "ban") && profile.deleteTargetMessage ? <div className="manual-mod-danger-setting"><SettingsRow title="Удалить все сообщения пользователя в чате" description="Бот удалит все доступные ему сообщения этого пользователя в текущем чате" checked={profile.deleteAllTargetMessages} disabled={!canEdit || saving} onChange={(checked) => checked ? setConfirmCommand(command) : updateCommand(command, (current) => ({ ...current, deleteAllTargetMessages: false }))} /></div> : null}</div> : null}
        </div> : null}
      </section>;
    })}</div>
    {feedback ? <div className={`moderation-feedback moderation-feedback--${feedback.kind}`}>{feedback.text}</div> : null}
    {canEdit ? <div className="automod-actions"><button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}><Check size={16} />{saving ? "Сохраняю…" : "Сохранить настройки"}</button></div> : null}
    {confirmCommand ? <div className="automod-modal-backdrop" role="presentation"><div className="automod-modal manual-mod-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-all-title"><AlertTriangle size={22} /><h3 id="delete-all-title">Удалять все сообщения пользователя?</h3><p>После применения <code>/mute</code> или <code>/ban</code> бот попытается удалить все доступные сообщения пользователя в этом чате. Отменить удаление будет невозможно.</p><div className="automod-actions"><button className="button" type="button" onClick={() => setConfirmCommand(null)}>Отмена</button><button className="button button--danger" type="button" onClick={() => { updateCommand(confirmCommand, (current) => ({ ...current, deleteAllTargetMessages: true })); setConfirmCommand(null); }}>Включить удаление</button></div></div></div> : null}
  </div>;
}
