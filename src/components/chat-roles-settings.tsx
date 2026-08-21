"use client";

import { useState } from "react";
import { Check, ShieldCheck } from "lucide-react";

export type ChatPermission =
  | "moderation.warn"
  | "moderation.mute"
  | "moderation.ban"
  | "moderation.kick"
  | "moderation.delete"
  | "users.view"
  | "history.view"
  | "automod.manage"
  | "settings.manage"
  | "roles.manage"
  | "logs.view";

export const CHAT_PERMISSION_LABELS: Record<ChatPermission, string> = {
  "moderation.warn": "Выдавать предупреждения",
  "moderation.mute": "Ограничивать (mute)",
  "moderation.ban": "Блокировать (ban)",
  "moderation.kick": "Исключать (kick)",
  "moderation.delete": "Удалять сообщения",
  "users.view": "Просматривать участников",
  "history.view": "Просматривать историю",
  "automod.manage": "Управлять автомодерацией",
  "settings.manage": "Управлять настройками чата",
  "roles.manage": "Управлять ролями",
  "logs.view": "Просматривать журнал"
};

const PERMISSION_ORDER = Object.keys(CHAT_PERMISSION_LABELS) as ChatPermission[];

export type ChatRoleSummary = {
  id: string;
  key: string;
  label: string;
  isCustom: boolean;
  permissions: ChatPermission[];
};

type Props = {
  chatId: string;
  initial: ChatRoleSummary[];
  canEdit: boolean;
};

function RoleCard({ chatId, role, canEdit, onSaved }: { chatId: string; role: ChatRoleSummary; canEdit: boolean; onSaved: (role: ChatRoleSummary) => void }) {
  const [permissions, setPermissions] = useState<ChatPermission[]>(role.permissions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const dirty = permissions.length !== role.permissions.length || permissions.some((permission) => !role.permissions.includes(permission));

  function togglePermission(permission: ChatPermission) {
    setPermissions((current) => (current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/roles`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId: role.id, permissions })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось сохранить права роли.");
      const saved = payload.data as ChatRoleSummary;
      setPermissions(saved.permissions);
      setSuccess("Права роли сохранены.");
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить права роли.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="automod-rule">
      <div className="automod-rule-heading"><strong>{role.label}</strong><small>Ключ: {role.key}</small></div>
      <div className="role-permission-grid">
        {PERMISSION_ORDER.map((permission) => (
          <label className="automod-toggle-row automod-toggle-row--compact" key={permission}>
            <input
              type="checkbox"
              checked={permissions.includes(permission)}
              disabled={!canEdit || saving}
              onChange={() => togglePermission(permission)}
            />
            <span><strong>{CHAT_PERMISSION_LABELS[permission]}</strong></span>
          </label>
        ))}
      </div>
      {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
      {success ? <div className="moderation-feedback moderation-feedback--success">{success}</div> : null}
      {canEdit ? (
        <div className="automod-actions">
          <button className="button button--primary" type="button" onClick={() => void save()} disabled={saving || !dirty}>
            <Check size={16} />{saving ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ChatRolesSettings({ chatId, initial, canEdit }: Props) {
  const [roles, setRoles] = useState(initial);

  return (
    <div className="automod-settings">
      {!canEdit ? (
        <div className="moderation-readonly">
          <ShieldCheck size={18} />
          <div><strong>Только просмотр</strong><p>Изменять права ролей могут OWNER и ADMIN.</p></div>
        </div>
      ) : null}
      {roles.map((role) => (
        <RoleCard
          key={role.id}
          chatId={chatId}
          role={role}
          canEdit={canEdit}
          onSaved={(saved) => setRoles((current) => current.map((item) => (item.id === saved.id ? saved : item)))}
        />
      ))}
    </div>
  );
}
