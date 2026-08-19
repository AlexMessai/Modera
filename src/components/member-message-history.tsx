"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, MessageSquareText, RefreshCw } from "lucide-react";

type MemberMessage = {
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
  chat: { id: string; title: string; telegramChatId: string };
};

type MessageResponse = {
  items: MemberMessage[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const typeLabels: Record<string, string> = {
  TEXT: "Текст",
  PHOTO: "Фото",
  VIDEO: "Видео",
  ANIMATION: "Анимация",
  DOCUMENT: "Документ",
  STICKER: "Стикер",
  VOICE: "Голосовое",
  AUDIO: "Аудио",
  VIDEO_NOTE: "Видеосообщение",
  POLL: "Опрос",
  LOCATION: "Геолокация",
  CONTACT: "Контакт",
  SERVICE: "Служебное"
};

async function requestHistory(input: {
  telegramUserId: string;
  chatId: string;
  page: number;
}) {
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: "10",
    state: "ALL",
    sender: input.telegramUserId,
    chatId: input.chatId
  });
  const response = await fetch(`/api/messages?${params.toString()}`, {
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Не удалось загрузить историю сообщений.");
  }
  return payload.data as MessageResponse;
}

function messagePreview(message: MemberMessage) {
  const content = message.text ?? message.caption;
  return content?.trim() || `[${typeLabels[message.messageType] ?? message.messageType}]`;
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

export function MemberMessageHistory({
  telegramUserId,
  chatId
}: {
  telegramUserId: string;
  chatId: string;
}) {
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<MessageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const update = () => {
      void requestHistory({ telegramUserId, chatId, page })
        .then((next) => {
          if (!active) return;
          setData(next);
          setError(null);
          setLoading(false);
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : "Не удалось загрузить историю сообщений.");
          setLoading(false);
        });
    };

    update();
    const interval = window.setInterval(update, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [chatId, page, refreshKey, telegramUserId]);

  const allMessagesUrl = `/messages?sender=${encodeURIComponent(telegramUserId)}&chatId=${encodeURIComponent(chatId)}`;

  return (
    <section className="panel profile-section member-message-panel">
      <div className="panel-header">
        <div>
          <h2>История сообщений</h2>
          <p>Сообщения этого пользователя, которые бот реально получил в текущем чате.</p>
        </div>
        <div className="panel-actions">
          <button
            className="button button--secondary button--compact"
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setRefreshKey((current) => current + 1);
            }}
          >
            <RefreshCw size={14} /> Обновить
          </button>
          <Link className="button button--secondary button--compact" href={allMessagesUrl}>
            <ExternalLink size={14} /> Все сообщения
          </Link>
        </div>
      </div>

      {loading && !data ? (
        <div className="state-box state-box--compact">Загрузка истории…</div>
      ) : null}
      {error ? <div className="state-box state-box--error" role="alert">{error}</div> : null}
      {!loading && !error && data?.items.length === 0 ? (
        <div className="state-box state-box--compact">
          <strong>Сообщений пока нет</strong>
          <p>Здесь появятся новые сообщения, полученные ботом после его подключения к чату.</p>
        </div>
      ) : null}

      {!error && data && data.items.length > 0 ? (
        <div className="member-message-list">
          {data.items.map((message) => (
            <article className={`member-message-row ${message.deletedAt ? "member-message-row--deleted" : ""}`} key={message.id}>
              <span className="member-message-icon"><MessageSquareText size={16} /></span>
              <div className="member-message-content">
                <div className="member-message-meta">
                  <strong>{typeLabels[message.messageType] ?? message.messageType}</strong>
                  <span className="mono">#{message.telegramMessageId}</span>
                  <time>{formatDate(message.telegramDate)}</time>
                </div>
                <p>{messagePreview(message)}</p>
                <div className="member-message-state">
                  {message.isEdited ? <span className="badge">Изменено</span> : null}
                  {message.deletedAt ? <span className="badge badge--danger">Удалено</span> : null}
                  {message.automodResult ? <span className="badge">{message.automodResult}</span> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {data && data.pagination.total > 0 ? (
        <div className="member-message-footer">
          <span>Всего: {data.pagination.total.toLocaleString("ru-RU")}</span>
          <div className="pagination">
            <button
              className="icon-button"
              type="button"
              aria-label="Предыдущая страница сообщений"
              disabled={page <= 1 || loading}
              onClick={() => {
                setLoading(true);
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <span>{data.pagination.page} / {data.pagination.totalPages}</span>
            <button
              className="icon-button"
              type="button"
              aria-label="Следующая страница сообщений"
              disabled={page >= data.pagination.totalPages || loading}
              onClick={() => {
                setLoading(true);
                setPage((current) => current + 1);
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
