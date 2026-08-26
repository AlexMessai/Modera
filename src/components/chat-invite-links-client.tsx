"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Link2, Pencil, Plus, Trash2, UserRoundPlus, UserRoundX, Users, X } from "lucide-react";

export type ChatInviteLinkValue = {
  id: string;
  telegramInviteLink: string;
  name: string | null;
  memberLimit: number | null;
  expiresAt: string | null;
  createsJoinRequest: boolean;
  isRevoked: boolean;
  isExpired: boolean;
  isActive: boolean;
  joinedCount: number;
  leftCount: number;
  remaining: number | null;
  createdAt: string;
};

type FormState = {
  name: string;
  memberLimit: string;
  expiresAt: string;
  createsJoinRequest: boolean;
};

const EMPTY_FORM: FormState = { name: "", memberLimit: "", expiresAt: "", createsJoinRequest: false };

function toDateInputValue(iso: string | null) {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function formToPayload(form: FormState) {
  const name = form.name.trim() || undefined;
  const memberLimit = form.createsJoinRequest || !form.memberLimit.trim() ? null : Number(form.memberLimit);
  const expiresAt = form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null;
  return { name, memberLimit, expiresAt, createsJoinRequest: form.createsJoinRequest };
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

export function ChatInviteLinksClient({ chatId, initial, canEdit }: { chatId: string; initial: ChatInviteLinkValue[]; canEdit: boolean }) {
  const [links, setLinks] = useState(initial);
  const [filter, setFilter] = useState<"active" | "inactive">("active");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => links.filter((link) => (filter === "active" ? link.isActive : !link.isActive)), [links, filter]);
  const activeCount = useMemo(() => links.filter((link) => link.isActive).length, [links]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  }

  function openEdit(link: ChatInviteLinkValue) {
    setEditingId(link.id);
    setForm({
      name: link.name ?? "",
      memberLimit: link.memberLimit ? String(link.memberLimit) : "",
      expiresAt: toDateInputValue(link.expiresAt),
      createsJoinRequest: link.createsJoinRequest
    });
    setError(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const payload = formToPayload(form);
      const url = editingId ? `/api/chats/${chatId}/invite-links/${editingId}` : `/api/chats/${chatId}/invite-links`;
      const response = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const responsePayload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responsePayload?.error?.message ?? "Не удалось сохранить ссылку.");

      const saved = responsePayload.data as ChatInviteLinkValue;
      setLinks((current) => {
        const withoutExisting = current.filter((item) => item.id !== saved.id);
        return [saved, ...withoutExisting];
      });
      setModalOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить ссылку.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(link: ChatInviteLinkValue) {
    setDeletingId(link.id);
    try {
      const response = await fetch(`/api/chats/${chatId}/invite-links/${link.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "Не удалось удалить ссылку.");
      }
      setLinks((current) => current.filter((item) => item.id !== link.id));
    } catch {
      // Best-effort UI: leave the card in place, the admin can retry.
    } finally {
      setDeletingId(null);
    }
  }

  async function copyLink(link: ChatInviteLinkValue) {
    try {
      await navigator.clipboard.writeText(link.telegramInviteLink);
      setCopiedId(link.id);
      setTimeout(() => setCopiedId((current) => (current === link.id ? null : current)), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) -- nothing to fall back to.
    }
  }

  return (
    <section className="panel profile-section invite-links">
      <div className="settings-toolbar">
        <div className="panel-header" style={{ marginBottom: 0 }}>
          <div>
            <h2>Пригласительные ссылки</h2>
            <p>Создавайте отдельные ссылки для приглашений и отслеживайте, сколько людей по ним вступило.</p>
          </div>
        </div>
        {canEdit ? (
          <button className="button button--primary button--compact" type="button" onClick={openCreate}>
            <Plus size={16} />Добавить ссылку
          </button>
        ) : null}
      </div>

      <nav className="page-tabs" aria-label="Фильтр ссылок">
        <button type="button" className={`page-tab ${filter === "active" ? "page-tab--active" : ""}`} onClick={() => setFilter("active")}>
          Активные ({activeCount})
        </button>
        <button type="button" className={`page-tab ${filter === "inactive" ? "page-tab--active" : ""}`} onClick={() => setFilter("inactive")}>
          Неактивные ({links.length - activeCount})
        </button>
      </nav>

      {filtered.length === 0 ? (
        <div className="state-box state-box--compact">
          <span className="state-icon"><Link2 size={20} /></span>
          <strong>{filter === "active" ? "Активных ссылок нет" : "Неактивных ссылок нет"}</strong>
          <p>{filter === "active" ? "Создайте ссылку, чтобы отслеживать переходы и вступления." : "Здесь появятся истёкшие или исчерпанные ссылки."}</p>
        </div>
      ) : (
        <div className="invite-link-list">
          {filtered.map((link) => (
            <div className="invite-link-card" key={link.id}>
              <div className="invite-link-card-head">
                <strong>{link.name ?? "Без названия"}</strong>
                {link.isRevoked ? (
                  <span className="badge badge--removed">Отозвана</span>
                ) : link.isExpired ? (
                  <span className="badge badge--insufficient_permissions">Истекла</span>
                ) : link.isActive ? (
                  <span className="badge badge--active">Активная</span>
                ) : (
                  <span className="badge">Исчерпана</span>
                )}
              </div>

              <div className="invite-link-stats">
                <span className="invite-link-stat invite-link-stat--joined"><UserRoundPlus size={15} />{link.joinedCount}</span>
                <span className="invite-link-stat invite-link-stat--left"><UserRoundX size={15} />{link.leftCount}</span>
                {link.createsJoinRequest ? (
                  <span className="invite-link-stat">Заявки на вступление</span>
                ) : (
                  <span className="invite-link-stat invite-link-stat--remaining"><Users size={15} />{link.remaining === null ? "без лимита" : `осталось ${link.remaining}`}</span>
                )}
              </div>

              <button type="button" className="invite-link-url" onClick={() => void copyLink(link)} title="Скопировать ссылку">
                <span>{link.telegramInviteLink}</span>
                {copiedId === link.id ? <Check size={15} /> : <Copy size={15} />}
              </button>

              <div className="invite-link-meta">
                {link.expiresAt ? <span>До {formatDate(link.expiresAt)}</span> : <span>Бессрочная</span>}
              </div>

              {canEdit ? (
                <div className="invite-link-actions">
                  {!link.isRevoked ? (
                    <button className="button button--secondary button--compact" type="button" onClick={() => openEdit(link)}>
                      <Pencil size={14} />Изменить
                    </button>
                  ) : null}
                  <button
                    className="button button--danger button--compact"
                    type="button"
                    disabled={deletingId === link.id}
                    onClick={() => void remove(link)}
                  >
                    <Trash2 size={14} />{deletingId === link.id ? "Удаляю…" : "Удалить"}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {modalOpen ? (
        <div className="automod-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
          <div className="automod-modal" role="dialog" aria-modal="true" aria-labelledby="invite-link-modal-title">
            <div className="automod-modal-header">
              <div className="automod-modal-heading">
                <span><Link2 size={19} /></span>
                <div>
                  <h3 id="invite-link-modal-title">{editingId ? "Изменить ссылку" : "Добавить ссылку"}</h3>
                  <p>{editingId ? "Изменения применяются сразу в Telegram." : "Создаст новую пригласительную ссылку для этого чата."}</p>
                </div>
              </div>
              <button type="button" className="icon-button" aria-label="Закрыть" onClick={closeModal}><X size={18} /></button>
            </div>

            <div className="automod-modal-body">
              <label className="automod-field">
                <span>Название ссылки</span>
                <input
                  type="text"
                  value={form.name}
                  maxLength={32}
                  disabled={saving}
                  placeholder="Например, Instagram"
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                />
              </label>

              <label className="automod-field">
                <span>Заявки на вступление</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.createsJoinRequest}
                  disabled={saving}
                  className={`switch ${form.createsJoinRequest ? "switch--on" : ""}`}
                  onClick={() => setForm((current) => ({ ...current, createsJoinRequest: !current.createsJoinRequest, memberLimit: !current.createsJoinRequest ? "" : current.memberLimit }))}
                >
                  <span className="switch-thumb" />
                </button>
              </label>
              <small className="hint-note">Если включено, каждый переход по ссылке становится заявкой, которую нужно одобрить во вкладке «Заявки» — лимит вступлений в этом режиме Telegram не поддерживает.</small>

              <label className="automod-field">
                <span>Лимит приглашений по ссылке</span>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={form.memberLimit}
                  disabled={saving || form.createsJoinRequest}
                  placeholder="Без ограничений"
                  onChange={(event) => setForm((current) => ({ ...current, memberLimit: event.target.value }))}
                />
              </label>

              <label className="automod-field">
                <span>Ссылка действительна до</span>
                <input
                  type="date"
                  value={form.expiresAt}
                  disabled={saving}
                  onChange={(event) => setForm((current) => ({ ...current, expiresAt: event.target.value }))}
                />
              </label>

              {error ? <div className="moderation-feedback moderation-feedback--error">{error}</div> : null}
            </div>

            <div className="automod-modal-footer">
              <button type="button" className="button" onClick={closeModal} disabled={saving}>Отмена</button>
              <button type="button" className="button button--primary" onClick={() => void submit()} disabled={saving}>
                <Check size={16} />{saving ? "Сохраняю…" : editingId ? "Сохранить" : "Создать"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
