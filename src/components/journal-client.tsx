"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { RefreshCw, Search, TriangleAlert } from "lucide-react";

type JournalCategory = "ALL" | "MANUAL" | "AUTOMOD" | "ERRORS" | "SETTINGS" | "PENDING";
type Person = { id: string; displayName: string; username: string | null; telegramUserId: string };
type Chat = { id: string; title: string; telegramChatId: string };
type Admin = { id: string; displayName: string; email: string };
type JournalItem = { id: string; source: string; action: string; reason: string | null; createdAt: string; status: "SUCCEEDED" | "FAILED"; chat: Chat | null; affectedUser: Person | null; actingAdmin: Admin | null };
type PendingItem = { id: string; source: string; type: string; reason: string | null; expiresAt: string | null; createdAt: string; chat: Chat; affectedUser: Person; actingAdmin: Admin | null };
type ResponseData = { items: JournalItem[]; pending: PendingItem[]; chats: Chat[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };

type ReconciliationResult = {
  outcome: "confirmed" | "not_confirmed" | "already_resolved";
  actionId: string;
  actionStatus: string;
  telegramStatus: string | null;
  confirmedPending: number;
};

const actionLabels: Record<string, string> = {
  MODERATION_WARNING: "Предупреждение",
  MODERATION_MUTE: "Mute",
  MODERATION_UNMUTE: "Снятие mute",
  MODERATION_BAN: "Блокировка",
  MODERATION_UNBAN: "Разблокировка",
  MODERATION_ACTION_FAILED: "Ошибка ручной модерации",
  MODERATION_RECONCILIATION_CHECKED: "Сверка с Telegram",
  MODERATION_RECONCILIATION_CHECK_FAILED: "Ошибка сверки с Telegram",
  MANUAL_MESSAGE_DELETED: "Сообщение удалено вручную",
  MANUAL_MESSAGE_ALREADY_GONE: "Сообщение уже отсутствовало",
  MANUAL_MESSAGE_DELETE_FAILED: "Ошибка ручного удаления сообщения",
  AUTOMOD_LINK_DELETED: "Удалена запрещённая ссылка",
  AUTOMOD_TERM_DELETED: "Удалено запрещённое слово или фраза",
  AUTOMOD_MEDIA_DELETED: "Удалён запрещённый тип контента",
  AUTOMOD_MENTIONS_DELETED: "Удалено за массовые упоминания",
  AUTOMOD_DUPLICATE_DELETED: "Удалено повторяющееся сообщение",
  AUTOMOD_SPAM_DELETED: "Удалено за флуд",
  AUTOMOD_WARNING: "Автоматическое предупреждение",
  AUTOMOD_AUTO_MUTE: "Автоматический mute",
  AUTOMOD_AUTO_BAN: "Автоматическая блокировка",
  AUTOMOD_ESCALATION_FAILED: "Ошибка автоматического наказания",
  AUTOMOD_ESCALATION_SKIPPED_PROTECTED: "Автонаказание пропущено для администратора",
  AUTOMOD_DELETE_FAILED: "Ошибка автоматического удаления",
  AUTOMOD_SETTINGS_UPDATED: "Изменены правила чата",
  GLOBAL_AUTOMOD_SETTINGS_UPDATED: "Изменена глобальная политика",
  PUNISHMENT_STATE_CONFIRMED: "Состояние наказания подтверждено Telegram",
  PUNISHMENT_STATE_CLEARED: "Telegram снял наказание"
};

const pendingLabels: Record<string, string> = {
  WARNING: "Предупреждение",
  MUTE: "Mute",
  UNMUTE: "Снятие mute",
  BAN: "Блокировка",
  UNBAN: "Разблокировка"
};

const categoryLabels: Record<JournalCategory, string> = {
  ALL: "Все события",
  MANUAL: "Ручная модерация",
  AUTOMOD: "Автомодерация",
  ERRORS: "Только ошибки",
  SETTINGS: "Изменения правил",
  PENDING: "Требуют сверки"
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

async function requestJournal(input: { page: number; category: JournalCategory; chatId: string; search: string }) {
  const params = new URLSearchParams({ page: String(input.page), pageSize: "50", category: input.category });
  if (input.chatId) params.set("chatId", input.chatId);
  if (input.search) params.set("search", input.search);
  const response = await fetch(`/api/journal?${params.toString()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось загрузить журнал.");
  return payload.data as ResponseData;
}

export function JournalClient({ canReconcile = false }: { canReconcile?: boolean }) {
  const [data, setData] = useState<ResponseData | null>(null);
  const [category, setCategory] = useState<JournalCategory>("ALL");
  const [chatId, setChatId] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [reconciliationNotice, setReconciliationNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const update = () => void requestJournal({ page, category, chatId, search: query })
      .then((next) => {
        if (!active) return;
        setData(next);
        setError(null);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Не удалось загрузить журнал.");
        setLoading(false);
      });
    update();
    const interval = window.setInterval(update, 10000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [page, category, chatId, query]);

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(search.trim());
    setLoading(true);
  }

  function refresh() {
    setLoading(true);
    void requestJournal({ page, category, chatId, search: query })
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Не удалось загрузить журнал."))
      .finally(() => setLoading(false));
  }

  async function reconcile(actionId: string) {
    setReconcilingId(actionId);
    setReconciliationNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/journal/pending/${actionId}/reconcile`, {
        method: "POST"
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Не удалось сверить действие с Telegram.");
      }
      const result = payload.data as ReconciliationResult;
      if (result.outcome === "confirmed") {
        setReconciliationNotice("Telegram подтвердил действие. PENDING-запись закрыта как выполненная.");
      } else if (result.outcome === "already_resolved") {
        setReconciliationNotice("Действие уже было завершено ранее.");
      } else {
        setReconciliationNotice(`Telegram сейчас сообщает статус «${result.telegramStatus ?? "неизвестно"}». Ожидаемое состояние не подтверждено, поэтому запись оставлена PENDING.`);
      }
      setData(await requestJournal({ page, category, chatId, search: query }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сверить действие с Telegram.");
    } finally {
      setReconcilingId(null);
    }
  }

  const hasPendingOnly = category === "PENDING" && Boolean(data?.pending.length);

  return (
    <div className="journal-stack">
      {data && data.pending.length > 0 ? (
        <section className="panel pending-panel">
          <div className="panel-header">
            <div>
              <h2>Требуют сверки</h2>
              <p>Telegram-действия, которые остались PENDING. Modera сверяет их по chat_member автоматически или по live getChatMember вручную.</p>
            </div>
            <span className="badge badge--warning">{data.pending.length}</span>
          </div>
          {reconciliationNotice ? <div className="moderation-feedback moderation-feedback--success">{reconciliationNotice}</div> : null}
          <div className="pending-list">
            {data.pending.map((item) => (
              <div className="pending-row" key={item.id}>
                <TriangleAlert size={16} />
                <div>
                  <strong>{pendingLabels[item.type] ?? item.type} · {item.affectedUser.displayName}</strong>
                  <span>
                    {item.chat.title} · {item.actingAdmin?.displayName ?? (item.source === "SYSTEM" ? "Автомодерация" : "Система")}
                    {item.reason ? ` · ${item.reason}` : ""}
                    {item.expiresAt ? ` · до ${formatDate(item.expiresAt)}` : ""}
                  </span>
                </div>
                <time>{formatDate(item.createdAt)}</time>
                {canReconcile && item.type !== "WARNING" ? (
                  <button
                    className="button button--compact button--secondary"
                    type="button"
                    disabled={reconcilingId !== null}
                    onClick={() => void reconcile(item.id)}
                  >
                    <RefreshCw size={14} />
                    {reconcilingId === item.id ? "Сверяю…" : "Сверить с Telegram"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel table-panel">
        <div className="toolbar toolbar--journal">
          <form className="search-box" onSubmit={applySearch}>
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Пользователь, чат, администратор или причина" aria-label="Поиск по журналу" />
          </form>
          <div className="journal-filters">
            <select className="select-control" value={category} onChange={(event) => { setCategory(event.target.value as JournalCategory); setPage(1); setLoading(true); }} aria-label="Категория событий">
              {Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <select className="select-control" value={chatId} onChange={(event) => { setChatId(event.target.value); setPage(1); setLoading(true); }} aria-label="Фильтр по чату">
              <option value="">Все чаты</option>
              {(data?.chats ?? []).map((chat) => <option value={chat.id} key={chat.id}>{chat.title}</option>)}
            </select>
            <button className="button button--secondary" type="button" onClick={refresh} disabled={loading}><RefreshCw size={16} /> Обновить</button>
          </div>
        </div>

        {loading && !data ? <div className="state-box">Загрузка журнала…</div> : null}
        {error ? <div className="state-box state-box--error" role="alert">{error}</div> : null}
        {!error && data && data.items.length === 0 && !hasPendingOnly ? <div className="state-box"><strong>Событий по выбранным фильтрам нет</strong><p>Журнал показывает только реальные действия модерации и изменения правил.</p></div> : null}
        {!error && data && data.items.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="data-table journal-table">
                <thead><tr><th>Событие</th><th>Чат</th><th>Участник</th><th>Инициатор</th><th>Результат</th><th>Время</th></tr></thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.id}>
                      <td><div className="stacked-cell journal-event-cell"><strong>{actionLabels[item.action] ?? "Системное событие"}</strong><span>{item.reason ?? (item.source === "SYSTEM" ? "Автоматическое правило" : "Без причины")}</span></div></td>
                      <td>{item.chat ? <Link className="table-link" href={`/chats/${item.chat.id}`}>{item.chat.title}</Link> : "—"}</td>
                      <td>{item.affectedUser ? <Link className="stacked-cell table-link" href={`/members/${item.affectedUser.id}`}><strong>{item.affectedUser.displayName}</strong><span>{item.affectedUser.username ? `@${item.affectedUser.username}` : item.affectedUser.telegramUserId}</span></Link> : "—"}</td>
                      <td>{item.actingAdmin?.displayName ?? (item.source === "SYSTEM" ? "Автомодерация" : "Система")}</td>
                      <td><span className={`badge ${item.status === "FAILED" ? "badge--danger" : "badge--active"}`}>{item.status === "FAILED" ? "Ошибка" : "Выполнено"}</span></td>
                      <td>{formatDate(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>Событий: {data.pagination.total.toLocaleString("ru-RU")}</span>
              <div className="pagination">
                <button className="button button--compact" disabled={data.pagination.page <= 1 || loading} onClick={() => { setPage((current) => Math.max(1, current - 1)); setLoading(true); }}>Назад</button>
                <span>{data.pagination.page} / {data.pagination.totalPages}</span>
                <button className="button button--compact" disabled={data.pagination.page >= data.pagination.totalPages || loading} onClick={() => { setPage((current) => current + 1); setLoading(true); }}>Далее</button>
              </div>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}