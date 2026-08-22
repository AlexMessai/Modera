"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  ChevronRight,
  LayoutDashboard,
  LogOut,
  MessageCircleQuestion,
  MessageSquareText,
  MessagesSquare,
  ScrollText,
  ServerCog,
  Terminal,
  UserRoundPlus,
  UsersRound
} from "lucide-react";

const topNavigation = [
  { href: "/chats", label: "Группы", icon: MessageSquareText },
  { href: "/overview", label: "Обзор", icon: LayoutDashboard },
  { href: "/incidents", label: "Журнал", icon: ScrollText }
];

// Public reference page (no login) — opens outside the admin shell, so it's a plain external link rather than a routed nav-item.
const commandsReferenceLink = { href: "/commands", label: "Команды", icon: Terminal };

const chatTabs = [
  { tab: "overview", label: "Обзор", icon: LayoutDashboard },
  { tab: "settings", label: "Настройки", icon: ServerCog },
  { tab: "members", label: "Участники", icon: UsersRound },
  { tab: "requests", label: "Заявки", icon: UserRoundPlus },
  { tab: "appeals", label: "Апелляции", icon: MessageCircleQuestion },
  { tab: "messages", label: "Сообщения", icon: MessagesSquare },
  { tab: "journal", label: "Журнал чата", icon: ScrollText }
];

const roleLabels: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  MODERATOR: "Модератор",
  VIEWER: "Наблюдатель"
};

export type SidebarChat = {
  id: string;
  title: string;
  status: string;
};

function statusDotClass(status: string) {
  if (status === "ACTIVE" || status === "CONNECTED") return "chat-status-dot chat-status-dot--ok";
  if (status === "NOT_ADMIN" || status === "INSUFFICIENT_PERMISSIONS") return "chat-status-dot chat-status-dot--warn";
  return "chat-status-dot";
}

export function Sidebar({
  admin,
  chats
}: {
  admin: { displayName: string; email: string; role: string };
  chats: SidebarChat[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const chatMatch = pathname.match(/^\/chats\/([^/]+)/);
  const activeChatId = chatMatch ? chatMatch[1] : null;
  const activeTab = activeChatId ? (searchParams.get("tab") ?? "overview") : null;
  const [openChats, setOpenChats] = useState<Set<string>>(() => new Set(activeChatId ? [activeChatId] : []));

  function toggleChat(id: string) {
    setOpenChats((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const isSystem = admin.role === "OWNER" || admin.role === "ADMIN";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand"><span className="brand-mark">M</span><span>Modera</span></div>
        <nav className="nav-list" aria-label="Основная навигация">
          {topNavigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} className={`nav-item ${active ? "nav-item--active" : ""}`} href={item.href}>
                <Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>
              </Link>
            );
          })}
          <a className="nav-item" href={commandsReferenceLink.href} target="_blank" rel="noreferrer">
            <Terminal size={18} strokeWidth={1.8} /><span>{commandsReferenceLink.label}</span>
          </a>
        </nav>

        <div className="section-label"><span>Чаты</span><span className="count">{chats.length}</span></div>
        <div className="groups-list">
          {chats.map((chat) => {
            const open = openChats.has(chat.id) || activeChatId === chat.id;
            return (
              <div className="group-node" key={chat.id}>
                <button
                  type="button"
                  className={`group-row ${open ? "is-open" : ""} ${activeChatId === chat.id ? "is-active-parent" : ""}`}
                  onClick={() => toggleChat(chat.id)}
                >
                  <span className="group-avatar">{chat.title.slice(0, 1).toUpperCase()}</span>
                  <span className="group-name">{chat.title}</span>
                  <span className={statusDotClass(chat.status)} title={chat.status} />
                  <ChevronRight className="group-chevron" size={13} strokeWidth={2} />
                </button>
                {open ? (
                  <div className="group-tabs">
                    {chatTabs.map((item) => {
                      const Icon = item.icon;
                      const active = activeChatId === chat.id && activeTab === item.tab;
                      return (
                        <Link
                          key={item.tab}
                          className={`group-tab ${active ? "is-active" : ""}`}
                          href={`/chats/${chat.id}?tab=${item.tab}`}
                        >
                          <Icon size={14} strokeWidth={1.8} /><span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-footer">
        {isSystem ? (
          <nav className="nav-list nav-list--footer" aria-label="Система">
            <Link className={`nav-item ${pathname === "/system" || pathname.startsWith("/system/") ? "nav-item--active" : ""}`} href="/system">
              <ServerCog size={18} strokeWidth={1.8} /><span>Система</span>
            </Link>
          </nav>
        ) : null}
        <div className="sidebar-account">
          <div className="account-avatar">{admin.displayName.slice(0, 1).toUpperCase()}</div>
          <div className="account-copy"><strong>{admin.displayName}</strong><span>{roleLabels[admin.role] ?? admin.role}</span></div>
          <button className="icon-button" onClick={logout} title="Выйти" aria-label="Выйти"><LogOut size={17} /></button>
        </div>
      </div>
    </aside>
  );
}
