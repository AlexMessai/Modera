"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

type ChatItem = {
  id: string;
  telegramChatId: string;
  title: string;
  username: string | null;
  type: string;
  knownMemberCount: number | null;
  lastActivityAt: string;
  status: "ACTIVE" | "CONNECTED" | "NOT_ADMIN" | "INSUFFICIENT_PERMISSIONS" | "REMOVED" | "DISABLED" | "TELEGRAM_ERROR";
  permissions: { canDeleteMessages?: boolean; canRestrictMembers?: boolean; canManageTags?: boolean } | null;
  lastError: string | null;
};

type ResponseData = {
  items: ChatItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const statusLabels: Record<ChatItem["status"], string> = {
  ACTIVE: "Активен",
  CONNECTED: "Подключён",
  NOT_ADMIN: "Бот не администратор",
  INSUFFICIENT_PERMISSIONS: "Недостаточно прав",
  REMOVED: "Бот удалён",
  DISABLED: "Отключён",
  TELEGRAM_ERROR: "Ошибка Telegram"
};

async function requestChats(query: string): Promise<ResponseData> {
  const params = new URLSearchParams({ page: "1", pageSize: "50" });
  if (query) params.set("search", query);

  const response = await fetch(`/api/chats?${params.toString()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Не удалось загрузить чаты.");
  }

  return payload.data as ResponseData;
}

export function ChatsClient() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const update = () => {
      void requestChats(query)
        .then((nextData) => {
          if (!active) return;
          setData(nextData);
          setError(null);
          setLoading(false);
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : "Не удалось загрузить чаты.");
          setLoading(false);
        });
    };

    update();
    const interval = window.setInterval(update, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [query]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setQuery(search.trim());
  }

  function refresh() {
    setLoading(true);
    setError(null);
    void requestChats(query)
      .then((nextData) => {
        setData(nextData);
        setError(null);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить чаты.");
      })
      .finally(() => setLoading(false));
  }

  return (
    <section className="panel table-panel">
      <div className="toolbar">
        <form className="search-box" onSubmit={onSearch}>
          <Search size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя, @username или Telegram ID" aria-label="Поиск чатов" />
        </form>
        <button className="button button--secondary" onClick={refresh} disabled={loading}>
          <RefreshCw size={16} />Обновить
        </button>
      </div>

      {loading ? <ChatsSkeleton /> : null}
      {!loading && error ? <div className="state-box state-box--error" role="alert">{error}</div> : null}
      {!loading && !error && data?.items.length === 0 ? (
        <div className="state-box"><strong>Чаты пока не найдены</strong><p>Бот автоматически добавит группу после получения события через Telegram webhook.</p></div>
      ) : null}

      {!loading && !error && data && data.items.length > 0 ? <>
        <div className="chat-card-grid">{data.items.map((chat) => (
          <Link key={chat.id} href={`/chats/${chat.id}`} className="chat-card">
            <div className="chat-card-top">
              <span className="chat-card-avatar">{chat.title.slice(0, 1).toUpperCase()}</span>
              <span className={`badge badge--${chat.status.toLowerCase()}`}>{statusLabels[chat.status]}</span>
            </div>
            <div>
              <h3>{chat.title}</h3>
              <p className="chat-card-meta">{chat.type === "supergroup" ? "Супергруппа" : "Группа"}{chat.username ? ` · @${chat.username}` : ""}</p>
            </div>
            <div className="chat-card-stats">
              <div className="chat-card-stat"><span>Участников</span><strong>{chat.knownMemberCount?.toLocaleString("ru-RU") ?? "—"}</strong></div>
              <span className="chat-card-open">Открыть →</span>
            </div>
            {chat.lastError ? <div className="row-note">{chat.lastError}</div> : null}
          </Link>
        ))}</div>
        <div className="table-footer"><span>Всего: {data.pagination.total.toLocaleString("ru-RU")}</span><span>Автообновление каждые 5 секунд</span></div>
      </> : null}
    </section>
  );
}

function ChatsSkeleton() {
  return <div className="skeleton-list" aria-label="Загрузка чатов">{Array.from({ length: 5 }).map((_, index) => <div className="skeleton-row" key={index}><span /><span /><span /><span /></div>)}</div>;
}
