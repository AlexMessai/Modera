"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { TelegramChatAvatar } from "@/components/telegram-avatar";
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

// Public reference page (no login required, but still part of the admin shell's nav).
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
  admin: { displayName: string; email: string; role: string; scope: string };
  chats: SidebarChat[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const chatMatch = pathname.match(/^\/chats\/([^/]+)/);
  const activeChatId = chatMatch ? chatMatch[1] : null;
  // Обзор/Журнал now scope themselves to the admin's own chats server-side
  // (getDashboardData/listModerationJournal with visibleChatIds), so every
  // admin -- GLOBAL or CHAT-scoped -- sees both links.
  const onTopNavPage = topNavigation.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) && !activeChatId;

  // The "which chat's tab is highlighted" concept keeps working while browsing pages
  // reached from inside a chat (e.g. a member profile) that aren't themselves under
  // /chats/[id] -- so once a chat is opened, remember it and only swap when the URL
  // points at a *different* chat. It's explicitly dropped when landing on one of the
  // top-level nav pages (Группы grid, Обзор, Журнал) rather than a specific chat.
  // Setting state during render (not in an effect) is React's documented pattern for
  // this "adjust state when a derived value changes" case.
  const [rememberedChatId, setRememberedChatId] = useState<string | null>(activeChatId);

  // Every connected chat is always listed in the sidebar; each expands independently
  // (approved chat-first design) rather than only showing tabs for the one chat you
  // happen to be viewing. Navigating to a chat auto-expands it here the first time --
  // but only that once, on the transition into it, so the admin can still manually
  // collapse the chat they're currently viewing without it snapping back open on the
  // next render (it would, if this re-added shownChatId unconditionally every render
  // whenever it's missing from the set).
  const [openChatIds, setOpenChatIds] = useState<Set<string>>(() => new Set(activeChatId ? [activeChatId] : []));

  if (activeChatId && activeChatId !== rememberedChatId) {
    setRememberedChatId(activeChatId);
    if (!openChatIds.has(activeChatId)) setOpenChatIds(new Set(openChatIds).add(activeChatId));
  } else if (!activeChatId && onTopNavPage && rememberedChatId !== null) {
    setRememberedChatId(null);
  }

  const shownChatId = activeChatId ?? rememberedChatId;
  const activeTab = activeChatId ? (searchParams.get("tab") ?? "overview") : null;

  function toggleChat(chatId: string) {
    setOpenChatIds((current) => {
      const next = new Set(current);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }

  // A CHAT-scoped admin, even with the inert VIEWER role, must never see
  // system-wide account management.
  const isSystem = admin.scope === "GLOBAL" && (admin.role === "OWNER" || admin.role === "ADMIN");

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
          <Link className={`nav-item ${pathname === commandsReferenceLink.href ? "nav-item--active" : ""}`} href={commandsReferenceLink.href}>
            <Terminal size={18} strokeWidth={1.8} /><span>{commandsReferenceLink.label}</span>
          </Link>
        </nav>

        <hr className="sidebar-divider" />
        <div className="section-label"><span>Чаты</span><span className="count">{chats.length}</span></div>
        <div className="groups-list">
          {chats.map((chat) => {
            const isOpen = openChatIds.has(chat.id);
            const isShownChat = chat.id === shownChatId;
            return (
              <div className="group-node" key={chat.id}>
                <button
                  type="button"
                  className={`group-row ${isOpen ? "is-open" : ""} ${isShownChat ? "is-active-parent" : ""}`}
                  aria-expanded={isOpen}
                  onClick={() => toggleChat(chat.id)}
                >
                  <TelegramChatAvatar chatId={chat.id} displayName={chat.title} size={28} className="group-avatar" />
                  <span className="group-name">{chat.title}</span>
                  <span className={statusDotClass(chat.status)} title={chat.status} />
                  <ChevronRight size={14} strokeWidth={2} className="group-chevron" />
                </button>
                <nav className={`group-tabs ${isOpen ? "is-open" : ""}`} aria-label={`Вкладки чата ${chat.title}`}>
                  {chatTabs.map((item) => {
                    const Icon = item.icon;
                    const active = isShownChat && activeTab === item.tab;
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
                </nav>
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
