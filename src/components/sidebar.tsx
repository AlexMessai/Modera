"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, MessageSquareText, LogOut } from "lucide-react";

const navigation = [
  { href: "/overview", label: "Обзор", icon: LayoutDashboard },
  { href: "/chats", label: "Чаты", icon: MessageSquareText }
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
