"use client";

import { useState } from "react";
import { Check, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";

export type AutoResponseMatchType = "CONTAINS" | "EXACT";

export type AutoResponseRuleValue = {
  id: string;
  trigger: string;
  matchType: AutoResponseMatchType;
  responseText: string;
  enabled: boolean;
};

type Props = {
  chatId: string;
  initial: AutoResponseRuleValue[];
  canEdit: boolean;
};

type DraftRule = {
  trigger: string;
  matchType: AutoResponseMatchType;
  responseText: string;
  enabled: boolean;
};

const EMPTY_DRAFT: DraftRule = { trigger: "", matchType: "CONTAINS", responseText: "", enabled: true };

function RuleForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  error
}: {
  draft: DraftRule;
  onChange: (draft: DraftRule) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div className="automod-rule">
      <div className="automod-number-grid">
        <label className="automod-field">
          <span>Триггер (фраза или слово)</span>
          <input type="text" value={draft.trigger} maxLength={200} disabled={saving} onChange={(event) => onChange({ ...draft, trigger: event.target.value })} placeholder="где правила" />
        </label>
        <label className="automod-field">
          <span>Тип совпадения</span>
          <select value={draft.matchType} disabled={saving} onChange={(event) => onChange({ ...draft, matchType: event.target.value as AutoResponseMatchType })}>
            <option value="CONTAINS">Содержит фразу</option>
            <option value="EXACT">Точное совпадение</option>
          </select>
        </label>
      </div>
      <label className="automod-field">
        <span>Текст ответа</span>
        <textarea value={draft.responseText} maxLength={1000} disabled={saving} onChange={(event) => onChange({ ...draft, responseText: event.target.value })} placeholder="Правила чата: /rules" />
      </label>
      <label className="automod-toggle-row automod-toggle-row--compact">
        <input type="checkbox" checked={draft.enabled} disabled={saving} onChange={(event) => onChange({ ...draft, enabled: event.target.checked })} />
        <span><strong>Правило включено</strong></span>
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

export function AutoResponseSettings({ chatId, initial, canEdit }: Props) {
  const [rules, setRules] = useState(initial);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<DraftRule>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function startCreate() {
    setEditingId("new");
    setDraft(EMPTY_DRAFT);
    setError(null);
  }

  function startEdit(rule: AutoResponseRuleValue) {
    setEditingId(rule.id);
    setDraft({ trigger: rule.trigger, matchType: rule.matchType, responseText: rule.responseText, enabled: rule.enabled });
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const isNew = editingId === "new";
      const url = isNew ? `/api/chats/${chatId}/auto-responses` : `/api/chats/${chatId}/auto-responses/${editingId}`;
      const response = await fetch(url, {
        method: isNew ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить автоответ.");
      const saved = payload.data as AutoResponseRuleValue;
      setRules((current) => (isNew ? [...current, saved] : current.map((rule) => (rule.id === saved.id ? saved : rule))));
      setEditingId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить автоответ.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(ruleId: string) {
    setDeletingId(ruleId);
    try {
      const response = await fetch(`/api/chats/${chatId}/auto-responses/${ruleId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "Не удалось удалить автоответ.");
      }
      setRules((current) => current.filter((rule) => rule.id !== ruleId));
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
          <div><strong>Только просмотр</strong><p>Изменять автоответы могут OWNER и ADMIN.</p></div>
        </div>
      ) : null}

      {rules.length === 0 && editingId !== "new" ? <div className="state-box state-box--compact"><strong>Автоответов пока нет</strong><p>Например: на фразу «где правила» бот покажет текст правил.</p></div> : null}

      {rules.map((rule) => (
        <div key={rule.id}>
          {editingId === rule.id ? (
            <RuleForm draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setEditingId(null)} saving={saving} error={error} />
          ) : (
            <div className="automod-rule">
              <div className="automod-rule-heading">
                <strong>«{rule.trigger}» {rule.matchType === "EXACT" ? "(точное совпадение)" : "(содержит)"}</strong>
                <small>{rule.enabled ? "Включено" : "Выключено"} · {rule.responseText}</small>
              </div>
              {canEdit ? (
                <div className="automod-actions">
                  <button className="button button--secondary button--compact" type="button" onClick={() => startEdit(rule)}><Pencil size={14} /> Изменить</button>
                  <button className="button button--danger button--compact" type="button" onClick={() => void remove(rule.id)} disabled={deletingId === rule.id}>
                    <Trash2 size={14} />{deletingId === rule.id ? "Удаляю…" : "Удалить"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ))}

      {editingId === "new" ? (
        <RuleForm draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setEditingId(null)} saving={saving} error={error} />
      ) : canEdit ? (
        <div className="automod-actions">
          <button className="button button--secondary" type="button" onClick={startCreate}><Plus size={16} /> Добавить правило</button>
        </div>
      ) : null}
    </div>
  );
}
