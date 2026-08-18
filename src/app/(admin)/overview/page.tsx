import Link from "next/link";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [chatCount, activeBotLinks, knownUsers, messages24h, latestChat] = await Promise.all([
    prisma.chat.count(),
    prisma.botChat.count({ where: { status: "ACTIVE" } }),
    prisma.telegramUser.count({ where: { isBot: false } }),
    prisma.message.count({ where: { telegramDate: { gte: since } } }),
    prisma.chat.findFirst({ orderBy: { lastActivityAt: "desc" } })
  ]);

  return (
    <main className="page">
      <header className="page-header"><div><span className="eyebrow">Управление Telegram</span><h1>Обзор</h1><p>Состояние бота и реальные данные из подключённых Telegram-чатов.</p></div></header>
      <section className="metric-grid" aria-label="Ключевые показатели">
        <article className="metric-card"><span>Подключённые чаты</span><strong>{chatCount.toLocaleString("ru-RU")}</strong><small>Реальные чаты из Telegram</small></article>
        <article className="metric-card"><span>Бот активен</span><strong>{activeBotLinks.toLocaleString("ru-RU")}</strong><small>Чаты с правами для модерации</small></article>
        <article className="metric-card"><span>Известные участники</span><strong>{knownUsers.toLocaleString("ru-RU")}</strong><small>Уникальные пользователи, которых увидел бот</small></article>
        <article className="metric-card"><span>Сообщения за 24 часа</span><strong>{messages24h.toLocaleString("ru-RU")}</strong><small>Наблюдаемые Telegram-сообщения</small></article>
      </section>
      <section className="panel">
        <div className="panel-header"><div><h2>Подключение Telegram</h2><p>Чаты, участники и сообщения синхронизируются автоматически через webhook.</p></div><div className="panel-actions"><Link className="button button--secondary" href="/members">Участники</Link><Link className="button button--secondary" href="/chats">Открыть чаты</Link></div></div>
        <div className="status-row"><span className={`status-dot ${chatCount > 0 ? "status-dot--ok" : ""}`} /><div><strong>{chatCount > 0 ? "Telegram передаёт данные" : "Ожидаем первый чат"}</strong><p>{latestChat ? `Последняя активность: ${latestChat.lastActivityAt.toLocaleString("ru-RU")}` : "Добавьте бота в группу или супергруппу после настройки webhook."}</p></div></div>
      </section>
    </main>
  );
}
