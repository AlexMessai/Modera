import { Sidebar } from "@/components/sidebar";
import { requireAdminPage } from "@/server/auth/guards";
import { listChats } from "@/server/services/chat-service";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [admin, chatList] = await Promise.all([requireAdminPage(), listChats({ page: 1, pageSize: 100 })]);
  const chats = chatList.items.map((chat) => ({ id: chat.id, title: chat.title, status: chat.status }));
  return (
    <div className="admin-shell">
      <Sidebar
        admin={{ displayName: admin.displayName, email: admin.email, role: admin.role }}
        chats={chats}
      />
      <div className="admin-main">{children}</div>
    </div>
  );
}
