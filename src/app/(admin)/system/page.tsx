import { redirect } from "next/navigation";
import { SystemClient } from "@/components/system-client";
import { requireAdminPage } from "@/server/auth/guards";
import { canViewSystem } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  const admin = await requireAdminPage();
  if (!canViewSystem(admin.role)) redirect("/overview");

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Production · Диагностика</span>
          <h1>Система</h1>
          <p>PostgreSQL, Telegram Bot API, webhook, очереди, ошибки и безопасная проверка конфигурации.</p>
        </div>
      </header>
      <SystemClient />
    </main>
  );
}
