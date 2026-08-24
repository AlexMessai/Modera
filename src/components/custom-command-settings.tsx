"use client";

import { useState } from "react";
import { Check, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { FormattedTextarea } from "@/components/formatted-textarea";

export type CustomCommandValue = {
  id: string;
  trigger: string;
  responseText: string;
  adminOnly: boolean;
  enabled: boolean;
};

type Props = {
  chatId: string;
  initial: CustomCommandValue[];
  canEdit: boolean;
};

type DraftCommand = {
  trigger: string;
  responseText: string;
  adminOnly: boolean;
  enabled: boolean;
};

const EMPTY_DRAFT: DraftCommand = { trigger: "", responseText: "", adminOnly: false, enabled: true };

function CommandForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  error
}: {
  draft: DraftCommand;
  onChange: (draft: DraftCommand) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div className="automod-rule">
      <label className="automod-field">
        <span>Название команды (без /)</span>
        <input type="text" value={draft.trigger} maxLength={32} disabled={saving} onChange={(event) => onChange({ ...draft, trigger: event.target.value })} placeholder="price" />
      </label>
      <label className="automod-field">
        <span>Текст ответа</span>
        <FormattedTextarea value={draft.responseText} maxLength={1000} disabled={saving} onChange={(value) => onChange({ ...draft, responseText: value })} placeholder="Актуальные цены смотрите на сайте: example.com/price" />
      </label>
      <label className="automod-toggle-row automod-toggle-row--compact">
        <input type="checkbox" checked={draft.adminOnly} disabled={saving} onChange={(event) => onChange({ ...draft, adminOnly: event.target.checked })} />
        <span><strong>Только для администраторов и модераторов</strong><small>Обычные участники не увидят ответ на эту команду.</small></span>
      </label>
      <label className="automod-toggle-row automod-toggle-row--compact">
        <input type="checkbox" checked={draft.enabled} disabled={saving} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} />
        <span><strong>Команда включена</strong></span>
      </label>
      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      <div className="automod-actions">
        <button className="button button--secondary" type="button" onClick={onCancel} disabled={saving}>Отмена</button>
        <button className="button button--primary" type="button" onClick={onSave} disabled={saving}>
          <Check size={16} />{saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

export function CustomCommandSettings({ chatId, initial, canEdit }: Props) {
  const [commands, setCommands] = useState(initial);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<DraftCommand>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function startCreate() {
    setEditingId("new");
    setDraft(EMPTY_DRAFT);
    setError(null);
  }

  function startEdit(command: CustomCommandValue) {
    setEditingId(command.id);
    setDraft({ trigger: command.trigger, responseText: command.responseText, adminOnly: command.adminOnly, enabled: command.enabled });
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const isNew = editingId === "new";
      const url = isNew ? `/api/chats/${chatId}/custom-commands` : `/api/chats/${chatId}/custom-commands/${editingId}`;
      const response = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить команду.");
      const saved = payload.data as CustomCommandValue;
      setCommands((current) => (isNew ? [...current, saved] : current.map((command) => (command.id === saved.id ? saved : command))));
      setEditingId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить команду.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(commandId: string) {
    setDeletingId(commandId);
    try {
      const response = await fetch(`/api/chats/${chatId}/custom-commands/${commandId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "Не удалось удалить команду.");
      }
      setCommands((current) => current.filter((command) => command.id !== commandId));
    } catch {
      // Best-effort UI: leave the row in place, the user can retry.
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="automod-settings">
      {!canEdit ? (
        <div className="moderation-readonly">
          <ShieldCheck size={18} />
          <div><strong>Только просмотр</strong><p>Изменять команды могут OWNER и ADMIN.</p></div>
        </div>
      ) : null}

      {commands.length === 0 && editingId !== "new" ? <div className="state-box state-box--compact"><strong>Своих команд пока нет</strong><p>Например: /price, /faq, /contacts.</p></div> : null}

      {commands.map((command) => (
        <div key={command.id}>
          {editingId === command.id ? (
            <CommandForm draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setEditingId(null)} saving={saving} error={error} />
          ) : (
            <div className="automod-rule">
              <div className="automod-rule-heading">
                <strong>/{command.trigger}{command.adminOnly ? " (для админов)" : ""}</strong>
                <small>{command.enabled ? "Включено" : "Выключено"} · {command.responseText}</small>
              </div>
              {canEdit ? (
                <div className="automod-actions">
                  <button className="button button--secondary button--compact" type="button" onClick={() => startEdit(command)}><Pencil size={14} /> Изменить</button>
                  <button className="button button--danger button--compact" type="button" onClick={() => void remove(command.id)} disabled={deletingId === command.id}>
                    <Trash2 size={14} />{deletingId === command.id ? "Удаляю…" : "Удалить"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ))}

      {editingId === "new" ? (
        <CommandForm draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setEditingId(null)} saving={saving} error={error} />
      ) : canEdit ? (
        <div className="automod-actions">
          <button className="button button--secondary" type="button" onClick={startCreate}><Plus size={16} /> Добавить команду</button>
        </div>
      ) : null}
    </div>
  );
}
