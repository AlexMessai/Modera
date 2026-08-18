"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { RefreshCw, Search, Users } from "lucide-react";
import {
  memberStatusBadgeClass,
  memberStatusLabel
} from "@/lib/member-status";

type MemberStatus =
  | "CREATOR"
  | "ADMINISTRATOR"
  | "MEMBER"
  | "RESTRICTED"
  | "PENDING"
  | "LEFT"
  | "BANNED"
  | "UNKNOWN";

type MemberItem = {
  id: string;
  status: MemberStatus;
  joinedAt: string | null;
  leftAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  messageCount: number;
  warningCount: number;
  punishmentState: string | null;
  user: {
    id: string;
    telegramUserId: string;
    username: string | null;
    firstName: string;
    lastName: string | null;
    displayName: string;
    isBot: boolean;
    languageCode: string | null;
  };
  chat: {
    id: string;
    telegramChatId: string;
    title: string;
    username: string | null;
  };
};

type MembersResponse = {
  items: MemberItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type ChatFilterItem = {
  id: string;
  title: string;
  telegramChatId: string;
};

const statusOptions: Array<{ value: MemberStatus | ""; label: string }> = [
  { value: "", label: "Все статусы" },
  { value: "MEMBER", label: "Участники" },
  { value: "ADMINISTRATOR", label: "Администраторы" },
  { value: "CREATOR", label: "Владельцы" },
  { value: "RESTRICTED", label: "Ограниченные" },
  { value: "PENDING", label: "Запросы на вступление" },
  { value: "LEFT", label: "Вышедшие" },
  { value: "BANNED", label: "Заблокированные" },
  { value: "UNKNOWN", label: "Не определены" }
];

async function requestMembers(input: {
  query: string;
  chatId: string;
  status: string;
  page: number;
}): Promise<MembersResponse> {
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: "50"
  });
  if (input.query) params.set("search", input.query);
  if (input.chatId) params.set("chatId", input.chatId);
  if (input.status) params.set("status", input.status);

  const response = await fetch(`/api/members?${params.toString()}`, {
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Не удалось загрузить участников.");
  }

  return payload.data as MembersResponse;
}

async function requestChats(): Promise<ChatFilterItem[]> {
  const response = await fetch("/api/chats?page=1&pageSize=100", {
    cache: "no-store"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return [];
  return (payload.data?.items ?? []) as ChatFilterItem[];
}

export function MembersClient() {
  const [data, setData] = useState<MembersResponse | null>(null);
  const [chats, setChats] = useState<ChatFilterItem[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [chatId, setChatId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void requestChats().then((items) => {
      if (active) setChats(items);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const update = () => {
      void requestMembers({ query, chatId, status, page })
        .then((nextData) => {
          if (!active) return;
          setData(nextData);
          setError(null);
          setLoading(false);
        })
        .catch((reason: unknown) => {
          if (!active) return;
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось загрузить участников."
          );
          setLoading(false);
        });
    };

    update();
    const interval = window.setInterval(update, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [query, chatId, status, page]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setPage(1);
    setQuery(search.trim());
  }

  function refresh() {
    setLoading(true);
    setError(null);
    void requestMembers({ query, chatId, status, page })
      .then((nextData) => {
        setData(nextData);
        setError(null);
      })
      .catch((reason: unknown) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "Не удалось загрузить участников."
        );
      })
      .finally(() => setLoading(false));
  }

  function changeChat(nextChatId: string) {
    setLoading(true);
    setPage(1);
    setChatId(nextChatId);
  }

  function changeStatus(nextStatus: string) {
    setLoading(true);
    setPage(1);
    setStatus(nextStatus);
  }

  return (
    <section className="panel table-panel">
      <div className="toolbar toolbar--members">
        <form className="search-box" onSubmit={onSearch}>
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Имя, @username или Telegram ID"
            aria-label="Поиск участников"
          />
        </form>
        <div className="toolbar-filters">
          <select
            className="select-control"
            value={chatId}
            onChange={(event) => changeChat(event.target.value)}
            aria-label="Фильтр по чату"
          >
            <option value="">Все чаты</option>
            {chats.map((chat) => (
              <option value={chat.id} key={chat.id}>
                {chat.title}
              </option>
            ))}
          </select>
          <select
            className="select-control"
            value={status}
            onChange={(event) => changeStatus(event.target.value)}
            aria-label="Фильтр по статусу"
          >
            {statusOptions.map((option) => (
              <option value={option.value} key={option.value || "all"}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className="button button--secondary"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={16} />
            Обновить
          </button>
        </div>
      </div>

      {loading ? <MembersSkeleton /> : null}
      {!loading && error ? (
        <div className="state-box state-box--error" role="alert">
          {error}
        </div>
      ) : null}
      {!loading && !error && data?.items.length === 0 ? (
        <div className="state-box">
          <span className="state-icon"><Users size={20} /></span>
          <strong>Участники пока не обнаружены</strong>
          <p>
            Telegram Bot API не отдаёт полный исторический список группы. Modera
            добавляет реальных пользователей по новым сообщениям, событиям вступления,
            изменениям статуса и списку администраторов.
          </p>
        </div>
      ) : null}

      {!loading && !error && data && data.items.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="data-table members-table">
              <thead>
                <tr>
                  <th>Участник</th>
                  <th>Чат</th>
                  <th>Статус</th>
                  <th>Сообщения</th>
                  <th>Предупреждения</th>
                  <th>Последняя активность</th>
                  <th>Telegram ID</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="chat-cell">
                        <span className="chat-avatar">
                          {member.user.displayName.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <Link className="table-link" href={`/members/${member.id}`}>
                            {member.user.displayName}
                          </Link>
                          <span>
                            {member.user.username
                              ? `@${member.user.username}`
                              : member.user.isBot
                                ? "Telegram-бот"
                                : "Без username"}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="stacked-cell">
                        <strong>{member.chat.title}</strong>
                        <span className="mono">{member.chat.telegramChatId}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${memberStatusBadgeClass(member.status)}`}
                      >
                        {memberStatusLabel(member.status)}
                      </span>
                    </td>
                    <td>{member.messageCount.toLocaleString("ru-RU")}</td>
                    <td>{member.warningCount.toLocaleString("ru-RU")}</td>
                    <td>{formatDate(member.lastSeenAt)}</td>
                    <td className="mono">{member.user.telegramUserId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>Всего: {data.pagination.total.toLocaleString("ru-RU")}</span>
            <div className="pagination">
              <button
                className="button button--secondary button--compact"
                disabled={data.pagination.page <= 1 || loading}
                onClick={() => {
                  setLoading(true);
                  setPage((current) => Math.max(1, current - 1));
                }}
              >
                Назад
              </button>
              <span>
                {data.pagination.page} / {data.pagination.totalPages}
              </span>
              <button
                className="button button--secondary button--compact"
                disabled={
                  data.pagination.page >= data.pagination.totalPages || loading
                }
                onClick={() => {
                  setLoading(true);
                  setPage((current) => current + 1);
                }}
              >
                Далее
              </button>
            </div>
            <span>Автообновление каждые 5 секунд</span>
          </div>
        </>
      ) : null}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function MembersSkeleton() {
  return (
    <div className="skeleton-list" aria-label="Загрузка участников">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="skeleton-row" key={index}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
