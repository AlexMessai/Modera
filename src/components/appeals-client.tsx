"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, MessagesSquare, RefreshCw, X } from "lucide-react";
import { TelegramAvatar } from "@/components/telegram-avatar";

type Status = "PENDING" | "APPROVED" | "REJECTED";
type Decision = "approve" | "reject";
type Appeal = {
  id: string;
  status: Status;
  message: string;
  resolutionComment: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  chat: { id: string; title: string; telegramChatId: string };
  user: { id: string; displayName: string; username: string | null; telegramUserId: string };
  moderationAction: { id: string; type: "WARNING" | "MUTE" | "BAN"; reason: string | null; createdAt: string };
};
type ResponseData = {
  pendingCount: number;
  items: Appeal[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const statusLabels: Record<Status, string> = {
  PENDING: "Ожидают",
  APPROVED: "Одобрены",
  REJECTED: "Отклонены"
};

const actionLabels: Record<Appeal["moderationAction"]["type"], string> = {
  WARNING: "Предупреждение",
  MUTE: "Mute",
  BAN: "Ban"
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

async function requestData(input: { page: number; status: Status }) {
  const params = new URLSearchParams({ page: String(input.page), pageSize: "50", status: input.status });
  const response = await fetch(`/api/appeals?${params.toString()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось загрузить апелляции.");
  return payload.data as ResponseData;
}

export function AppealsClient({ canModerate }: { canModerate: boolean }) {
  const [data, setData] = useState<ResponseData | null>(null);
  const [status, setStatus] = useState<Status>("PENDING");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function load() {
    return requestData({ page, status })
      .then((next) => { setData(next); setError(null); })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Не удалось загрузить апелляции."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    void requestData({ page, status }).then((next) => {
      if (!active) return;
      setData(next); setError(null); setLoading(false);
    }).catch((caught: unknown) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить апелляции."); setLoading(false);
    });
    const interval = window.setInterval(() => { if (active) void load(); }, 15000);
    return () => { active = false; window.clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status]);

  function startDecision(id: string, next: Decision) {
    setDecidingId(id); setDecision(next); setComment(""); setError(null); setNotice(null);
  }

  async function confirmDecision() {
    if (!decidingId || !decision) return;
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(`/api/appeals/${decidingId}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: decision, comment: comment.trim() || undefined })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось обработать апелляцию.");
      setNotice(decision === "approve" ? "Апелляция одобрена, наказание отменено." : "Апелляция отклонена.");
      setDecidingId(null); setDecision(null); setComment("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось обработать апелляцию.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="join-request-stack">
      <section className="metrics-grid join-request-metrics">
        <article className="metric-card"><span>Ожидают решения</span><strong>{data?.pendingCount.toLocaleString("ru-RU") ?? "—"}</strong><small>Поданы через ЛС бота</small></article>
        <article className="metric-card"><span>Текущий фильтр</span><strong>{data?.pagination.total.toLocaleString("ru-RU") ?? "—"}</strong><small>{statusLabels[status]}</small></article>
      </section>

      <section className="panel table-panel">
        <div className="toolbar toolbar--join-requests">
          <select className="select-control" value={status} onChange={(event) => { setStatus(event.target.value as Status); setPage(1); }}>
            <option value="PENDING">Ожидают</option>
            <option value="APPROVED">Одобрены</option>
            <option value="REJECTED">Отклонены</option>
          </select>
          <button className="button button--secondary" type="button" onClick={() => { setLoading(true); void load(); }} disabled={loading}><RefreshCw size={16} /> Обновить</button>
        </div>

        {notice ? <div className="moderation-feedback moderation-feedback--success">{notice}</div> : null}
        {error ? <div className="state-box state-box--error">{error}</div> : null}
        {loading && !data ? <div className="state-box">Загрузка апелляций…</div> : null}
        {!error && data && data.items.length === 0 ? <div className="state-box"><MessagesSquare size={22} /><strong>Апелляций по выбранному фильтру нет</strong><p>Пользователи подают апелляцию, отвечая /appeal на сообщение бота о наказании.</p></div> : null}

        {!error && data && data.items.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="data-table join-request-table">
                <thead><tr><th>Пользователь</th><th>Чат</th><th>Наказание</th><th>Текст апелляции</th><th>Дата</th><th /></tr></thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      <td><div className="chat-cell"><TelegramAvatar userId={item.user.id} displayName={item.user.displayName} size={34} className="chat-avatar" /><Link className="stacked-cell table-link" href={`/members/${item.user.id}`}><strong>{item.user.displayName}</strong><span>{item.user.username ? `@${item.user.username}` : item.user.telegramUserId}</span></Link></div></td>
                      <td><Link className="table-link" href={`/chats/${item.chat.id}`}>{item.chat.title}</Link></td>
                      <td><span className="badge">{actionLabels[item.moderationAction.type]}</span>{item.moderationAction.reason ? <small className="row-note">{item.moderationAction.reason}</small> : null}</td>
                      <td className="join-request-bio">{item.message}{item.resolutionComment ? <small className="row-note">Комментарий: {item.resolutionComment}</small> : null}</td>
                      <td>{formatDate(item.createdAt)}{item.resolvedBy ? <small className="row-note">{item.resolvedBy}</small> : null}</td>
                      <td>
                        {item.status === "PENDING" && canModerate ? (
                          <div className="join-request-actions">
                            <button className="icon-button" type="button" title="Одобрить" disabled={submitting} onClick={() => startDecision(item.id, "approve")}><Check size={16} /></button>
                            <button className="icon-button icon-button--danger" type="button" title="Отклонить" disabled={submitting} onClick={() => startDecision(item.id, "reject")}><X size={16} /></button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer"><span>Апелляций: {data.pagination.total.toLocaleString("ru-RU")}</span><div className="pagination"><button className="button button--compact" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Назад</button><span>{data.pagination.page} / {data.pagination.totalPages}</span><button className="button button--compact" disabled={page >= data.pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Далее</button></div></div>
          </>
        ) : null}

        {decidingId && decision ? (
          <div className={`moderation-confirm ${decision === "reject" ? "moderation-confirm--danger" : ""}`}>
            <div>
              <strong>{decision === "approve" ? "Одобрить апелляцию?" : "Отклонить апелляцию?"}</strong>
              <p>{decision === "approve" ? "Наказание будет отменено, пользователю придёт уведомление в ЛС." : "Наказание останется в силе, пользователю придёт уведомление в ЛС."}</p>
              <label className="moderation-reason appeal-comment-field">
                <span>Комментарий (необязательно)</span>
                <textarea value={comment} onChange={(event) => setComment(event.target.value.slice(0, 1000))} rows={2} disabled={submitting} placeholder="Виден пользователю в уведомлении" />
              </label>
            </div>
            <div className="moderation-confirm-actions">
              <button type="button" className="button button--secondary" onClick={() => { setDecidingId(null); setDecision(null); }} disabled={submitting}>Отмена</button>
              <button type="button" className={`button ${decision === "reject" ? "button--danger" : "button--primary"}`} onClick={() => void confirmDecision()} disabled={submitting}><Check size={16} />{submitting ? "Сохраняю…" : "Подтвердить"}</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
