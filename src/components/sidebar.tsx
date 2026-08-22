"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
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

  // The chat menu should keep showing while browsing pages reached from inside a chat
  // (e.g. a member profile) that aren't themselves under /chats/[id] -- so once a chat
  // is opened, remember it and only swap when the URL points at a *different* chat.
  // Setting state during render (not in an effect) is React's documented pattern for
  // this kind of "adjust state when a prop/derived value changes" case.
  const [rememberedChatId, setRememberedChatId] = useState<string | null>(activeChatId);
  if (activeChatId && activeChatId !== rememberedChatId) {
    setRememberedChatId(activeChatId);
  }

  const shownChatId = activeChatId ?? rememberedChatId;
  const activeChat = shownChatId ? chats.find((chat) => chat.id === shownChatId) ?? null : null;
  const activeTab = activeChatId ? (searchParams.get("tab") ?? "overview") : null;

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

        {activeChat ? (
          <>
            <hr className="sidebar-divider" />
            <div className="group-header">
              <span className="group-avatar">{activeChat.title.slice(0, 1).toUpperCase()}</span>
              <span className="group-name">{activeChat.title}</span>
              <span className={statusDotClass(activeChat.status)} title={activeChat.status} />
            </div>
            <nav className="nav-list group-tabs--static" aria-label={`Вкладки чата ${activeChat.title}`}>
              {chatTabs.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.tab;
                return (
                  <Link
                    key={item.tab}
                    className={`group-tab ${active ? "is-active" : ""}`}
                    href={`/chats/${activeChat.id}?tab=${item.tab}`}
                  >
                    <Icon size={14} strokeWidth={1.8} /><span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </>
        ) : null}
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
