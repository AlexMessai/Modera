"use client";

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
  permissions: { canDeleteMessages?: boolean; canRestrictMembers?: boolean } | null;
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
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Чат</th><th>Telegram ID</th><th>Тип</th><th>Участники</th><th>Права</th><th>Статус</th><th>Активность</th></tr></thead><tbody>{data.items.map((chat) => <tr key={chat.id}>
          <td><div className="chat-cell"><span className="chat-avatar">{chat.title.slice(0, 1).toUpperCase()}</span><div><strong>{chat.title}</strong><span>{chat.username ? `@${chat.username}` : "Без username"}</span></div></div></td>
          <td className="mono">{chat.telegramChatId}</td>
          <td>{chat.type === "supergroup" ? "Супергруппа" : "Группа"}</td>
          <td>{chat.knownMemberCount?.toLocaleString("ru-RU") ?? "—"}</td>
          <td><div className="permission-stack"><span className={chat.permissions?.canDeleteMessages ? "permission-ok" : ""}>Удаление</span><span className={chat.permissions?.canRestrictMembers ? "permission-ok" : ""}>Ограничения</span></div></td>
          <td><span className={`badge badge--${chat.status.toLowerCase()}`}>{statusLabels[chat.status]}</span>{chat.lastError ? <div className="row-note">{chat.lastError}</div> : null}</td>
          <td>{new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(chat.lastActivityAt))}</td>
        </tr>)}</tbody></table></div>
        <div className="table-footer"><span>Всего: {data.pagination.total.toLocaleString("ru-RU")}</span><span>Автообновление каждые 5 секунд</span></div>
      </> : null}
    </section>
  );
}

function ChatsSkeleton() {
  return <div className="skeleton-list" aria-label="Загрузка чатов">{Array.from({ length: 5 }).map((_, index) => <div className="skeleton-row" key={index}><span /><span /><span /><span /></div>)}</div>;
}
