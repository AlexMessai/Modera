"use client";

import { useState } from "react";
import { Crown, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { TelegramAvatar } from "@/components/telegram-avatar";

export type ChatAdminAccessRoleValue = "OWNER" | "ADMIN" | "MODERATOR";

export type ChatTeamNativeAdminValue = {
  membershipId: string;
  telegramUserId: string;
  telegramUserDbId: string;
  displayName: string;
  username: string | null;
  status: "CREATOR" | "ADMINISTRATOR";
};

export type ChatTeamCustomAdminValue = {
  accessId: string;
  adminId: string;
  displayName: string;
  telegramUsername: string | null;
  role: ChatAdminAccessRoleValue;
  grantedVia: string;
  createdAt: string;
};

type Props = {
  chatId: string;
  initial: { native: ChatTeamNativeAdminValue[]; custom: ChatTeamCustomAdminValue[] };
  canEdit: boolean;
};

const ROLE_LABELS: Record<ChatAdminAccessRoleValue, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  MODERATOR: "Модератор"
};

const ROLE_OPTIONS: ChatAdminAccessRoleValue[] = ["OWNER", "ADMIN", "MODERATOR"];

export function ChatTeamSettings({ chatId, initial, canEdit }: Props) {
  const [custom, setCustom] = useState(initial.custom);
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<ChatAdminAccessRoleValue>("ADMIN");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function addByUsername() {
    const trimmed = handle.trim();
    if (!trimmed) return;
    setAdding(true);
    setAddError(null);
    try {
      const response = await fetch(`/api/chats/${chatId}/team`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: trimmed, role })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось добавить администратора.");
      setCustom((current) => {
        const saved = payload.data as ChatTeamCustomAdminValue;
        const withoutExisting = current.filter((item) => item.accessId !== saved.accessId);
        return [...withoutExisting, saved];
      });
      setHandle("");
    } catch (caught) {
      setAddError(caught instanceof Error ? caught.message : "Не удалось добавить администратора.");
    } finally {
      setAdding(false);
    }
  }

  async function updateRole(accessId: string, nextRole: ChatAdminAccessRoleValue) {
    setSavingId(accessId);
    try {
      const response = await fetch(`/api/chats/${chatId}/team/${accessId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: nextRole })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось изменить роль.");
      const saved = payload.data as ChatTeamCustomAdminValue;
      setCustom((current) => current.map((item) => (item.accessId === saved.accessId ? saved : item)));
    } catch {
      // Best-effort UI: leave the row in place, the user can retry.
    } finally {
      setSavingId(null);
    }
  }

  async function remove(accessId: string) {
    setRemovingId(accessId);
    try {
      const response = await fetch(`/api/chats/${chatId}/team/${accessId}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "Не удалось удалить администратора.");
      }
      setCustom((current) => current.filter((item) => item.accessId !== accessId));
    } catch {
      // Best-effort UI: leave the row in place, the user can retry.
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="automod-settings">
      {!canEdit ? (
        <div className="moderation-readonly">
          <ShieldCheck size={18} />
          <div><strong>Только просмотр</strong><p>Добавлять и изменять доступ к панели может только владелец команды этого чата.</p></div>
        </div>
      ) : null}

      <div className="automod-rule">
        <div className="automod-rule-heading"><strong>Администраторы Telegram</strong><small>Синхронизируются автоматически, изменить нельзя</small></div>
        {initial.native.length === 0 ? (
          <div className="state-box state-box--compact"><strong>Пока никого нет</strong><p>Список появится, когда бот увидит администраторов чата.</p></div>
        ) : (
          initial.native.map((member) => (
            <div className="automod-toggle-row automod-toggle-row--compact" key={member.membershipId} style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <TelegramAvatar userId={member.telegramUserDbId} displayName={member.displayName} size={28} className="group-avatar" />
                <span>
                  <strong>{member.displayName}</strong>
                  <br />
                  <small>{member.username ? `@${member.username}` : `ID ${member.telegramUserId}`}</small>
                </span>
              </span>
              {member.status === "CREATOR" ? (
                <span className="badge"><Crown size={12} /> Владелец</span>
              ) : (
                <span className="badge">Администратор</span>
              )}
            </div>
          ))
        )}
      </div>

      <div className="automod-rule">
        <div className="automod-rule-heading"><strong>Доступ к веб-панели</strong><small>Добавлены вручную по @username</small></div>
        {custom.length === 0 ? (
          <div className="state-box state-box--compact"><strong>Никого не добавлено</strong><p>Добавьте известного боту пользователя по @username ниже.</p></div>
        ) : (
          custom.map((item) => (
            <div className="automod-toggle-row automod-toggle-row--compact" key={item.accessId} style={{ justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="account-avatar"><UserRound size={16} /></span>
                <span>
                  <strong>{item.displayName}</strong>
                  <br />
                  <small>{item.telegramUsername ? `@${item.telegramUsername}` : "Telegram"} · {item.grantedVia === "AUTO" ? "автоматически (администратор Telegram)" : "добавлен вручную"}</small>
                </span>
              </span>
              {canEdit ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <select
                    value={item.role}
                    disabled={savingId === item.accessId}
                    onChange={(event) => void updateRole(item.accessId, event.target.value as ChatAdminAccessRoleValue)}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{ROLE_LABELS[option]}</option>
                    ))}
                  </select>
                  <button
                    className="button button--danger button--compact"
                    type="button"
                    onClick={() => void remove(item.accessId)}
                    disabled={removingId === item.accessId}
                  >
                    <Trash2 size={14} />{removingId === item.accessId ? "Удаляю…" : "Убрать"}
                  </button>
                </span>
              ) : (
                <span className="badge">{ROLE_LABELS[item.role]}</span>
              )}
            </div>
          ))
        )}
      </div>

      {canEdit ? (
        <div className="automod-rule">
          <div className="automod-rule-heading"><strong>Добавить по @username</strong><small>Только для пользователей, уже известных боту</small></div>
          <div className="automod-number-grid">
            <label className="automod-field">
              <span>Username</span>
              <input
                type="text"
                value={handle}
                placeholder="@username"
                disabled={adding}
                onChange={(event) => setHandle(event.target.value)}
              />
            </label>
            <label className="automod-field">
              <span>Роль</span>
              <select value={role} disabled={adding} onChange={(event) => setRole(event.target.value as ChatAdminAccessRoleValue)}>
                {ROLE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{ROLE_LABELS[option]}</option>
                ))}
              </select>
            </label>
          </div>
          {addError ? <div className="moderation-feedback moderation-feedback--error">{addError}</div> : null}
          <div className="automod-actions">
            <button className="button button--primary" type="button" onClick={() => void addByUsername()} disabled={adding || !handle.trim()}>
              <Plus size={16} />{adding ? "Добавляю…" : "Добавить"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
