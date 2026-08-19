"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  MessagesSquare,
  MessageCircleQuestion,
  ScrollText,
  ServerCog,
  Siren,
  ShieldAlert,
  ShieldCheck,
  UserRoundPlus,
  UsersRound
} from "lucide-react";

const baseNavigation = [
  { href: "/overview", label: "Обзор", icon: LayoutDashboard },
  { href: "/incidents", label: "Центр модерации", icon: Siren },
  { href: "/chats", label: "Чаты", icon: MessageSquareText },
  { href: "/members", label: "Участники", icon: UsersRound },
  { href: "/join-requests", label: "Заявки", icon: UserRoundPlus },
  { href: "/appeals", label: "Апелляции", icon: MessageCircleQuestion },
  { href: "/messages", label: "Сообщения", icon: MessagesSquare },
  { href: "/moderation", label: "Модерация", icon: ShieldCheck },
  { href: "/anti-raid", label: "Anti-Raid", icon: ShieldAlert },
  { href: "/journal", label: "Журнал", icon: ScrollText }
];

const roleLabels: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  MODERATOR: "Модератор",
  VIEWER: "Наблюдатель"
};

export function Sidebar({ admin }: { admin: { displayName: string; email: string; role: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  const navigation =
    admin.role === "OWNER" || admin.role === "ADMIN"
      ? [...baseNavigation, { href: "/system", label: "Система", icon: ServerCog }]
      : baseNavigation;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <div>
        <div className="brand"><span className="brand-mark">M</span><span>Modera</span></div>
        <nav className="nav-list" aria-label="Основная навигация">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} className={`nav-item ${active ? "nav-item--active" : ""}`} href={item.href}>
                <Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="sidebar-account">
        <div className="account-avatar">{admin.displayName.slice(0, 1).toUpperCase()}</div>
        <div className="account-copy"><strong>{admin.displayName}</strong><span>{roleLabels[admin.role] ?? admin.role}</span></div>
        <button className="icon-button" onClick={logout} title="Выйти" aria-label="Выйти"><LogOut size={17} /></button>
      </div>
    </aside>
  );
}
