import { Sidebar } from "@/components/sidebar";
import { requireAdminPage } from "@/server/auth/guards";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const admin = await requireAdminPage();
  return (
    <div className="admin-shell">
      <Sidebar admin={{ displayName: admin.displayName, email: admin.email, role: admin.role }} />
      <div className="admin-main">{children}</div>
    </div>
  );
}
