import { Sidebar } from "@/components/sidebar";
import { requireAdminPage } from "@/server/auth/guards";
import { listChats } from "@/server/services/chat-service";
import { listChatsForAdmin } from "@/server/services/chat-admin-access-service";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdminPage();
  const visibleChatIds = await listChatsForAdmin(admin.id);
  const chatList = await listChats({ page: 1, pageSize: 100, visibleChatIds });
  const chats = chatList.items.map((chat) => ({ id: chat.id, title: chat.title, status: chat.status }));
  return (
    <div className="admin-shell">
      <Sidebar
        admin={{ displayName: admin.displayName, email: admin.email ?? "", role: admin.role, scope: admin.scope }}
        chats={chats}
      />
      <div className="admin-main">{children}</div>
    </div>
  );
}
