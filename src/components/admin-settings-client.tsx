"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  KeyRound,
  Pencil,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  X
} from "lucide-react";

type AdminRole = "OWNER" | "ADMIN" | "MODERATOR" | "VIEWER";

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeSessionCount: number;
};

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; user: AdminUser };

const roleLabels: Record<AdminRole, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  MODERATOR: "Модератор",
  VIEWER: "Наблюдатель"
};

const roleDescriptions: Record<AdminRole, string> = {
  OWNER: "Полный доступ, включая администраторов и настройки.",
  ADMIN: "Система, правила чатов и модерация без управления владельцами.",
  MODERATOR: "Ручные действия модерации и просмотр данных.",
  VIEWER: "Только просмотр доступных разделов."
};

function formatDate(value: string | null) {
  if (!value) return "Никогда";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function requestAdmins() {
  const response = await fetch("/api/admin-users", { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Не удалось загрузить администраторов.");
  }
  return payload.data as AdminUser[];
}

export function AdminSettingsClient({ currentAdminId }: { currentAdminId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  function refresh() {
    setLoading(true);
    setError(null);
    void requestAdmins()
      .then(setUsers)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить администраторов.");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let active = true;
    void requestAdmins()
      .then((data) => {
        if (!active) return;
        setUsers(data);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить администраторов.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <section className="panel table-panel settings-admin-panel">
        <div className="toolbar settings-toolbar">
          <div>
            <strong>Администраторы</strong>
            <span>Учётные записи админ-панели и активные серверные сессии.</span>
          </div>
          <div className="settings-toolbar-actions">
            <button className="button button--secondary" type="button" onClick={refresh} disabled={loading}>
              <RefreshCw size={16} /> Обновить
            </button>
            <button className="button button--primary" type="button" onClick={() => setEditor({ mode: "create" })}>
              <UserPlus size={16} /> Добавить администратора
            </button>
          </div>
        </div>

        {error ? <div className="state-box state-box--error">{error}</div> : null}
        {loading && users.length === 0 ? <div className="state-box">Загрузка администраторов…</div> : null}

        {!error && users.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table settings-admin-table">
              <thead>
                <tr>
                  <th>Администратор</th>
                  <th>Роль</th>
                  <th>Статус</th>
                  <th>Активные сессии</th>
                  <th>Последний вход</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="settings-admin-identity">
                        <span className="account-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
                        <div className="stacked-cell">
                          <strong>{user.displayName}{user.id === currentAdminId ? " · Вы" : ""}</strong>
                          <span>{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td><span className={`badge settings-role settings-role--${user.role.toLowerCase()}`}>{roleLabels[user.role]}</span></td>
                    <td><span className={`badge ${user.isActive ? "badge--active" : "badge--danger"}`}>{user.isActive ? "Активен" : "Отключён"}</span></td>
                    <td>{user.activeSessionCount.toLocaleString("ru-RU")}</td>
                    <td>{formatDate(user.lastLoginAt)}</td>
                    <td>
                      <button className="icon-button" type="button" title="Изменить" aria-label="Изменить администратора" onClick={() => setEditor({ mode: "edit", user })}>
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="settings-role-grid">
        {(Object.keys(roleLabels) as AdminRole[]).map((role) => (
          <article className="panel settings-role-card" key={role}>
            <ShieldCheck size={18} />
            <div><strong>{roleLabels[role]}</strong><p>{roleDescriptions[role]}</p></div>
          </article>
        ))}
      </section>

      {editor ? (
        <AdminEditor
          state={editor}
          currentAdminId={currentAdminId}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function AdminEditor({
  state,
  currentAdminId,
  onClose,
  onSaved
}: {
  state: EditorState;
  currentAdminId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = state.mode === "edit" ? state.user : null;
  const isSelf = editing?.id === currentAdminId;
  const [email, setEmail] = useState(editing?.email ?? "");
  const [displayName, setDisplayName] = useState(editing?.displayName ?? "");
  const [role, setRole] = useState<AdminRole>(editing?.role ?? "MODERATOR");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        editing ? `/api/admin-users/${editing.id}` : "/api/admin-users",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            editing
              ? {
                  email,
                  displayName,
                  role,
                  isActive,
                  ...(password ? { newPassword: password } : {})
                }
              : {
                  email,
                  displayName,
                  role,
                  password
                }
          )
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось сохранить администратора.");
      }

      if (editing && isSelf && password) {
        window.location.assign("/login");
        return;
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить администратора.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeSessions() {
    if (!editing) return;
    setRevoking(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin-users/${editing.id}/sessions`, {
        method: "POST"
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось завершить сессии.");
      }
      if (isSelf) {
        window.location.assign("/login");
        return;
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось завершить сессии.");
    } finally {
      setRevoking(false);
    }
  }

  const passwordRequired = !editing;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving && !revoking) onClose(); }}>
      <form className="dialog-card settings-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-editor-title" onSubmit={submit}>
        <div className="dialog-header">
          <div>
            <span className="eyebrow">Доступ к Modera</span>
            <h2 id="admin-editor-title">{editing ? "Изменить администратора" : "Новый администратор"}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Закрыть" onClick={onClose} disabled={saving || revoking}><X size={18} /></button>
        </div>

        <div className="settings-form-grid">
          <label className="automod-field"><span>Имя</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={120} required disabled={saving || revoking} /></label>
          <label className="automod-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} required disabled={saving || revoking} /></label>
          <label className="automod-field"><span>Роль</span><select className="select-control" value={role} onChange={(event) => setRole(event.target.value as AdminRole)} disabled={saving || revoking || Boolean(isSelf)}>{(Object.keys(roleLabels) as AdminRole[]).map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}</select>{isSelf ? <small>Собственную роль меняет другой OWNER.</small> : null}</label>
          {editing ? (
            <label className="settings-active-toggle"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} disabled={saving || revoking || Boolean(isSelf)} /><span><strong>Учётная запись активна</strong><small>{isSelf ? "Собственную учётку нельзя отключить." : "Отключение завершит все активные сессии."}</small></span></label>
          ) : null}
          <label className="automod-field settings-password-field"><span>{editing ? "Новый пароль" : "Пароль"}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={200} required={passwordRequired} placeholder={editing ? "Оставьте пустым, чтобы не менять" : "Минимум 12 символов"} disabled={saving || revoking} /><small>{editing ? "При смене пароля все сессии этой учётки будут завершены." : "Пароль хешируется bcrypt и не хранится в открытом виде."}</small></label>
        </div>

        {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}

        <div className="settings-dialog-footer">
          {editing ? (
            <button className="button button--secondary" type="button" onClick={() => void revokeSessions()} disabled={saving || revoking || editing.activeSessionCount === 0}>
              <KeyRound size={16} /> {revoking ? "Завершаю…" : `Завершить сессии (${editing.activeSessionCount})`}
            </button>
          ) : <span />}
          <div className="dialog-actions">
            <button className="button button--secondary" type="button" onClick={onClose} disabled={saving || revoking}>Отмена</button>
            <button className="button button--primary" type="submit" disabled={saving || revoking}>{saving ? "Сохраняю…" : editing ? "Сохранить" : "Создать"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
