"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Eye, RefreshCw, Search, ShieldAlert, X } from "lucide-react";

type IncidentItem = {
  id: string; type: string; rule: string | null; status: string; severity: string; reason: string;
  previousViolationCount: number; reportCount: number; createdAt: string;
  chat: { id: string; title: string };
  affectedUser: { id: string; displayName: string; username: string | null; telegramUserId: string };
  message: { id: string; text: string | null; caption: string | null; telegramDate: string; deletedAt: string | null } | null;
  assignedAdmin: { id: string; displayName: string } | null;
};
type ListData = { items: IncidentItem[]; chats: { id: string; title: string }[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
type ContextMessage = { id: string; text: string | null; caption: string | null; messageType: string; telegramDate: string; sender: { displayName: string; username?: string | null } | null; isIncident?: boolean };
type DetailData = {
  incident: IncidentItem & { moderatorNote: string | null; resolvedAt: string | null };
  context: ContextMessage[];
  previous: { id: string; reason: string; severity: string; status: string; createdAt: string }[];
  membership: { id: string; status: string; warningCount: number; punishmentState: string | null; punishmentExpiresAt: string | null } | null;
};
type Filters = { search: string; status: string; severity: string; chatId: string; type: string };

const defaults: Filters = { search: "", status: "", severity: "", chatId: "", type: "" };
const statusLabels: Record<string, string> = { NEW: "Новый", IN_REVIEW: "На проверке", RESOLVED: "Решён", SKIPPED: "Пропущен", AUTO_RESOLVED: "Обработан автоматически" };
const severityLabels: Record<string, string> = { LOW: "Низкая", MEDIUM: "Средняя", HIGH: "Высокая", CRITICAL: "Критическая" };
const ruleLabels: Record<string, string> = { LINK: "Ссылка", TERM: "Запрещённая фраза", MEDIA: "Контент", MENTIONS: "Упоминания", DUPLICATE: "Повтор", SPAM: "Флуд" };

function formatDate(value: string) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function content(message: { text: string | null; caption: string | null }) { return message.text?.trim() || message.caption?.trim() || "[сообщение без текста]"; }

async function loadList(filters: Filters, page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  const response = await fetch(`/api/incidents?${params}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось загрузить инциденты.");
  return payload.data as ListData;
}

async function loadDetail(id: string) {
  const response = await fetch(`/api/incidents/${id}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось загрузить детали.");
  return payload.data as DetailData;
}

export function ModerationCenterClient({ canModerate }: { canModerate: boolean }) {
  const [draft, setDraft] = useState(defaults);
  const [filters, setFilters] = useState(defaults);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [muteDurationMinutes, setMuteDurationMinutes] = useState(10);
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    try { setData(await loadList(filters, page)); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "Ошибка загрузки."); } finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { const initial = window.setTimeout(() => void refresh(), 0); const timer = window.setInterval(() => void refresh(), 5000); return () => { window.clearTimeout(initial); window.clearInterval(timer); }; }, [refresh]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    const update = () => void loadDetail(selectedId).then((next) => { if (active) { setDetail(next); setNote(next.incident.moderatorNote ?? ""); } }).catch((caught) => { if (active) setActionError(caught instanceof Error ? caught.message : "Ошибка загрузки."); });
    const initial = window.setTimeout(update, 0); const timer = window.setInterval(update, 5000); return () => { active = false; window.clearTimeout(initial); window.clearInterval(timer); };
  }, [selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
      if (!data?.items.length || ["INPUT", "TEXTAREA", "SELECT"].includes((event.target as HTMLElement)?.tagName)) return;
      const index = data.items.findIndex((item) => item.id === selectedId);
      if (event.key === "ArrowDown" || event.key === "j") { event.preventDefault(); setSelectedId(data.items[Math.min(data.items.length - 1, index + 1)]?.id ?? data.items[0].id); }
      if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault(); setSelectedId(data.items[Math.max(0, index - 1)]?.id ?? data.items[0].id); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [data, selectedId]);

  function submitFilters(event: FormEvent) { event.preventDefault(); setPage(1); setFilters({ ...draft, search: draft.search.trim() }); setLoading(true); }
  async function decide(action: string) {
    if (!selectedId || !canModerate) return;
    setActing(true); setActionError(null);
    try {
      const response = await fetch(`/api/incidents/${selectedId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason, note, muteDurationMinutes }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error?.message ?? "Не удалось выполнить действие.");
      await Promise.all([refresh(), loadDetail(selectedId).then(setDetail)]);
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : "Не удалось выполнить действие."); } finally { setActing(false); }
  }

  return <>
    <section className="panel incidents-filter-panel">
      <form className="incidents-filters" onSubmit={submitFilters}>
        <label className="incidents-filter incidents-filter--search"><span>Поиск</span><div className="search-box"><Search size={16} /><input value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="Пользователь, чат или причина" /></div></label>
        <label className="incidents-filter"><span>Статус</span><select className="select-control" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="">Все статусы</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="incidents-filter"><span>Важность</span><select className="select-control" value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}><option value="">Любая</option>{Object.entries(severityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="incidents-filter"><span>Чат</span><select className="select-control" value={draft.chatId} onChange={(event) => setDraft({ ...draft, chatId: event.target.value })}><option value="">Все чаты</option>{data?.chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}</select></label>
        <label className="incidents-filter"><span>Источник</span><select className="select-control" value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}><option value="">Все источники</option><option value="AUTOMOD">Automod</option><option value="REPORT">Жалобы</option></select></label>
        <div className="incidents-filter-actions"><button className="button button--primary" type="submit">Применить</button><button className="button button--secondary" type="button" onClick={() => { setDraft(defaults); setFilters(defaults); setPage(1); }}><X size={15} />Сбросить</button><button className="button button--secondary" type="button" onClick={() => void refresh()}><RefreshCw size={15} />Обновить</button></div>
      </form>
    </section>

    <section className="panel incidents-workspace">
      <div className="incidents-list" aria-label="Очередь инцидентов">
        <div className="incidents-list-header"><div><strong>Очередь</strong><span>{data?.pagination.total ?? 0} инцидентов</span></div><small>↑ ↓ или J K — навигация</small></div>
        {loading ? <div className="state-box">Загрузка…</div> : error ? <div className="state-box state-box--error"><AlertTriangle size={20} /><strong>{error}</strong></div> : !data?.items.length ? <div className="state-box"><ShieldAlert size={24} /><strong>Очередь пуста</strong><p>Новые срабатывания automod появятся здесь автоматически.</p></div> : data.items.map((item) => <button type="button" key={item.id} className={`incident-row ${selectedId === item.id ? "incident-row--active" : ""}`} onClick={() => { setSelectedId(item.id); setReason(item.reason); }}>
          <span className={`incident-severity incident-severity--${item.severity.toLowerCase()}`}>{severityLabels[item.severity] ?? item.severity}</span>
          <span className="incident-row-main"><strong>{item.affectedUser.displayName}</strong><span>{item.chat.title} · {ruleLabels[item.rule ?? ""] ?? item.rule ?? item.type}</span><small>{content(item.message ?? { text: item.reason, caption: null })}</small></span>
          <span className="incident-row-meta"><span className={`badge badge--${item.status === "NEW" ? "danger" : "active"}`}>{statusLabels[item.status] ?? item.status}</span><small>{formatDate(item.createdAt)}</small></span>
        </button>)}
        {data && data.pagination.totalPages > 1 ? <div className="incidents-pagination"><button className="icon-button" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><span>{page} / {data.pagination.totalPages}</span><button className="icon-button" disabled={page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div> : null}
      </div>

      <div className="incident-detail">
        {!selectedId ? <div className="incident-detail-empty"><Eye size={28} /><strong>Выберите инцидент</strong><p>Справа появятся контекст сообщения, история нарушений и действия.</p></div> : !detail ? <div className="state-box">Загрузка деталей…</div> : <>
          <div className="incident-detail-header"><div><span className={`incident-severity incident-severity--${detail.incident.severity.toLowerCase()}`}>{severityLabels[detail.incident.severity]}</span><h2>{detail.incident.reason}</h2><p>{detail.incident.chat.title} · {detail.incident.affectedUser.displayName}</p></div><button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Закрыть"><X size={18} /></button></div>
          <div className="incident-profile-strip"><div><span>Предупреждения</span><strong>{detail.membership?.warningCount ?? 0}</strong></div><div><span>Предыдущие нарушения</span><strong>{detail.incident.previousViolationCount}</strong></div><div><span>Статус участника</span><strong>{detail.membership?.punishmentState ?? detail.membership?.status ?? "Нет данных"}</strong></div></div>
          <div className="incident-links"><Link href={`/chats/${detail.incident.chat.id}`}>Открыть чат</Link>{detail.membership ? <Link href={`/members/${detail.membership.id}`}>Профиль участника</Link> : null}</div>
          <section className="incident-context"><h3>Контекст: 5 сообщений до и после</h3>{detail.context.length ? detail.context.map((message) => <article key={`${message.id}-${message.telegramDate}`} className={`context-message ${message.isIncident ? "context-message--incident" : ""}`}><div><strong>{message.sender?.displayName ?? "Неизвестный"}</strong><time>{formatDate(message.telegramDate)}</time></div><p>{content(message)}</p>{message.isIncident ? <span>Нарушение</span> : null}</article>) : <div className="state-box">Контекст сообщений отсутствует.</div>}</section>
          {detail.previous.length ? <section className="incident-history"><h3>Предыдущие инциденты</h3>{detail.previous.map((item) => <div key={item.id}><span className={`incident-severity incident-severity--${item.severity.toLowerCase()}`}>{severityLabels[item.severity]}</span><strong>{item.reason}</strong><time>{formatDate(item.createdAt)}</time></div>)}</section> : null}
          {canModerate ? <section className="incident-decision"><h3>Решение модератора</h3><label><span>Причина</span><input className="text-control" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label><label><span>Заметка</span><textarea className="text-control" rows={3} value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Внутренняя заметка для команды" /></label><label><span>Mute, минут</span><input className="text-control" type="number" min={1} max={10080} value={muteDurationMinutes} onChange={(event) => setMuteDurationMinutes(Number(event.target.value))} /></label>{actionError ? <div className="moderation-notice moderation-overview-warning">{actionError}</div> : null}<div className="incident-action-grid"><button className="button button--secondary" disabled={acting} onClick={() => void decide("REVIEW")}>Взять в работу</button><button className="button button--secondary" disabled={acting} onClick={() => void decide("NOTE")}>Сохранить заметку</button><button className="button button--secondary" disabled={acting} onClick={() => void decide("WARNING")}>Предупредить</button><button className="button button--secondary" disabled={acting} onClick={() => void decide("MUTE")}>Mute</button><button className="button button--danger" disabled={acting} onClick={() => void decide("BAN")}>Ban</button><button className="button button--secondary" disabled={acting} onClick={() => void decide("UNBAN")}>Снять ban</button><button className="button button--danger" disabled={acting} onClick={() => void decide("DELETE_MESSAGE")}>Удалить сообщение</button><button className="button button--secondary" disabled={acting} onClick={() => void decide("FALSE_POSITIVE")}>Ложное срабатывание</button><button className="button button--secondary" disabled={acting} onClick={() => void decide("SKIP")}>Пропустить</button><button className="button button--primary" disabled={acting} onClick={() => void decide("RESOLVE")}><Check size={15} />Решено</button></div></section> : <div className="moderation-notice"><Eye size={16} />Роль наблюдателя: доступен только просмотр.</div>}
        </>}
      </div>
    </section>
  </>;
}
