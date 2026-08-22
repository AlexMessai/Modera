"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Check, RefreshCw, Search, UserRoundCheck, X } from "lucide-react";
import { TelegramAvatar } from "@/components/telegram-avatar";

type Status = "PENDING" | "APPROVED" | "DECLINED";
type JoinRequest = {
  id: string;
  status: Status;
  bio: string | null;
  hasInviteLink: boolean;
  requestedAt: string;
  processing: boolean;
  telegramError: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  chat: { id: string; title: string; telegramChatId: string };
  user: { id: string; displayName: string; username: string | null; telegramUserId: string };
};
type ResponseData = {
  pendingCount: number;
  items: JoinRequest[];
  chats: Array<{ id: string; title: string }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const statusLabels: Record<Status, string> = {
  PENDING: "Ожидает",
  APPROVED: "Принята",
  DECLINED: "Отклонена"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function requestData(input: { page: number; status: Status; chatId: string; search: string }) {
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: "50",
    status: input.status
  });
  if (input.chatId) params.set("chatId", input.chatId);
  if (input.search) params.set("search", input.search);
  const response = await fetch(`/api/join-requests?${params.toString()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось загрузить заявки.");
  return payload.data as ResponseData;
}

export function JoinRequestsClient({
  canModerate,
  initialChatId = "",
  lockChat = false
}: {
  canModerate: boolean;
  initialChatId?: string;
  lockChat?: boolean;
}) {
  const [data, setData] = useState<ResponseData | null>(null);
  const [status, setStatus] = useState<Status>("PENDING");
  const [chatId, setChatId] = useState(initialChatId);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => void requestData({ page, status, chatId, search: query })
      .then((next) => {
        if (!active) return;
        setData(next);
        setError(null);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить заявки.");
        setLoading(false);
      });
    refresh();
    const interval = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [page, status, chatId, query]);

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
    setLoading(true);
  }

  async function act(id: string, action: "approve" | "decline") {
    setActionId(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/join-requests/${id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось обработать заявку.");
      setNotice(action === "approve" ? "Заявка принята в Telegram." : "Заявка отклонена в Telegram.");
      setData(await requestData({ page, status, chatId, search: query }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось обработать заявку.");
    } finally {
      setActionId(null);
    }
  }

  function refreshNow() {
    setLoading(true);
    void requestData({ page, status, chatId, search: query })
      .then((next) => { setData(next); setError(null); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Не удалось загрузить заявки."))
      .finally(() => setLoading(false));
  }

  return (
    <div className="join-request-stack">
      <section className="metrics-grid join-request-metrics">
        <article className="metric-card"><span>Ожидают решения</span><strong>{data?.pendingCount.toLocaleString("ru-RU") ?? "—"}</strong><small>Реальные chat_join_request</small></article>
        <article className="metric-card"><span>Текущий фильтр</span><strong>{data?.pagination.total.toLocaleString("ru-RU") ?? "—"}</strong><small>{statusLabels[status]}</small></article>
      </section>

      <section className="panel table-panel">
        <div className="toolbar toolbar--join-requests">
          <form className="search-box" onSubmit={applySearch}>
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя, username, чат или bio" aria-label="Поиск заявок" />
          </form>
          <div className="join-request-filters">
            <select className="select-control" value={status} onChange={(event) => { setStatus(event.target.value as Status); setPage(1); setLoading(true); }}>
              <option value="PENDING">Ожидают</option>
              <option value="APPROVED">Приняты</option>
              <option value="DECLINED">Отклонены</option>
            </select>
            {lockChat ? null : (
              <select className="select-control" value={chatId} onChange={(event) => { setChatId(event.target.value); setPage(1); setLoading(true); }}>
                <option value="">Все чаты</option>
                {(data?.chats ?? []).map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}
              </select>
            )}
            <button className="button button--secondary" type="button" onClick={refreshNow} disabled={loading}><RefreshCw size={16} /> Обновить</button>
          </div>
        </div>

        {notice ? <div className="moderation-feedback moderation-feedback--success">{notice}</div> : null}
        {error ? <div className="state-box state-box--error">{error}</div> : null}
        {loading && !data ? <div className="state-box">Загрузка заявок…</div> : null}
        {!error && data && data.items.length === 0 ? <div className="state-box"><UserRoundCheck size={22} /><strong>Заявок по выбранному фильтру нет</strong><p>Новые Telegram join requests появятся здесь автоматически.</p></div> : null}

        {!error && data && data.items.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="data-table join-request-table">
                <thead><tr><th>Пользователь</th><th>Чат</th><th>Bio</th><th>Источник</th><th>Статус</th><th>Дата</th><th /></tr></thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      <td><div className="chat-cell"><TelegramAvatar userId={item.user.id} displayName={item.user.displayName} size={34} className="chat-avatar" /><Link className="stacked-cell table-link" href={`/members/${item.user.id}`}><strong>{item.user.displayName}</strong><span>{item.user.username ? `@${item.user.username}` : item.user.telegramUserId}</span></Link></div></td>
                      <td><Link className="table-link" href={`/chats/${item.chat.id}`}>{item.chat.title}</Link></td>
                      <td className="join-request-bio">{item.bio ?? "—"}</td>
                      <td>{item.hasInviteLink ? "Invite link" : "Запрос чата"}</td>
                      <td><span className={`badge ${item.status === "APPROVED" ? "badge--active" : item.status === "DECLINED" ? "badge--danger" : "badge--warning"}`}>{statusLabels[item.status]}</span>{item.telegramError ? <small className="row-note">{item.telegramError}</small> : null}</td>
                      <td>{formatDate(item.requestedAt)}{item.resolvedBy ? <small className="row-note">{item.resolvedBy}</small> : null}</td>
                      <td>
                        {item.status === "PENDING" && canModerate ? (
                          <div className="join-request-actions">
                            <button className="icon-button" type="button" title="Принять" disabled={actionId !== null || item.processing} onClick={() => void act(item.id, "approve")}><Check size={16} /></button>
                            <button className="icon-button icon-button--danger" type="button" title="Отклонить" disabled={actionId !== null || item.processing} onClick={() => void act(item.id, "decline")}><X size={16} /></button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer"><span>Заявок: {data.pagination.total.toLocaleString("ru-RU")}</span><div className="pagination"><button className="button button--compact" disabled={page <= 1 || loading} onClick={() => { setPage((current) => Math.max(1, current - 1)); setLoading(true); }}>Назад</button><span>{data.pagination.page} / {data.pagination.totalPages}</span><button className="button button--compact" disabled={page >= data.pagination.totalPages || loading} onClick={() => { setPage((current) => current + 1); setLoading(true); }}>Далее</button></div></div>
          </>
        ) : null}
      </section>
    </div>
  );
}
