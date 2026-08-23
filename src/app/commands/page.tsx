import type { Metadata } from "next";
import { CommandsReference } from "@/components/commands-reference-client";
import { COMMAND_CATEGORIES } from "@/components/commands-reference-data";
import { Sidebar } from "@/components/sidebar";
import { getCurrentAdmin } from "@/server/auth/session";
import { listChats } from "@/server/services/chat-service";

export const metadata: Metadata = {
  title: "Команды Modera",
  description: "Команды ручной модерации Modera: /warn, /mute, /ban и другие."
};

function CommandsContent() {
  return (
    <main className="cmd-page">
      <header className="cmd-page-header">
        <div className="brand"><span className="brand-mark">M</span><span>Modera</span></div>
        <h1>Команды Modera</h1>
        <p>Modera управляется командами прямо в чате. Отправьте команду, отвечая (Reply) на сообщение участника — либо укажите @username или Telegram ID сразу после команды.</p>

        <div className="cmd-note-grid">
          <div className="cmd-note"><strong>Цель команды</strong><div>Reply на сообщение участника, либо <code>@username</code> / Telegram ID сразу после названия команды. Причина и срок (где применимо) идут дальше в том же сообщении.</div></div>
          <div className="cmd-note"><strong>Права</strong><div>Каждая команда требует своего права — их выдают в разделе «Роли» для конкретного чата.</div></div>
          <div className="cmd-note"><strong>Сообщение с командой</strong><div>Удаляется ботом сразу после обработки — независимо от результата.</div></div>
          <div className="cmd-note"><strong>Публичные и приватные уведомления</strong><div>Показывать ли результат в общем чате и присылать ли наказанному участнику личное уведомление — настраивается в «Система → Уведомления», а не по отдельным командам.</div></div>
        </div>
      </header>

      <CommandsReference categories={COMMAND_CATEGORIES} />
    </main>
  );
}

// Public reference page (no login required) -- but a logged-in admin who
// reaches it from the sidebar's "Команды" link should stay inside the same
// admin shell as every other tab, not lose the sidebar to a bare page. So
// this is the one route outside the (admin) route group that still renders
// Sidebar, conditionally, via a plain getCurrentAdmin() lookup (never
// redirects, unlike requireAdminPage) -- anonymous visitors keep today's
// bare public layout untouched.
export default async function CommandsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) return <CommandsContent />;

  const chatList = await listChats({ page: 1, pageSize: 100 });
  const chats = chatList.items.map((chat) => ({ id: chat.id, title: chat.title, status: chat.status }));

  return (
    <div className="admin-shell">
      <Sidebar
        admin={{ displayName: admin.displayName, email: admin.email, role: admin.role }}
        chats={chats}
      />
      <div className="admin-main"><CommandsContent /></div>
    </div>
  );
}
