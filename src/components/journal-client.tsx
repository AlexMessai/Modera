"use client";

import Link from "next/link";
import { Fragment, FormEvent, useEffect, useState } from "react";
import { RefreshCw, Search, TriangleAlert } from "lucide-react";

type JournalCategory = "ALL" | "MANUAL" | "AUTOMOD" | "ERRORS" | "SETTINGS" | "PENDING";
type Person = { id: string; displayName: string; username: string | null; telegramUserId: string };
type Chat = { id: string; title: string; telegramChatId: string };
type Admin = { id: string; displayName: string; email: string };
type JournalItem = { id: string; source: string; action: string; reason: string | null; metadata: unknown; createdAt: string; status: "SUCCEEDED" | "FAILED"; chat: Chat | null; affectedUser: Person | null; actingAdmin: Admin | null };
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
  MODERATION_UNWARN: "Снятие предупреждения",
  MODERATION_MUTE: "Mute",
  MODERATION_UNMUTE: "Снятие mute",
  MODERATION_BAN: "Блокировка",
  MODERATION_UNBAN: "Разблокировка",
  MODERATION_KICK: "Исключение из чата",
  MODERATION_ACTION_FAILED: "Ошибка ручной модерации",
  MODERATION_RECONCILIATION_CHECKED: "Сверка с Telegram",
  MODERATION_RECONCILIATION_CHECK_FAILED: "Ошибка сверки с Telegram",
  MANUAL_MESSAGE_DELETED: "Сообщение удалено вручную",
  MANUAL_MESSAGE_ALREADY_GONE: "Сообщение уже отсутствовало",
  MANUAL_MESSAGE_DELETE_FAILED: "Ошибка ручного удаления сообщения",
  MEMBER_TAG_UPDATED: "Тег участника изменён",
  MEMBER_TAG_REMOVED: "Тег участника удалён",
  MEMBER_TAG_UPDATE_FAILED: "Ошибка изменения тега участника",
  TELEGRAM_MEMBER_TAG_CHANGED: "Тег синхронизирован из Telegram",
  TELEGRAM_MEMBER_TAG_REMOVED: "Тег удалён в Telegram",
  REPORT_SUBMITTED: "Подана жалоба",
  REPORT_RESOLVED: "Жалоба обработана",
  REPORT_DISMISSED: "Жалоба отклонена",
  AUTOMOD_LINK_DELETED: "Удалена запрещённая ссылка",
  AUTOMOD_TERM_DELETED: "Удалено запрещённое слово или фраза",
  AUTOMOD_MEDIA_DELETED: "Удалён запрещённый тип контента",
  AUTOMOD_MEDIA_TRIGGERED: "Обнаружен запрещённый тип контента",
  AUTOMOD_MENTIONS_DELETED: "Удалено за массовые упоминания",
  AUTOMOD_DUPLICATE_DELETED: "Удалено повторяющееся сообщение",
  AUTOMOD_SPAM_DELETED: "Удалено за флуд",
  AUTOMOD_WARNING: "Автоматическое предупреждение",
  AUTOMOD_AUTO_MUTE: "Автоматический mute",
  AUTOMOD_AUTO_BAN: "Автоматическая блокировка",
  AUTOMOD_ESCALATION_FAILED: "Ошибка автоматического наказания",
  AUTOMOD_ESCALATION_SKIPPED_PROTECTED: "Автонаказание пропущено для администратора",
  AUTOMOD_ESCALATION_NOT_TRIGGERED: "Порог не сработал (диагностика)",
  AUTOMOD_DELETE_FAILED: "Ошибка автоматического удаления",
  AUTOMOD_SETTINGS_UPDATED: "Изменены правила чата",
  GLOBAL_AUTOMOD_SETTINGS_UPDATED: "Изменена глобальная политика",
  PUNISHMENT_STATE_CONFIRMED: "Состояние наказания подтверждено Telegram",
  PUNISHMENT_STATE_CLEARED: "Telegram снял наказание",
  CAPTCHA_CHALLENGE_SENT: "Отправлена капча новому участнику",
  CAPTCHA_PASSED: "Капча пройдена",
  CAPTCHA_TIMEOUT_KICK: "Исключён за непройденную капчу",
  CAPTCHA_SETTINGS_UPDATED: "Изменены настройки капчи чата",
  MANUAL_MODERATION_SETTINGS_UPDATED: "Изменены шаблоны ручной модерации чата",
  GLOBAL_MANUAL_MODERATION_SETTINGS_UPDATED: "Изменены глобальные шаблоны ручной модерации",
  ANTI_RAID_STARTED: "Обнаружен рейд",
  ANTI_RAID_RESOLVED: "Рейд завершён",
  ANTI_RAID_SETTINGS_UPDATED: "Изменены настройки Anti-Raid чата",
  REPORT_SETTINGS_UPDATED: "Изменены настройки жалоб чата",
  LOG_CHANNEL_LINKED: "Подключён канал логов",
  LOG_CHANNEL_UNLINKED: "Отключён канал логов",
  LOG_CHANNEL_SETTINGS_UPDATED: "Изменены настройки канала логов",
  CHAT_ROLE_UPDATED: "Изменены права роли чата",
  CONTENT_SETTINGS_UPDATED: "Изменены приветствие/правила чата",
  SILENCE_STARTED: "Включён режим тишины",
  SILENCE_STOPPED: "Снят режим тишины",
  SILENCE_EXPIRED: "Режим тишины снят автоматически",
  AUTO_RESPONSE_CREATED: "Добавлен автоответ",
  AUTO_RESPONSE_UPDATED: "Изменён автоответ",
  AUTO_RESPONSE_DELETED: "Удалён автоответ",
  CUSTOM_COMMAND_CREATED: "Добавлена своя команда",
  CUSTOM_COMMAND_UPDATED: "Изменена своя команда",
  CUSTOM_COMMAND_DELETED: "Удалена своя команда",
  APPEAL_SUBMITTED: "Подана апелляция",
  APPEAL_APPROVED: "Апелляция одобрена",
  APPEAL_REJECTED: "Апелляция отклонена",
  APPEAL_NOTIFICATION_FAILED: "Не удалось уведомить пользователя об апелляции",
  SELF_UNMUTE: "Пользователь самостоятельно снял mute",
  ADMIN_ACCOUNT_CREATED: "Создан аккаунт администратора",
  ADMIN_ACCOUNT_UPDATED: "Изменён аккаунт администратора",
  ADMIN_SESSIONS_REVOKED: "Отозваны сессии администратора",
  CHAT_DISCOVERED: "Бот добавлен в новый чат",
  JOIN_REQUEST_ACTION_FAILED: "Ошибка обработки заявки на вступление",
  JOIN_REQUEST_APPROVED: "Заявка на вступление одобрена",
  JOIN_REQUEST_DECLINED: "Заявка на вступление отклонена",
  JOIN_REQUEST_EXPIRED: "Заявка на вступление устарела в Telegram",
  ADMIN_TELEGRAM_LINKED: "Администратор привязал Telegram-аккаунт",
  ADMIN_TELEGRAM_UNLINKED: "Администратор отвязал Telegram-аккаунт",
  MODERATION_NOTIFICATION_PROFILES_UPDATED: "Изменены глобальные профили уведомлений",
  NEW_MEMBER_BLOCKED: "Новый участник заблокирован при входе",
  NEW_MEMBER_MUTED: "Новый участник ограничен при входе",
  EXISTING_MEMBER_BLOCKED: "Участник заблокирован повторной проверкой"
};

const pendingLabels: Record<string, string> = {
  WARNING: "Предупреждение",
  MUTE: "Mute",
  UNMUTE: "Снятие mute",
  BAN: "Блокировка",
  UNBAN: "Разблокировка",
  KICK: "Исключение из чата"
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

function telegramActorName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  if (typeof record.telegramActorDisplayName === "string" && record.telegramActorDisplayName.trim()) {
    return record.telegramActorDisplayName;
  }
  if (typeof record.telegramActorUsername === "string" && record.telegramActorUsername.trim()) {
    return `@${record.telegramActorUsername}`;
  }
  return null;
}

function systemActorLabel(item: { action: string; source: string; metadata?: unknown }) {
  if (item.source === "SYSTEM") return "Автомодерация";
  if (item.source === "TELEGRAM") return telegramActorName(item.metadata) ?? "Telegram";
  return "Система";
}

function pendingActorLabel(item: PendingItem) {
  if (item.actingAdmin) return item.actingAdmin.displayName;
  return item.source === "SYSTEM" ? "Автомодерация" : "Система";
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
                    {item.chat.title} · {pendingActorLabel(item)}
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
                  {data.items.map((item) => {
                    const hasMetadata = item.metadata !== null && item.metadata !== undefined;
                    const isExpanded = expandedId === item.id;
                    return (
                      <Fragment key={item.id}>
                        <tr
                          className={hasMetadata ? "journal-row--expandable" : undefined}
                          onClick={hasMetadata ? () => setExpandedId(isExpanded ? null : item.id) : undefined}
                          style={hasMetadata ? { cursor: "pointer" } : undefined}
                        >
                          <td><div className="stacked-cell journal-event-cell"><strong>{actionLabels[item.action] ?? "Системное событие"}</strong><span>{item.reason ?? (item.source === "SYSTEM" ? "Автоматическое правило" : "Без причины")}</span></div></td>
                          <td>{item.chat ? <Link className="table-link" href={`/chats/${item.chat.id}`} onClick={(event) => event.stopPropagation()}>{item.chat.title}</Link> : "—"}</td>
                          <td>{item.affectedUser ? <Link className="stacked-cell table-link" href={`/members/${item.affectedUser.id}`} onClick={(event) => event.stopPropagation()}><strong>{item.affectedUser.displayName}</strong><span>{item.affectedUser.username ? `@${item.affectedUser.username}` : item.affectedUser.telegramUserId}</span></Link> : "—"}</td>
                          <td>{item.actingAdmin?.displayName ?? systemActorLabel(item)}</td>
                          <td><span className={`badge ${item.status === "FAILED" ? "badge--danger" : "badge--active"}`}>{item.status === "FAILED" ? "Ошибка" : "Выполнено"}</span></td>
                          <td>{formatDate(item.createdAt)}</td>
                        </tr>
                        {isExpanded ? (
                          <tr>
                            <td colSpan={6}><pre className="journal-metadata">{JSON.stringify(item.metadata, null, 2)}</pre></td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
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
