"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { RefreshCw, Search, Trash2, X } from "lucide-react";

type MessageState = "ALL" | "ACTIVE" | "DELETED" | "AUTOMOD_DELETED" | "DELETE_FAILED" | "EDITED";

type Chat = {
  id: string;
  title: string;
  telegramChatId: string;
};

type MessageItem = {
  id: string;
  telegramMessageId: string;
  telegramDate: string;
  editedAt: string | null;
  text: string | null;
  caption: string | null;
  messageType: string;
  isEdited: boolean;
  automodResult: string | null;
  deletedAt: string | null;
  chat: Chat;
  sender: {
    id: string;
    displayName: string;
    username: string | null;
    telegramUserId: string;
    isBot: boolean;
  } | null;
};

type ResponseData = {
  items: MessageItem[];
  chats: Chat[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type Filters = {
  search: string;
  sender: string;
  chatId: string;
  type: string;
  state: MessageState;
  dateFrom: string;
  dateTo: string;
};

const DEFAULT_FILTERS: Filters = {
  search: "",
  sender: "",
  chatId: "",
  type: "",
  state: "ALL",
  dateFrom: "",
  dateTo: ""
};

const typeLabels: Record<string, string> = {
  TEXT: "Текст",
  PHOTO: "Фото",
  VIDEO: "Видео",
  ANIMATION: "GIF",
  DOCUMENT: "Файл",
  STICKER: "Стикер",
  VOICE: "Голосовое",
  AUDIO: "Аудио",
  VIDEO_NOTE: "Видеосообщение",
  POLL: "Опрос",
  DICE: "Кубик",
  LOCATION: "Геолокация",
  CONTACT: "Контакт",
  SERVICE: "Сервисное",
  OTHER: "Другое"
};

const stateLabels: Record<MessageState, string> = {
  ALL: "Все состояния",
  ACTIVE: "Не удалены",
  DELETED: "Удалены",
  AUTOMOD_DELETED: "Удалены автомодерацией",
  DELETE_FAILED: "Ошибка удаления",
  EDITED: "Редактировались"
};

const resultLabels: Record<string, string> = {
  CLEAN: "Проверено",
  DISABLED: "Правила выключены",
  EXEMPT_ADMIN: "Исключение: администратор",
  DELETED_LINK: "Удалено: ссылка",
  DELETED_SPAM: "Удалено: флуд",
  DELETE_FAILED: "Ошибка удаления",
  MANUAL_DELETED: "Удалено вручную",
  ALREADY_GONE: "Уже отсутствовало"
};

function dateParam(value: string, endOfDay: boolean) {
  if (!value) return "";
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

async function requestMessages(filters: Filters, page: number): Promise<ResponseData> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "50",
    state: filters.state
  });
  if (filters.search) params.set("search", filters.search);
  if (filters.sender) params.set("sender", filters.sender);
  if (filters.chatId) params.set("chatId", filters.chatId);
  if (filters.type) params.set("type", filters.type);
  const dateFrom = dateParam(filters.dateFrom, false);
  const dateTo = dateParam(filters.dateTo, true);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  const response = await fetch(`/api/messages?${params.toString()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Не удалось загрузить сообщения.");
  }
  return payload.data as ResponseData;
}

function messagePreview(message: MessageItem) {
  const content = message.text ?? message.caption;
  if (content?.trim()) return content.trim();
  return `[${typeLabels[message.messageType] ?? message.messageType}]`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function MessagesClient({ canModerate }: { canModerate: boolean }) {
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ResponseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MessageItem | null>(null);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const update = () => {
      void requestMessages(filters, page)
        .then((next) => {
          if (!active) return;
          setData(next);
          setError(null);
          setLoading(false);
        })
        .catch((caught: unknown) => {
          if (!active) return;
          setError(caught instanceof Error ? caught.message : "Не удалось загрузить сообщения.");
          setLoading(false);
        });
    };

    update();
    const interval = window.setInterval(update, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [filters, page]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setFilters({
      ...draft,
      search: draft.search.trim(),
      sender: draft.sender.trim()
    });
    setLoading(true);
  }

  function resetFilters() {
    setDraft(DEFAULT_FILTERS);
    setFilters(DEFAULT_FILTERS);
    setPage(1);
    setLoading(true);
  }

  function refresh() {
    setLoading(true);
    void requestMessages(filters, page)
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить сообщения.");
      })
      .finally(() => setLoading(false));
  }

  async function deleteMessage() {
    if (!selected || reason.trim().length < 2) {
      setDeleteError("Укажите причину удаления — минимум 2 символа.");
      return;
    }

    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/messages/${selected.id}/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось удалить сообщение.");
      }

      setSelected(null);
      setReason("");
      refresh();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "Не удалось удалить сообщение.");
    } finally {
      setDeleting(false);
    }
  }

  const chats = data?.chats ?? [];

  return (
    <>
      <section className="panel messages-filter-panel">
        <form className="messages-filters" onSubmit={applyFilters}>
          <label className="messages-filter messages-filter--wide">
            <span>Содержимое</span>
            <div className="search-box">
              <Search size={16} />
              <input
                value={draft.search}
                onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
                placeholder="Текст, подпись, чат или пользователь"
              />
            </div>
          </label>
          <label className="messages-filter">
            <span>Пользователь</span>
            <input
              className="text-control"
              value={draft.sender}
              onChange={(event) => setDraft((current) => ({ ...current, sender: event.target.value }))}
              placeholder="Имя, @username или ID"
            />
          </label>
          <label className="messages-filter">
            <span>Чат</span>
            <select className="select-control" value={draft.chatId} onChange={(event) => setDraft((current) => ({ ...current, chatId: event.target.value }))}>
              <option value="">Все чаты</option>
              {chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}
            </select>
          </label>
          <label className="messages-filter">
            <span>Тип</span>
            <select className="select-control" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}>
              <option value="">Все типы</option>
              {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="messages-filter">
            <span>Состояние</span>
            <select className="select-control" value={draft.state} onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value as MessageState }))}>
              {Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="messages-filter">
            <span>С даты</span>
            <input className="text-control" type="date" value={draft.dateFrom} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))} />
          </label>
          <label className="messages-filter">
            <span>По дату</span>
            <input className="text-control" type="date" value={draft.dateTo} onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))} />
          </label>
          <div className="messages-filter-actions">
            <button className="button button--primary" type="submit" disabled={loading}>Применить</button>
            <button className="button button--secondary" type="button" onClick={resetFilters} disabled={loading}>Сбросить</button>
            <button className="button button--secondary" type="button" onClick={refresh} disabled={loading}><RefreshCw size={16} /> Обновить</button>
          </div>
        </form>
      </section>

      <section className="panel table-panel messages-table-panel">
        {loading && !data ? <div className="state-box">Загрузка сообщений…</div> : null}
        {error ? <div className="state-box state-box--error" role="alert">{error}</div> : null}
        {!error && data && data.items.length === 0 ? (
          <div className="state-box"><strong>Сообщений не найдено</strong><p>Здесь появляются только сообщения, которые бот реально получил через Telegram updates.</p></div>
        ) : null}

        {!error && data && data.items.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="data-table messages-table">
                <thead><tr><th>Сообщение</th><th>Пользователь</th><th>Чат</th><th>Тип</th><th>Модерация</th><th>Время</th><th /></tr></thead>
                <tbody>
                  {data.items.map((message) => (
                    <tr key={message.id} className={message.deletedAt ? "message-row--deleted" : ""}>
                      <td>
                        <div className="message-content-cell">
                          <span className="message-preview">{messagePreview(message)}</span>
                          <span className="message-meta">Telegram message ID {message.telegramMessageId}{message.isEdited ? " · изменено" : ""}</span>
                        </div>
                      </td>
                      <td>
                        {message.sender ? (
                          <Link className="stacked-cell table-link" href={`/members/${message.sender.id}`}>
                            <strong>{message.sender.displayName}</strong>
                            <span>{message.sender.username ? `@${message.sender.username}` : message.sender.telegramUserId}</span>
                          </Link>
                        ) : <span className="muted">Системное сообщение</span>}
                      </td>
                      <td><Link className="table-link" href={`/chats/${message.chat.id}`}>{message.chat.title}</Link></td>
                      <td>{typeLabels[message.messageType] ?? message.messageType}</td>
                      <td>
                        <div className="message-state-stack">
                          <span className={`badge ${message.deletedAt ? "badge--danger" : "badge--active"}`}>{message.deletedAt ? "Удалено" : "В чате"}</span>
                          {message.automodResult ? <small>{resultLabels[message.automodResult] ?? message.automodResult}</small> : null}
                        </div>
                      </td>
                      <td>{formatDate(message.telegramDate)}</td>
                      <td className="message-actions-cell">
                        {canModerate && !message.deletedAt ? (
                          <button className="icon-button icon-button--danger" type="button" title="Удалить сообщение" aria-label="Удалить сообщение" onClick={() => { setSelected(message); setReason(""); setDeleteError(null); }}>
                            <Trash2 size={16} />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>Сообщений: {data.pagination.total.toLocaleString("ru-RU")} · автообновление 5 секунд</span>
              <div className="pagination">
                <button className="button button--compact" disabled={data.pagination.page <= 1 || loading} onClick={() => { setPage((current) => Math.max(1, current - 1)); setLoading(true); }}>Назад</button>
                <span>{data.pagination.page} / {data.pagination.totalPages}</span>
                <button className="button button--compact" disabled={data.pagination.page >= data.pagination.totalPages || loading} onClick={() => { setPage((current) => current + 1); setLoading(true); }}>Далее</button>
              </div>
            </div>
          </>
        ) : null}
      </section>

      {selected ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !deleting) setSelected(null); }}>
          <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="delete-message-title">
            <div className="dialog-header">
              <div>
                <span className="eyebrow">Telegram · Ручная модерация</span>
                <h2 id="delete-message-title">Удалить сообщение?</h2>
              </div>
              <button className="icon-button" type="button" aria-label="Закрыть" onClick={() => setSelected(null)} disabled={deleting}><X size={18} /></button>
            </div>
            <div className="dialog-message-preview">{messagePreview(selected)}</div>
            <p className="dialog-caption">{selected.sender?.displayName ?? "Системное сообщение"} · {selected.chat.title}</p>
            <label className="moderation-reason">
              <span>Причина удаления</span>
              <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value.slice(0, 500))} placeholder="Например: рекламная ссылка или сообщение не по теме" disabled={deleting} autoFocus />
              <small>{reason.length} / 500</small>
            </label>
            {deleteError ? <div className="moderation-feedback moderation-feedback--error">{deleteError}</div> : null}
            <div className="dialog-actions">
              <button className="button button--secondary" type="button" onClick={() => setSelected(null)} disabled={deleting}>Отмена</button>
              <button className="button button--danger" type="button" onClick={() => void deleteMessage()} disabled={deleting}><Trash2 size={16} /> {deleting ? "Удаляю…" : "Удалить в Telegram"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
