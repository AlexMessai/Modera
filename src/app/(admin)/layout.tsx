import { Sidebar } from "@/components/sidebar";
import { requireAdminPage } from "@/server/auth/guards";
import { hasAnyJoinRequests } from "@/server/services/join-request-service";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [admin, showJoinRequests] = await Promise.all([requireAdminPage(), hasAnyJoinRequests()]);
  return (
    <div className="admin-shell">
      <Sidebar
        admin={{ displayName: admin.displayName, email: admin.email, role: admin.role }}
        showJoinRequests={showJoinRequests}
      />
      <div className="admin-main">{children}</div>
    </div>
  );
}
