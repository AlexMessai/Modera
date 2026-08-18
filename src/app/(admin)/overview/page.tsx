import Link from "next/link";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [chatCount, activeBotLinks, latestChat] = await Promise.all([
    prisma.chat.count(),
    prisma.botChat.count({ where: { status: "ACTIVE" } }),
    prisma.chat.findFirst({ orderBy: { lastActivityAt: "desc" } })
  ]);

  return (
    <main className="page">
      <header className="page-header"><div><span className="eyebrow">Управление Telegram</span><h1>Обзор</h1><p>Состояние бота и подключённых Telegram-чатов.</p></div></header>
      <section className="metric-grid" aria-label="Ключевые показатели">
        <article className="metric-card"><span>Подключённые чаты</span><strong>{chatCount.toLocaleString("ru-RU")}</strong><small>Реальные чаты из Telegram</small></article>
        <article className="metric-card"><span>Бот активен</span><strong>{activeBotLinks.toLocaleString("ru-RU")}</strong><small>Чаты с правами для модерации</small></article>
        <article className="metric-card metric-card--muted"><span>Известные участники</span><strong>—</strong><small>Синхронизация — следующий этап</small></article>
        <article className="metric-card metric-card--muted"><span>Сообщения сегодня</span><strong>—</strong><small>Хранение сообщений ещё не включено</small></article>
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>Подключение Telegram</h2><p>Чат появится автоматически после события Telegram webhook.</p></div><Link className="button button--secondary" href="/chats">Открыть чаты</Link></div>
        <div className="status-row"><span className={`status-dot ${chatCount > 0 ? "status-dot--ok" : ""}`} /><div><strong>{chatCount > 0 ? "Telegram уже передаёт данные" : "Ожидаем первый чат"}</strong><p>{latestChat ? `Последняя активность: ${latestChat.lastActivityAt.toLocaleString("ru-RU")}` : "Добавьте бота в группу или супергруппу после настройки webhook."}</p></div></div>
      </section>
    </main>
  );
}
